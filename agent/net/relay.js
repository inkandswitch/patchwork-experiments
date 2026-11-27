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
 *
 * Model APIs that answer no page at all (ChatGPT's plan route) go through the
 * relay's lanes instead: laneFetch, and throughRelay for a provider.
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

/**
 * Model APIs whose answers no page may read, and the relay's lane for each
 * (fetch-relay/relay.js LANES; change them together). ChatGPT's plan route
 * answers a page's request without CORS headers, so a page — or a browser
 * pool's run — reaches it only through a relay. Node reaches it directly.
 */
export const API_LANES = {
  "https://api.openai.com/v1/responses": "/openai/v1/responses",
  "https://api.openai.com/v1/models": "/openai/v1/models",
}

/** No relay set, and a browser cannot reach this API without one. */
export class RelayNeeded extends Error {
  constructor(host) {
    super(`${host} will not answer a web page directly, so in a browser the agent reaches it through the fetch relay. Set one in the agent's settings, under The web.`)
    this.name = "RelayNeeded"
    this.final = true
  }
}

/**
 * A fetch that sends API_LANES addresses through the relay `relay()` names,
 * the request as it was (method, body, token) plus the relay's key, and
 * everything else as `send` would. The answer is the API's own, streamed;
 * only the relay's own failures say so (x-relay-error).
 *
 * A failure is `final` when asking again cannot help: no relay, or the relay
 * refusing (a wrong key, say). The relay out of reach, or reporting the API
 * out of reach, is an interruption: the run waits for the network.
 */
export function laneFetch({ fetch: send, relay }) {
  if (typeof send !== "function") throw new Error("laneFetch needs the fetch it sends with.")
  return async function laned(url, init = {}) {
    const lane = API_LANES[String(url)]
    if (!lane) return send(url, init)
    const config = typeof relay === "function" ? relay() : relay
    const host = new URL(String(url)).host
    if (!config?.url) throw new RelayNeeded(host)

    const headers = { ...headerObject(init.headers) }
    if (config.key) headers["x-relay-key"] = config.key
    let response
    try {
      response = await send(`${config.url}${lane}`, { ...init, headers })
    } catch (err) {
      if (init.signal?.aborted) throw err
      throw new Interruption(`The fetch relay could not be reached (${err?.message ?? err})`, { cause: err })
    }
    const error = response.headers?.get?.("x-relay-error")
    if (!error) return response
    if (response.status === 502) throw new Interruption(`The fetch relay could not reach ${host} (${error})`)
    const refused = new Error(`The fetch relay refused to pass this on to ${host}: ${error}.`)
    refused.final = true
    throw refused
  }
}

/**
 * The provider with its requests sent by laneFetch: the addresses in
 * API_LANES through the relay, any other as before. For a browser; Node
 * reaches every API directly.
 */
export function throughRelay(provider, relay) {
  const fetchFor = (given) => laneFetch({ fetch: given ?? ((url, init) => fetch(url, init)), relay })
  return {
    ...provider,
    stream: (request) => provider.stream({ ...request, fetchImpl: fetchFor(request?.fetchImpl) }),
    ...(typeof provider.models === "function" ? { models: (opts = {}) => provider.models({ ...opts, fetchImpl: fetchFor(opts.fetchImpl) }) } : {}),
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
