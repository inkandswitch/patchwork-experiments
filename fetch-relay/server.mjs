/**
 * The relay as a plain Node server (Node 18 or later).
 *
 *   RELAY_KEY=… PORT=8787 node server.mjs
 *
 * Optional: RELAY_ORIGINS (comma-separated page origins allowed to call it),
 * RELAY_MAX_BYTES, RELAY_TIMEOUT_MS. Here names are resolved before each
 * fetch and refused if any address is private, as the agent's node runner
 * does. Put it behind TLS (a reverse proxy) for use from an https page.
 */

import { createServer } from "node:http"
import { lookup } from "node:dns/promises"
import { Readable } from "node:stream"
import { handle, LANES } from "./relay.js"

const port = Number(process.env.PORT ?? 8787)
const options = {
  fetch: (url, init) => fetch(url, init),
  key: process.env.RELAY_KEY || null,
  origins: process.env.RELAY_ORIGINS || null,
  maxBytes: process.env.RELAY_MAX_BYTES ? Number(process.env.RELAY_MAX_BYTES) : undefined,
  timeoutMs: process.env.RELAY_TIMEOUT_MS ? Number(process.env.RELAY_TIMEOUT_MS) : undefined,
  lookup: (host) => lookup(host, { all: true }),
}

if (!options.key) console.warn("RELAY_KEY is not set: anyone who finds this relay can use it.")

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`)
    if (url.pathname !== "/fetch" && !LANES[url.pathname] && req.method !== "OPTIONS") {
      res.writeHead(404, { "content-type": "text/plain" }).end("Patchwork fetch relay. GET /fetch?url=…")
      return
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value)
    // A page that goes away cancels the request upstream (a lane streams for minutes).
    const gone = new AbortController()
    res.on("close", () => gone.abort())
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS"
    const request = new Request(url.href, { method: req.method, headers, signal: gone.signal, ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" } : {}) })
    const response = await handle(request, options)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body) {
      res.end()
      return
    }
    // Streamed, not gathered: a lane's answer arrives over minutes.
    const body = Readable.fromWeb(response.body)
    body.on("error", () => res.destroy())
    body.pipe(res)
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" })
    res.end(String(err?.message ?? err))
  }
}).listen(port, () => console.log(`fetch relay on :${port}`))
