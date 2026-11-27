/**
 * Sign in with ChatGPT, for using a person's ChatGPT plan (providers/chatgpt.js).
 *
 * OpenAI's flow for open-source, locally run tools: OAuth with PKCE, no client
 * secret, a client registered on first sign-in (`dynamic_agent_client`) and
 * reused after. Its callback must be an http loopback address on 127.0.0.1,
 * which a page cannot listen on. So the browser is sent to OpenAI in a new tab
 * and comes back to an address that does not load; the person pastes that
 * address here (`finish`), and the page makes the exchange itself — OpenAI's
 * token and API endpoints answer pages (CORS) — with the verifier only it
 * holds. The code in the address is useless without that verifier.
 *
 * Where things are kept:
 *
 *   - The tokens, on this device only (`storage`, localStorage in a page).
 *     Refresh tokens rotate: each refresh spends the old one. Kept in the
 *     account's synced settings, two devices refreshing at once would spend
 *     the same token twice and both be signed out. On one device, every page
 *     and worker of the browser refreshes under one lock, and re-reads before
 *     it does, so that cannot happen.
 *   - This device's host id, also here: OpenAI attributes plan usage to a
 *     host, one per installation.
 *   - The registration (issued client id, account, email), which is not a
 *     secret, in the account's settings by the caller (providers/keys.js): a
 *     second device signs in to the same registration instead of making
 *     another.
 *
 * The ID token is checked for issuer, audience, expiry and nonce. Its
 * signature is not: OpenAI's key set does not answer pages, and a token taken
 * straight from the token endpoint over TLS may be trusted on the endpoint's
 * certificate (OpenID Connect Core 3.1.3.7, rule 6).
 */

import { Interruption } from "../net/network.js"

export const ISSUER = "https://auth.openai.com"
const AUTHORIZE = `${ISSUER}/api/accounts/authorize`
const TOKEN = `${ISSUER}/api/accounts/oauth/token`
const REVOKE = `${ISSUER}/api/accounts/oauth/revoke`
export const RESOURCE = "https://api.openai.com/v1"

/** Only the port may vary; 1455 is the one OpenAI's examples use. */
export const REDIRECT_URI = "http://127.0.0.1:1455/auth/callback"

/** Identity, then plan use: the last is what lets requests run on the plan. */
export const SCOPES = ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"]
export const PLAN_SCOPE = "chatgpt.tokens.use.direct"

/** What the person sees the app called when they approve it, and in ChatGPT's settings after. */
export const AGENT_NAME = "Patchwork"

const RECORD_KEY = "patchwork-agent:chatgpt"
const HOST_KEY = "patchwork-agent:chatgpt-host"
const PENDING_KEY = "patchwork-agent:chatgpt-pending"

/** A sign-in begun and not finished is forgotten after this long. */
export const PENDING_MS = 30 * 60 * 1000

/** A token is renewed when it has less than this left, so a run is handed one with room in it. */
export const FRESH_MS = 10 * 60 * 1000

/** Refresh errors that mean the sign-in is over (OpenAI's "refresh errors"). */
const SPENT = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"])

/** The sign-in is over: the person has to sign in again. */
export class SignInNeeded extends Error {
  constructor(message) {
    super(message)
    this.name = "SignInNeeded"
  }
}

// ---------------------------------------------------------------- storage

const listeners = new Set()

/** Hear about this device's sign-in changing, here or in another tab. */
export function onSignInChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function changed() {
  for (const listener of [...listeners]) listener()
}

// Another tab signing in or out, or refreshing, changes the same storage.
try {
  globalThis.addEventListener?.("storage", (event) => {
    if (event?.key === RECORD_KEY) changed()
  })
} catch {
  /* a worker with no storage events */
}

