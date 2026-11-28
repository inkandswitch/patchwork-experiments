/** What a provider says about its models, cached: which there are, what each takes, and what it costs. */

import { getProvider } from "./index.js"

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

export async function modelInfo(providerId, modelId, { key = null, fetchImpl = undefined } = {}) {
  if (!modelId) return null
  const memoKey = `${providerId}:${modelId}`
  if (infoMemo.has(memoKey)) return infoMemo.get(memoKey)

  let info = null
  try {
    let { models } = await loadCatalogue(providerId, { key, fetchImpl })
    info = models.find((m) => m.id === modelId) ?? null
    // A catalogue cached before `supports` or `efforts` existed has the model
    // but not what this needs; refresh once rather than wait a day for the TTL.
    if (info && (info.supports === undefined || info.efforts === undefined)) {
      ;({ models } = await loadCatalogue(providerId, { key, force: true, fetchImpl }))
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

/**
 * Load the catalogue, from cache when it is fresh enough. `fetchImpl`, when
 * given, is what the provider asks with (a browser's lane through the relay).
 */
export async function loadCatalogue(providerId, { force = false, key = null, fetchImpl = undefined } = {}) {
  const cached = readCatalogue(providerId)
  if (cached && !cached.stale && !force) return { models: cached.models, cached: true }

  const provider = getProvider(providerId)
  if (typeof provider.models !== "function") {
    return { models: cached?.models ?? [], cached: true }
  }

  try {
    const models = await provider.models(fetchImpl ? { key, fetchImpl } : { key })
    writeCatalogue(providerId, models)
    return { models, cached: false }
  } catch (err) {
    // Offline, or the catalogue endpoint is down: a stale list beats none.
    if (cached) return { models: cached.models, cached: true, error: String(err?.message ?? err) }
    throw err
  }
}
