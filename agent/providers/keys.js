/** What the account holds for the agent: a key for each model provider, the search key, and the fetch relay. */

import { subscribe } from "../host/context.js"
import { listProviders } from "./index.js"

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
 * The key web_search uses (Brave's Search API), read and written with
 * readKey/writeKey under this id: the account's, like a provider's key, never
 * a session's.
 */
export const SEARCH_KEY_ID = "agentBraveSearch"

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
      for (const providerId of [...listProviders().map((provider) => provider.id), SEARCH_KEY_ID]) {
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
