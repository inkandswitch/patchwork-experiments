/**
 * Provider registry.
 *
 * A provider is anything with `{ id, name, stream(request) }` where `stream`
 * returns an async iterable of neutral events:
 *
 *   { type: "text",      delta }
 *   { type: "reasoning", delta }
 *   { type: "call",      id, name, input }
 *   { type: "usage",     in, out, cached }
 *   { type: "stop",      reason }
 *
 * Adding a provider is adding a file here. Nothing else in the harness knows
 * which one is in use, which is the whole point — a session can change model
 * (or provider) between turns and keep going, because the transcript never
 * held a provider-specific shape.
 */

import openrouter from "./openrouter.js"
import { subscribe } from "../ui/providers.js"

const registry = new Map([[openrouter.id, openrouter]])

export function register(provider) {
  registry.set(provider.id, provider)
  return provider
}

export function getProvider(providerId) {
  const provider = registry.get(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)
  return provider
}

export function listProviders() {
  return [...registry.values()].map((p) => ({ id: p.id, name: p.name }))
}

// ---------------------------------------------------------------- credentials

/**
 * Keys live in the account's LLM settings, and never in the session document.
 *
 * A session document syncs to every peer it is shared with and to the sync
 * server; an API key in one would be handed to everyone who can open the doc.
 * Model and parameter choice DO belong in the document — they are part of the
 * session's meaning and should travel with it. The credential belongs to the
 * person instead.
 *
 * The account's LLM settings are the document the `llm` library's model picker
 * writes (`{ openrouter: { apiKey } }`), reached through the
 * `patchwork:tool-storage` provider under the library's id. That document is
 * private to the account and follows it across devices, and sharing it means a
 * key pasted into any LLM tool works in all of them.
 *
 * Finding it takes an element inside a mounted view (`connectAccountKeys`).
 * Until it is found, and anywhere it never will be (tests, a page outside
 * Patchwork), keys fall back to this device's localStorage; a key found there
 * once the account answers is moved across.
 */
const KEY_PREFIX = "patchwork-agent:key:"
const LLM_STORAGE_ID = "llm"
const ACCOUNT_TIMEOUT_MS = 3000

let accountSettings = null
let accountLookup = null
const keyListeners = new Set()

function accountKey(providerId) {
  const key = accountSettings?.doc()?.[providerId]?.apiKey
  return typeof key === "string" && key ? key : null
}

function localKey(providerId, storage) {
  try {
    return storage?.getItem(KEY_PREFIX + providerId) ?? null
  } catch {
    return null // private browsing, storage disabled, or a worker without access
  }
}

function writeLocalKey(providerId, key, storage) {
  try {
    if (key) storage?.setItem(KEY_PREFIX + providerId, key)
    else storage?.removeItem(KEY_PREFIX + providerId)
    return true
  } catch {
    return false
  }
}

function writeAccountKey(providerId, key) {
  accountSettings.change((d) => {
    if (!d[providerId]) d[providerId] = {}
    // The library defaults a missing key to "", so "" is what "none" looks like.
    d[providerId].apiKey = key || ""
  })
}

export function readKey(providerId, storage = globalThis.localStorage) {
  return accountKey(providerId) ?? localKey(providerId, storage)
}

export function writeKey(providerId, key, storage = globalThis.localStorage) {
  if (!accountSettings) return writeLocalKey(providerId, key, storage)
  writeAccountKey(providerId, key)
  // One copy, not two that drift: the account's is the one that is read.
  writeLocalKey(providerId, null, storage)
  return true
}

/**
 * The fetch relay this account uses, or null: `{ url, key }`.
 *
 * Kept where the API keys are, under a field of its own, for the same
 * reasons: the account's, every device of it, never a session's. A relay
 * fetches for a browser that may not, so the agent keeps the PDF or page
 * itself rather than a reader's text of it (fetch-relay/ in this repo).
 */
const RELAY_FIELD = "agentFetchRelay"
const RELAY_LOCAL = "patchwork-agent:relay"

export function readRelay(storage = globalThis.localStorage) {
  const own = accountSettings?.doc()?.[RELAY_FIELD]
  if (typeof own?.url === "string" && own.url) return { url: own.url, key: own.key || null }
  try {
    const local = JSON.parse(storage?.getItem(RELAY_LOCAL) ?? "null")
    return typeof local?.url === "string" && local.url ? { url: local.url, key: local.key || null } : null
  } catch {
    return null
  }
}

/** Set the relay (`{ url, key }`), or clear it with null. */
export function writeRelay(relay, storage = globalThis.localStorage) {
  const value = relay?.url ? { url: String(relay.url).trim().replace(/\/+$/, ""), key: relay.key ? String(relay.key) : "" } : null
  if (accountSettings) {
    accountSettings.change((d) => {
      if (value) d[RELAY_FIELD] = value
      else delete d[RELAY_FIELD]
    })
    try {
      storage?.removeItem(RELAY_LOCAL)
    } catch {
      /* nothing kept here */
    }
  } else {
    try {
      if (value) storage?.setItem(RELAY_LOCAL, JSON.stringify(value))
      else storage?.removeItem(RELAY_LOCAL)
    } catch {
      return false
    }
  }
  keysChanged()
  return true
}

