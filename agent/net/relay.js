/**
 * Fetching through a relay (fetch-relay/ in this repo).
 *
 * A page cannot read most sites (CORS), so without help a browser's agent
 * keeps a reader's text of a page and rarely the PDF itself. A relay fetches
 * for it and hands back what the site sent; with one configured, a page's
 * tools and a browser pool's runs keep originals as a Node host's do.
 *
 * This is the `fetch` a page's or a run's guardedFetch wraps, so every target is still
 * checked by the guard first; the relay checks again, and follows redirects
 * itself, checking each hop. Only GET and HEAD go through it: anything else
 * is sent from the page as before.
 */

import { Interruption } from "./network.js"

/**
 * The one credential the relay carries, and the one host it is for: Brave's
 * key, so web_search works from a browser (Brave's API answers no page
 * directly). fetch-relay/relay.js has the same table and sends it nowhere else
 * either, redirects included; change them together.
 */
export const RELAYED_CREDENTIALS = { "api.search.brave.com": ["x-subscription-token"] }

/** The credential headers `url`'s host may be sent. */
export function credentialsFor(url) {
  try {
    return RELAYED_CREDENTIALS[new URL(String(url)).hostname] ?? []
  } catch {
    return []
  }
}

/** A fetch that sends GET and HEAD through the relay `relay()` names, when it names one. */
export function relayFetch({ fetch: send, relay }) {
  if (typeof send !== "function") throw new Error("relayFetch needs the fetch it sends with.")
  return async function relayed(url, init = {}) {
    const config = typeof relay === "function" ? relay() : null
    const method = String(init.method ?? "GET").toUpperCase()
    if (!config?.url || (method !== "GET" && method !== "HEAD")) return send(url, init)

    const headers = {}
    const passed = ["accept", "accept-language", "range", ...credentialsFor(url)]
    for (const [name, value] of Object.entries(headerObject(init.headers))) {
      if (passed.includes(name.toLowerCase())) headers[name] = value
    }
    if (config.key) headers["x-relay-key"] = config.key
    let response
    try {
      response = await send(`${config.url}/fetch?url=${encodeURIComponent(String(url))}`, { method, headers, signal: init.signal })
    } catch (err) {
      // The relay is ours, and it answers for every site — a site that will
      // not answer comes back as x-relay-error below. So no answer from the
      // relay itself is this end's network, not the site: an interruption,
      // and the call runs again when the network is back (net/network.js).
      if (init.signal?.aborted) throw err
      throw new Interruption(`The fetch relay could not be reached (${err?.message ?? err})`, { cause: err })
    }

    const error = response.headers?.get?.("x-relay-error")
    if (error) throw new Error(`The fetch relay did not fetch ${url}: ${error}.`)
    return asFetched(response, response.headers?.get?.("x-relay-final-url") || String(url))
  }
}

/** The relay's response as the site's: the same body and status, at the URL redirects ended on. */
function asFetched(response, finalUrl) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: finalUrl,
    headers: response.headers,
    body: response.body,
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
    json: () => response.json(),
    relayed: true,
  }
}

function headerObject(headers) {
  if (!headers) return {}
  if (typeof headers.entries === "function" && !Array.isArray(headers)) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return headers
}
