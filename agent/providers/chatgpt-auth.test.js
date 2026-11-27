/**
 * Sign in with ChatGPT: the attempt, the pasted callback, what is checked
 * before anything is kept, and renewing a token without ever spending a
 * refresh token twice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import * as auth from "./chatgpt-auth.js"
import { isInterruption } from "../net/network.js"

const b64 = (value) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const jwt = (claims) => `${b64({ alg: "RS256" })}.${b64(claims)}.c2ln`
const SECONDS = () => Math.floor(Date.now() / 1000)
const ALL_SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"

/** A storage of its own per test, so nothing leaks between them. */
function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

let storage
beforeEach(() => {
  storage = memoryStorage()
})

async function begun(opts = {}) {
  const url = new URL(await auth.begin({ storage, ...opts }))
  return { url, params: url.searchParams, pending: JSON.parse(storage.getItem("patchwork-agent:chatgpt-pending")) }
}

/** A token endpoint that answers an authorization code as OpenAI does. */
function tokenEndpoint({ clientId = "oaiapp_made_up", nonce, sub = "user-1", scope = ALL_SCOPES, claims = {} } = {}) {
  return vi.fn(async (url, init) => {
    const form = new URLSearchParams(String(init.body))
    if (form.get("grant_type") !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400)
    return json({
      access_token: jwt({ exp: SECONDS() + 3600 }),
      refresh_token: "refresh-1",
      id_token: jwt({ iss: "https://auth.openai.com", aud: clientId, sub, email: "someone@example.test", exp: SECONDS() + 600, nonce, ...claims }),
      token_type: "Bearer",
      expires_in: 3600,
      scope,
    })
  })
}

describe("beginning a sign-in", () => {
  it("registers Patchwork the first time, with PKCE, a host id, and every scope plan use needs", async () => {
    const { url, params, pending } = await begun()
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize")
    expect(Object.fromEntries(params)).toMatchObject({
      client_id: "dynamic_agent_client",
      agent_name_hint: "Patchwork",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      scope: ALL_SCOPES,
      resource: "https://api.openai.com/v1",
      code_challenge_method: "S256",
      state: pending.state,
      nonce: pending.nonce,
    })
    expect(params.get("code_challenge")).toBe(await auth.challengeOf(pending.verifier))
    expect(params.get("ext_agent_host_id")).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
    // The same host id every time on this device.
    expect(auth.hostId(storage)).toBe(params.get("ext_agent_host_id"))
  })

  it("signs a returning account in to its registration, with the hints, and without naming the app again", async () => {
    storage.setItem("patchwork-agent:chatgpt", JSON.stringify({ clientId: "oaiapp_made_up", idToken: "old.id.token", email: "someone@example.test" }))
    const { params } = await begun({ registration: { clientId: "oaiapp_made_up", email: "someone@example.test" } })
    expect([params.get("client_id"), params.get("agent_name_hint"), params.get("id_token_hint"), params.get("login_hint")]).toEqual([
      "oaiapp_made_up",
      null,
      "old.id.token",
      "someone@example.test",
    ])
  })

  it("keeps using an attempt still fresh, so the address from the other tab still answers it", async () => {
    const first = await begun()
    const second = await begun()
    expect(second.params.get("state")).toBe(first.params.get("state"))
    const later = await begun({ now: Date.now() + auth.PENDING_MS + 1 })
    expect(later.params.get("state")).not.toBe(first.params.get("state"))
  })

  it("is waiting only once the person has gone to ChatGPT with it", async () => {
    await begun()
    expect(auth.status(storage).pending).toBe(false)
    auth.opened(storage)
    expect(auth.status(storage).pending).toBe(true)
    auth.cancel(storage)
    expect(auth.status(storage).pending).toBe(false)
  })
})