function read(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(storage, key, value) {
  try {
    if (value == null) storage?.removeItem(key)
    else storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** This device's sign-in, or null. */
export function readRecord(storage = globalThis.localStorage) {
  const record = read(storage, RECORD_KEY)
  return record && typeof record.clientId === "string" ? record : null
}

function saveRecord(record, storage) {
  write(storage, RECORD_KEY, record)
  changed()
}

/** This installation's host id, made once: `urn:uuid:…`, which identifies nothing about the person. */
export function hostId(storage = globalThis.localStorage) {
  const kept = read(storage, HOST_KEY)
  if (typeof kept === "string" && kept.startsWith("urn:uuid:")) return kept
  const made = `urn:uuid:${globalThis.crypto.randomUUID()}`
  write(storage, HOST_KEY, made)
  return made
}

/**
 * What this device's sign-in is, for a view: `signedIn` when it holds a
 * refresh token with plan use granted, `planEnabled` false when the person
 * signed in without granting plan use.
 */
export function status(storage = globalThis.localStorage, now = Date.now()) {
  const record = readRecord(storage)
  const pending = read(storage, PENDING_KEY)
  return {
    // Tokens that can run a request now or be renewed into ones that can.
    signedIn: !!(record?.refreshToken || (record?.accessToken && record.expiresAt > now)),
    planEnabled: !!record?.scopes?.includes(PLAN_SCOPE),
    email: record?.email ?? null,
    clientId: record?.clientId ?? null,
    expiresAt: record?.expiresAt ?? null,
    // Gone to ChatGPT and not back yet.
    pending: !!(pending?.opened && now - pending.at < PENDING_MS),
  }
}

// ---------------------------------------------------------------- PKCE

function base64url(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function random(bytes = 32) {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function challengeOf(verifier) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

/** A JWT's claims, unverified (see the note at the top on signatures). */
export function claimsOf(jwt) {
  const payload = String(jwt ?? "").split(".")[1]
  if (!payload) throw new Error("not a JWT")
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))))
}

// ---------------------------------------------------------------- signing in

/**
 * Begin a sign-in: the address to open, in a new tab. `registration` is the
 * account's saved `{ clientId, email }` when there is one, so this device
 * joins it rather than registering again; this device's ID token, when it
 * still has one for that registration, skips choosing the account.
 *
 * The attempt (state, nonce, verifier) is kept until `finish`, so the panel
 * can be closed and opened again while the person is in the other tab.
 */
export async function begin({ registration = null, storage = globalThis.localStorage, now = Date.now(), agentName = AGENT_NAME } = {}) {
  // An attempt still fresh for the same registration is the one used: the
  // person may be in the other tab with it, and a new one would refuse the
  // address they come back with.
  const kept = read(storage, PENDING_KEY)
  const clientId = registration?.clientId ?? null
  const pending =
    kept && now - kept.at < PENDING_MS && (kept.clientId ?? null) === clientId
      ? kept
      : { state: random(24), nonce: random(24), verifier: random(48), clientId, redirectUri: REDIRECT_URI, at: now, opened: false }
  const verifier = pending.verifier
  write(storage, PENDING_KEY, pending)

  const params = new URLSearchParams({
    client_id: pending.clientId ?? "dynamic_agent_client",
    response_type: "code",
    redirect_uri: pending.redirectUri,
    scope: SCOPES.join(" "),
    resource: RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: await challengeOf(verifier),
    ext_agent_host_id: hostId(storage),
  })
  if (!pending.clientId) params.set("agent_name_hint", agentName)
  else {
    const record = readRecord(storage)
    if (record?.clientId === pending.clientId && record.idToken) params.set("id_token_hint", record.idToken)
    if (registration?.email) params.set("login_hint", registration.email)
  }
  return `${AUTHORIZE}?${params}`
}

/** The person has gone to ChatGPT with the attempt: from now on a view shows where to paste the address. */
export function opened(storage = globalThis.localStorage) {
  const pending = read(storage, PENDING_KEY)
  if (!pending) return
  write(storage, PENDING_KEY, { ...pending, opened: true })
  changed()
}

/** Forget a sign-in begun and not finished. */
export function cancel(storage = globalThis.localStorage) {
  write(storage, PENDING_KEY, null)
  changed()
}

/**
 * The callback's parameters from what the person pasted: the whole address,
 * or only its query.
 */
export function parseCallback(pasted) {
  const text = String(pasted ?? "").trim()
  if (!text) throw new Error("Paste the address your browser landed on after you approved.")
  let query
  try {
    query = new URL(text).searchParams
  } catch {
    query = new URLSearchParams(text.startsWith("?") ? text.slice(1) : text)
  }
  return Object.fromEntries(query.entries())
}

/**
 * Finish a sign-in from the pasted callback address: check it answers the
 * attempt begun here, exchange its code, check the ID token and that plan use
 * was granted, and keep the result. Resolves the record; the caller keeps the
 * registration where the account's other devices find it.
 */
export async function finish(pasted, { storage = globalThis.localStorage, fetchImpl = fetch, now = Date.now } = {}) {
  const pending = read(storage, PENDING_KEY)
  if (!pending || now() - pending.at > PENDING_MS) throw new Error("This sign-in has expired or was not started here. Start again.")
  const back = parseCallback(pasted)
  if (back.state !== pending.state) throw new Error("That address is not from the sign-in started here (the state does not match). Start again.")
  if (back.error) {
    cancel(storage)
    throw new Error(back.error === "access_denied" ? "The sign-in was declined, so ChatGPT plan use is not on." : `ChatGPT sign-in failed: ${back.error_description ?? back.error}`)
  }
  if (!back.code) throw new Error("That address has no sign-in code in it. Paste the whole address.")
  // A new registration says which client it made; a returning one may not say, and must not say another.
  const clientId = pending.clientId ?? back.client_id ?? null
  if (!clientId) throw new Error("ChatGPT did not finish registering Patchwork (no client id came back). Start again.")
  if (pending.clientId && back.client_id && back.client_id !== pending.clientId) throw new Error("ChatGPT answered for a different registration. Start again.")

  const response = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: back.code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
      resource: RESOURCE,
    }),
  })
  const tokens = await response.json().catch(() => ({}))
  if (!response.ok) {
    cancel(storage)
    throw new Error(`ChatGPT would not complete the sign-in (${response.status}${tokens?.error ? `, ${tokens.error}` : ""}). Start again.`)
  }

  const identity = checkIdToken(tokens.id_token, { clientId, nonce: pending.nonce, now: now() })
  const previous = readRecord(storage)
  if (previous?.clientId === clientId && previous.subject && previous.subject !== identity.sub) {
    throw new Error("ChatGPT signed in a different account than this registration's. Sign out first to use another account.")
  }
  const record = recordOf(tokens, { clientId, identity, now: now() })
  write(storage, PENDING_KEY, null)
  saveRecord(record, storage)
  return record
}