/** Hear about keys changing, here or from another tool or device. */
export function onKeyChange(listener) {
  keyListeners.add(listener)
  return () => keyListeners.delete(listener)
}

function keysChanged() {
  for (const listener of [...keyListeners]) listener()
}

/**
 * Find the account's LLM settings, once per page. Resolves true when they were
 * found, false when nothing answered in time and keys stay on this device — in
 * which case the next caller tries again.
 */
export function connectAccountKeys(
  element,
  repo,
  { timeoutMs = ACCOUNT_TIMEOUT_MS, storage = globalThis.localStorage } = {}
) {
  accountLookup ??= new Promise((resolve) => {
    let settled = false
    let unsubscribe = () => {}
    const settle = (handle) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      if (!handle) {
        accountLookup = null
        resolve(false)
        return
      }
      accountSettings = handle
      for (const providerId of registry.keys()) {
        const local = localKey(providerId, storage)
        if (local && !accountKey(providerId)) {
          writeAccountKey(providerId, local)
          writeLocalKey(providerId, null, storage)
        }
      }
      handle.on("change", keysChanged)
      keysChanged()
      resolve(true)
    }
    const timer = setTimeout(() => settle(null), timeoutMs)
    unsubscribe = subscribe(element, { type: "patchwork:tool-storage", toolId: LLM_STORAGE_ID }, (url) => {
      if (!url) return
      Promise.resolve(repo?.find(url)).then(settle, () => settle(null))
    })
  })
  return accountLookup
}

/** Tests only: forget the account's settings. */
export function _resetAccountKeys() {
  accountSettings?.off?.("change", keysChanged)
  accountSettings = null
  accountLookup = null
  keyListeners.clear()
}

export function hasKey(providerId, storage = globalThis.localStorage) {
  return !!readKey(providerId, storage)
}

// ---------------------------------------------------------------- catalogue

const CATALOGUE_KEY = "patchwork-agent:models:"
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The model catalogue, cached per device.
 *
 * A few hundred models is a lot to fetch on every settings open, and the list
 * changes daily rather than hourly — so it is cached for a day and can always
 * be refreshed by hand.
 */
export function readCatalogue(providerId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CATALOGUE_KEY + providerId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.models) || !parsed.models.length) return null
    return { ...parsed, stale: Date.now() - (parsed.at ?? 0) > CATALOGUE_TTL_MS }
  } catch {
    return null
  }
}

export function writeCatalogue(providerId, models, storage = globalThis.localStorage) {
  try {
    storage?.setItem(CATALOGUE_KEY + providerId, JSON.stringify({ at: Date.now(), models }))
    return true
  } catch {
    return false // quota, private mode — the picker just falls back to fetching
  }
}

/**
 * What the catalogue knows about one model: its recommended defaults, the
 * parameters it accepts, and how much it can emit. Null when the catalogue
 * cannot be reached and has never been cached, or when the model is not in it
 * — a slug pasted the morning it was released, say. Everything that consumes
 * this treats null as "no opinion", never as an error.
 *
 * Memoized per process: a worker has no localStorage, so without this every
 * turn would refetch a few hundred models.
 */
const infoMemo = new Map()

export async function modelInfo(providerId, modelId, { key = null } = {}) {
  if (!modelId) return null
  const memoKey = `${providerId}:${modelId}`
  if (infoMemo.has(memoKey)) return infoMemo.get(memoKey)

  let info = null
  try {
    let { models } = await loadCatalogue(providerId, { key })
    info = models.find((m) => m.id === modelId) ?? null
    // A catalogue cached before `supports` or `efforts` existed has the model
    // but not what this needs; refresh once rather than wait a day for the TTL.
    if (info && (info.supports === undefined || info.efforts === undefined)) {
      ;({ models } = await loadCatalogue(providerId, { key, force: true }))
      info = models.find((m) => m.id === modelId) ?? null
    }
  } catch {
    info = null
  }
  if (info) infoMemo.set(memoKey, info)
  return info
}

/** Tests only: forget what was memoized. */
export function _resetModelInfo() {
  infoMemo.clear()
}

/** Load the catalogue, from cache when it is fresh enough. */
export async function loadCatalogue(providerId, { force = false, key = null } = {}) {
  const cached = readCatalogue(providerId)
  if (cached && !cached.stale && !force) return { models: cached.models, cached: true }

  const provider = getProvider(providerId)
  if (typeof provider.models !== "function") {
    return { models: cached?.models ?? [], cached: true }
  }

  try {
    const models = await provider.models({ key })
    writeCatalogue(providerId, models)
    return { models, cached: false }
  } catch (err) {
    // Offline, or the catalogue endpoint is down: a stale list beats none.
    if (cached) return { models: cached.models, cached: true, error: String(err?.message ?? err) }
    throw err
  }
}