describe("finishing it from the pasted address", () => {
  it("reads the whole address or only its query", () => {
    expect(auth.parseCallback("http://127.0.0.1:1455/auth/callback?code=c&state=s")).toEqual({ code: "c", state: "s" })
    expect(auth.parseCallback("?code=c&state=s")).toEqual({ code: "c", state: "s" })
    expect(() => auth.parseCallback("  ")).toThrow(/Paste the address/)
  })

  it("exchanges the code with the verifier, checks the ID token, and keeps the sign-in on this device", async () => {
    const { pending } = await begun()
    const fetchImpl = tokenEndpoint({ nonce: pending.nonce })
    const record = await auth.finish(`http://127.0.0.1:1455/auth/callback?code=made-up&state=${pending.state}&client_id=oaiapp_made_up`, { storage, fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://auth.openai.com/api/accounts/oauth/token")
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_made_up",
      code: "made-up",
      code_verifier: pending.verifier,
      redirect_uri: "http://127.0.0.1:1455/auth/callback",
      resource: "https://api.openai.com/v1",
    })
    expect(record).toMatchObject({ clientId: "oaiapp_made_up", subject: "user-1", email: "someone@example.test", refreshToken: "refresh-1" })
    expect(auth.status(storage)).toMatchObject({ signedIn: true, planEnabled: true, email: "someone@example.test", pending: false })
    expect(storage.getItem("patchwork-agent:chatgpt-pending")).toBeNull()
  })

  it("refuses an address from another attempt, a declined one, and one with no registration in it", async () => {
    const { pending } = await begun()
    const fetchImpl = vi.fn()
    await expect(auth.finish(`?code=c&state=other`, { storage, fetchImpl })).rejects.toThrow(/state does not match/)
    await expect(auth.finish(`?state=${pending.state}`, { storage, fetchImpl })).rejects.toThrow(/no sign-in code/)
    await expect(auth.finish(`?code=c&state=${pending.state}`, { storage, fetchImpl })).rejects.toThrow(/no client id/)
    await expect(auth.finish(`?error=access_denied&state=${pending.state}`, { storage, fetchImpl })).rejects.toThrow(/declined/)
    expect(fetchImpl).not.toHaveBeenCalled()
    // Declining ends the attempt.
    await expect(auth.finish(`?code=c&state=${pending.state}&client_id=x`, { storage, fetchImpl })).rejects.toThrow(/expired or was not started here/)
  })

  it("refuses a returning registration answered for another client", async () => {
    const { pending } = await begun({ registration: { clientId: "oaiapp_mine" } })
    await expect(auth.finish(`?code=c&state=${pending.state}&client_id=oaiapp_theirs`, { storage, fetchImpl: vi.fn() })).rejects.toThrow(/different registration/)
  })

  it("keeps nothing whose ID token is not this sign-in's", async () => {
    for (const [claims, says] of [
      [{ iss: "https://elsewhere.test" }, /not from OpenAI/],
      [{ aud: "oaiapp_other" }, /not for this registration/],
      [{ exp: SECONDS() - 10 }, /expired/],
      [{ nonce: "replayed" }, /nonce/],
    ]) {
      storage = memoryStorage()
      const { pending } = await begun()
      const fetchImpl = tokenEndpoint({ nonce: pending.nonce, claims })
      await expect(auth.finish(`?code=c&state=${pending.state}&client_id=oaiapp_made_up`, { storage, fetchImpl })).rejects.toThrow(says)
      expect(auth.readRecord(storage)).toBeNull()
    }
  })

  it("keeps a sign-in that did not grant plan use, and says so", async () => {
    const { pending } = await begun()
    const fetchImpl = tokenEndpoint({ nonce: pending.nonce, scope: "openid profile email offline_access" })
    await auth.finish(`?code=c&state=${pending.state}&client_id=oaiapp_made_up`, { storage, fetchImpl })
    expect(auth.status(storage)).toMatchObject({ signedIn: true, planEnabled: false })
    await expect(auth.accessToken({ storage, fetchImpl: vi.fn() })).rejects.toBeInstanceOf(auth.SignInNeeded)
  })
})