/** The ID token's claims, when it is the one this sign-in asked for. */
export function checkIdToken(idToken, { clientId, nonce, now }) {
  let claims
  try {
    claims = claimsOf(idToken)
  } catch {
    throw new Error("ChatGPT sent no usable ID token.")
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== ISSUER) throw new Error("The ID token is not from OpenAI.")
  if (!audience.includes(clientId)) throw new Error("The ID token is not for this registration.")
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new Error("The ID token has expired.")
  if (claims.nonce !== nonce) throw new Error("The ID token does not answer this sign-in (nonce).")
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("The ID token names no account.")
  return claims
}

function recordOf(tokens, { clientId, identity, now, previous = null }) {
  const scopes = typeof tokens.scope === "string" ? tokens.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? []
  return {
    clientId,
    subject: identity?.sub ?? previous?.subject ?? null,
    email: identity?.email ?? previous?.email ?? null,
    idToken: tokens.id_token ?? previous?.idToken ?? null,
    accessToken: tokens.access_token,
    // A refresh answer brings a replacement, which is the one kept from then on.
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: now + (Number(tokens.expires_in) || 3600) * 1000,
    earliestRefreshAt: typeof tokens.earliest_refresh_at === "number" ? tokens.earliest_refresh_at * 1000 : null,
    scopes,
    savedAt: now,
  }
}

// ---------------------------------------------------------------- tokens

