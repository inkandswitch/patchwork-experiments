/**
 * The relay as a Cloudflare Worker.
 *
 *   wrangler deploy
 *   wrangler secret put RELAY_KEY        # strongly advised: without it the relay is open
 *
 * Optional variables: RELAY_ORIGINS (comma-separated page origins allowed to
 * call it), RELAY_MAX_BYTES, RELAY_TIMEOUT_MS. A Worker cannot resolve names
 * itself, and Cloudflare does not let a Worker's fetch reach private
 * addresses; the address checks in guard.js still refuse every private
 * spelling of a target and of each redirect.
 */

import { handle } from "./relay.js"

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/fetch" && request.method !== "OPTIONS") {
      return new Response("Patchwork fetch relay. GET /fetch?url=…", { status: 404 })
    }
    return handle(request, {
      fetch: (url, init) => fetch(url, init),
      key: env.RELAY_KEY || null,
      origins: env.RELAY_ORIGINS || null,
      maxBytes: env.RELAY_MAX_BYTES ? Number(env.RELAY_MAX_BYTES) : undefined,
      timeoutMs: env.RELAY_TIMEOUT_MS ? Number(env.RELAY_TIMEOUT_MS) : undefined,
    })
  },
}