describe("a token for a run", () => {
  const signedIn = (over = {}) =>
    storage.setItem(
      "patchwork-agent:chatgpt",
      JSON.stringify({ clientId: "oaiapp_made_up", subject: "user-1", email: "someone@example.test", accessToken: "access-0", refreshToken: "refresh-0", expiresAt: Date.now() + 3600_000, scopes: ALL_SCOPES.split(" "), ...over })
    )
  const refreshEndpoint = (n = { i: 0 }) =>
    vi.fn(async (url, init) => {
      const form = new URLSearchParams(String(init.body))
      n.i++
      return json({ access_token: `access-${n.i}`, refresh_token: `refresh-${n.i}`, expires_in: 3600, scope: ALL_SCOPES, spent: form.get("refresh_token") })
    })

  it("is the one held while it has time left, with no request", async () => {
    signedIn()
    const fetchImpl = vi.fn()
    expect(await auth.accessToken({ storage, fetchImpl })).toBe("access-0")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("is renewed near its end, spending the refresh token once and keeping the replacement", async () => {
    signedIn({ expiresAt: Date.now() + 60_000 })
    const fetchImpl = refreshEndpoint()
    expect(await auth.accessToken({ storage, fetchImpl })).toBe("access-1")
    expect(Object.fromEntries(new URLSearchParams(String(fetchImpl.mock.calls[0][1].body)))).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_made_up",
      refresh_token: "refresh-0",
      resource: "https://api.openai.com/v1",
    })
    expect(auth.readRecord(storage)).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1", email: "someone@example.test", subject: "user-1" })
  })

  it("is renewed once however many ask at the same moment: each waits, reads again, and uses the new one", async () => {
    signedIn({ expiresAt: Date.now() + 60_000 })
    const fetchImpl = refreshEndpoint()
    const tokens = await Promise.all([1, 2, 3, 4].map(() => auth.accessToken({ storage, fetchImpl, locks: null })))
    expect(tokens).toEqual(["access-1", "access-1", "access-1", "access-1"])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("uses the browser's lock when there is one", async () => {
    signedIn({ expiresAt: Date.now() + 60_000 })
    const names = []
    const locks = { request: vi.fn(async (name, fn) => (names.push(name), fn())) }
    await auth.accessToken({ storage, fetchImpl: refreshEndpoint(), locks })
    expect(names).toEqual(["patchwork-agent:chatgpt-refresh"])
  })

  it("ends the sign-in when OpenAI says the refresh token is spent, keeping the registration", async () => {
    signedIn({ expiresAt: Date.now() - 1 })
    const fetchImpl = vi.fn(async () => json({ error: "refresh_token_reused" }, 400))
    await expect(auth.accessToken({ storage, fetchImpl })).rejects.toBeInstanceOf(auth.SignInNeeded)
    expect(auth.readRecord(storage)).toMatchObject({ clientId: "oaiapp_made_up", accessToken: null, refreshToken: null })
    expect(auth.status(storage).signedIn).toBe(false)
  })

  it("keeps the tokens through a network failure, which is an interruption", async () => {
    signedIn({ expiresAt: Date.now() - 1 })
    const err = await auth.accessToken({ storage, fetchImpl: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) }).catch((e) => e)
    expect(isInterruption(err)).toBe(true)
    expect(auth.readRecord(storage).refreshToken).toBe("refresh-0")
  })

  it("serves the token held until OpenAI's earliest renewal time", async () => {
    signedIn({ expiresAt: Date.now() + 60_000, earliestRefreshAt: Date.now() + 30_000 })
    const fetchImpl = vi.fn()
    expect(await auth.accessToken({ storage, fetchImpl })).toBe("access-0")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("needs a sign-in when there is none", async () => {
    await expect(auth.accessToken({ storage, fetchImpl: vi.fn() })).rejects.toBeInstanceOf(auth.SignInNeeded)
  })
})

describe("signing out", () => {
  it("revokes the refresh token, forgets the tokens, and keeps the registration for next time", async () => {
    storage.setItem("patchwork-agent:chatgpt", JSON.stringify({ clientId: "oaiapp_made_up", email: "someone@example.test", accessToken: "a", refreshToken: "r", idToken: "i", expiresAt: Date.now() + 1000, scopes: ALL_SCOPES.split(" ") }))
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }))
    expect(await auth.signOut({ storage, fetchImpl })).toEqual({ confirmed: true })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://auth.openai.com/api/accounts/oauth/revoke")
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ token: "r", token_type_hint: "refresh_token", client_id: "oaiapp_made_up" })
    expect(auth.readRecord(storage)).toMatchObject({ clientId: "oaiapp_made_up", accessToken: null, refreshToken: null, idToken: null })
    expect(auth.status(storage).signedIn).toBe(false)
  })

  it("says when OpenAI did not confirm, and forgets the tokens anyway", async () => {
    storage.setItem("patchwork-agent:chatgpt", JSON.stringify({ clientId: "c", refreshToken: "r", scopes: [] }))
    expect(await auth.signOut({ storage, fetchImpl: vi.fn(async () => Promise.reject(new TypeError("offline"))) })).toEqual({ confirmed: false })
    expect(auth.readRecord(storage).refreshToken).toBeNull()
  })

  it("forgets the registration too when asked", async () => {
    storage.setItem("patchwork-agent:chatgpt", JSON.stringify({ clientId: "c", refreshToken: "r", scopes: [] }))
    await auth.forget({ storage, fetchImpl: vi.fn(async () => new Response("", { status: 200 })) })
    expect(auth.readRecord(storage)).toBeNull()
  })
})