/** One refresh at a time in this browser: Web Locks across tabs and workers, a queue where there are none. */
let queue = Promise.resolve()
function exclusively(fn, locks = globalThis.navigator?.locks) {
  if (locks?.request) return locks.request("patchwork-agent:chatgpt-refresh", fn)
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

/**
 * An access token with at least `freshMs` left, refreshed if need be; under
 * the lock, the record is read again first, so a tab that waited uses the
 * token the tab before it got instead of refreshing a spent one. Throws
 * SignInNeeded when there is no sign-in or it is over, and an Interruption
 * when OpenAI could not be reached (the tokens are kept).
 */
export async function accessToken({ storage = globalThis.localStorage, fetchImpl = fetch, now = Date.now, freshMs = FRESH_MS, locks } = {}) {
  const good = (record) => record?.accessToken && record.expiresAt - now() > freshMs && record.scopes?.includes(PLAN_SCOPE)
  const first = readRecord(storage)
  if (good(first)) return first.accessToken
  if (!first) throw new SignInNeeded("Not signed in to ChatGPT.")
  if (!first.scopes?.includes(PLAN_SCOPE)) throw new SignInNeeded("ChatGPT plan use was not granted. Sign in again and allow it.")

  return exclusively(async () => {
    const record = readRecord(storage)
    if (good(record)) return record.accessToken
    // OpenAI may say a token is not to be renewed before a time; until then the one held serves.
    if (record?.accessToken && record.expiresAt > now() && record.earliestRefreshAt && now() < record.earliestRefreshAt) return record.accessToken
    if (!record?.refreshToken) {
      // An access token with less than `freshMs` left still works for now.
      if (record?.accessToken && record.expiresAt > now()) return record.accessToken
      throw new SignInNeeded("The ChatGPT sign-in has run out. Sign in again.")
    }
    let response
    try {
      response = await fetchImpl(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", client_id: record.clientId, refresh_token: record.refreshToken, resource: RESOURCE }),
      })
    } catch (err) {
      throw new Interruption(`Could not reach ChatGPT to renew the sign-in (${err?.message ?? err})`, { cause: err })
    }
    const tokens = await response.json().catch(() => ({}))
    if (response.ok && tokens.access_token) {
      saveRecord(recordOf(tokens, { clientId: record.clientId, identity: null, now: now(), previous: record }), storage)
      return tokens.access_token
    }
    if (SPENT.has(tokens?.error)) {
      // Tokens that will not work again go; the registration and the host stay.
      saveRecord({ ...record, accessToken: null, refreshToken: null, expiresAt: 0 }, storage)
      throw new SignInNeeded("The ChatGPT sign-in has ended. Sign in again.")
    }
    if (response.status >= 500 || response.status === 429) throw new Interruption(`ChatGPT could not renew the sign-in just now (${response.status})`)
    throw new Error(`ChatGPT would not renew the sign-in (${response.status}${tokens?.error ? `, ${tokens.error}` : ""}).`)
  }, locks)
}

/**
 * Sign out: revoke the renewable session at OpenAI, then forget the tokens.
 * The registration and this device's host id stay, for signing in again.
 * Resolves whether OpenAI confirmed the revocation; if it did not, the
 * person can disconnect Patchwork in ChatGPT's settings.
 */
export async function signOut({ storage = globalThis.localStorage, fetchImpl = fetch } = {}) {
  const record = readRecord(storage)
  let confirmed = !record?.refreshToken
  if (record?.refreshToken) {
    for (let attempt = 1; attempt <= 3 && !confirmed; attempt++) {
      try {
        const response = await fetchImpl(REVOKE, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: record.refreshToken, token_type_hint: "refresh_token", client_id: record.clientId }),
        })
        if (response.ok) confirmed = true
        else if (response.status < 500) break
      } catch {
        /* the network; tried again */
      }
    }
  }
  if (record) saveRecord({ clientId: record.clientId, subject: record.subject, email: record.email, idToken: null, accessToken: null, refreshToken: null, expiresAt: 0, scopes: [], savedAt: record.savedAt }, storage)
  write(storage, PENDING_KEY, null)
  changed()
  return { confirmed }
}

/** Forget this device's registration too, to sign in a different account. */
export async function forget({ storage = globalThis.localStorage, fetchImpl = fetch } = {}) {
  const out = await signOut({ storage, fetchImpl })
  write(storage, RECORD_KEY, null)
  changed()
  return out
}
