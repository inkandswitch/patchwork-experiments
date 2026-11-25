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
