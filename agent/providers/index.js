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
 * Keys live in localStorage, per device, and never in the session document.
 *
 * A session document syncs to every peer it is shared with and to the sync
 * server; an API key in one would be handed to everyone who can open the doc.
 * Model and parameter choice DO belong in the document — they are part of the
 * session's meaning and should travel with it. Only the credential stays local.
 */
const KEY_PREFIX = "patchwork-agent:key:"

export function readKey(providerId, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEY_PREFIX + providerId) ?? null
  } catch {
    return null // private browsing, storage disabled, or a worker without access
  }
}

export function writeKey(providerId, key, storage = globalThis.localStorage) {
  try {
    if (key) storage?.setItem(KEY_PREFIX + providerId, key)
    else storage?.removeItem(KEY_PREFIX + providerId)
    return true
  } catch {
    return false
  }
}

export function hasKey(providerId, storage = globalThis.localStorage) {
  return !!readKey(providerId, storage)
}
