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
