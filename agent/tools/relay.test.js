/**
 * Fetching through a relay (net/relay.js): what a tab sends, what it keeps.
 */

import { describe, it, expect } from "vitest"
import { relayFetch } from "../net/relay.js"
import { guardedFetch, Refused } from "../net/guard.js"
import { webFetch } from "./web.js"
import { httpRequest } from "./http.js"
import { isInterruption } from "../net/network.js"
import { runTool } from "../kernel/tool.js"

const RELAY = { url: "https://relay.test", key: "k" }
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00])

/** What the relay answers, as a real Response; every request it was sent recorded. */
function relayed(answer) {
  const sent = []
  const send = async (url, init) => {
    sent.push({ url, init })
    return answer(url, init)
  }
  return { send, sent }
}

function fakeRepo() {
  let n = 0
  const docs = new Map()
  const handle = (url) => ({ url, documentId: url.slice(10), doc: () => docs.get(url), change(fn) { fn(docs.get(url)) }, heads: () => [] })
  return {
    docs,
    async create2() {
      const url = `automerge:k${++n}`
      docs.set(url, {})
      return handle(url)
    },
    async find(url) {
      return handle(url)
    },
  }
}

describe("relayFetch", () => {
  it("sends a GET through the relay, with its key and only harmless headers, and answers as the site at the URL redirects ended on", async () => {
    const { send, sent } = relayed(() => new Response(pdf, { headers: { "content-type": "application/pdf", "x-relay-final-url": "https://site.test/files/cells.pdf" } }))
    const fetch = relayFetch({ fetch: send, relay: () => RELAY })
    const response = await fetch("https://site.test/cells", { headers: { accept: "application/pdf", cookie: "no", authorization: "no" } })
    expect(sent[0].url).toBe("https://relay.test/fetch?url=https%3A%2F%2Fsite.test%2Fcells")
    expect(sent[0].init.headers).toEqual({ accept: "application/pdf", "x-relay-key": "k" })
    expect([response.url, response.status, response.relayed]).toEqual(["https://site.test/files/cells.pdf", 200, true])
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf)
  })

  it("passes Brave's search key on to Brave's API, and to no other host", async () => {
    const { send, sent } = relayed(() => new Response("{}"))
    const fetch = relayFetch({ fetch: send, relay: () => RELAY })
    const headers = { accept: "application/json", "x-subscription-token": "brave-key" }
    await fetch("https://api.search.brave.com/res/v1/web/search?q=x", { headers })
    await fetch("https://site.test/", { headers })
    await fetch("https://search.brave.com/search?q=x", { headers })
    expect(sent.map((s) => s.init.headers)).toEqual([
      { accept: "application/json", "x-subscription-token": "brave-key", "x-relay-key": "k" },
      { accept: "application/json", "x-relay-key": "k" },
      { accept: "application/json", "x-relay-key": "k" },
    ])
  })

  it("sends anything else, and everything when no relay is set up, from the page as before", async () => {
    const { send, sent } = relayed(() => new Response("ok"))
    await relayFetch({ fetch: send, relay: () => RELAY })("https://api.test/x", { method: "POST", body: "{}" })
    await relayFetch({ fetch: send, relay: () => null })("https://site.test/", {})
    expect(sent.map((s) => s.url)).toEqual(["https://api.test/x", "https://site.test/"])
  })

  it("says when the relay itself refused, so it is not mistaken for the site's answer", async () => {
    const { send } = relayed(() => new Response("no", { status: 401, headers: { "x-relay-error": "missing or wrong x-relay-key" } }))
    await expect(relayFetch({ fetch: send, relay: () => RELAY })("https://site.test/")).rejects.toThrow(/The fetch relay did not fetch https:\/\/site\.test\/: missing or wrong x-relay-key/)
  })

  it("is still guarded: a private target is refused before the relay is asked", async () => {
    const { send, sent } = relayed(() => new Response("never"))
    const guarded = guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }), deny: ["https://patchwork.test"] })
    for (const target of ["http://169.254.169.254/", "http://localhost:3000/", "https://patchwork.test/automerge%3Aabc"]) {
      await expect(guarded(target)).rejects.toBeInstanceOf(Refused)
    }
    expect(sent).toEqual([])
  })

  it("is still guarded after: a relayed redirect that ended somewhere private is refused unread", async () => {
    const { send } = relayed(() => new Response("secret", { headers: { "x-relay-final-url": "http://10.0.0.1/" } }))
    const guarded = guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }) })
    await expect(guarded("https://site.test/")).rejects.toBeInstanceOf(Refused)
  })
})

describe("a tab with a relay keeps originals", () => {
  it("and where a site refuses the relay, keeps the reader's text instead, and says it is not the original", async () => {
    const { send } = relayed((url) => {
      const target = decodeURIComponent(new URL(url).searchParams.get("url"))
      if (target.startsWith("https://reader.test/")) return new Response("# Cells\n\nRated capacity 280Ah.", { headers: { "content-type": "text/plain", "x-relay-final-url": target } })
      return new Response("blocked", { status: 403, headers: { "content-type": "text/html", "x-relay-final-url": target } })
    })
    const repo = fakeRepo()
    const ctx = { fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }) }), direct: true, repo, reader: "https://reader.test/" }
    const out = await webFetch.execute({ url: "https://strict.test/cells" }, ctx)
    expect(out.text).toMatch(/The page itself could not be had \(http-error: HTTP 403\), so what is kept is the reader's text of it, not the original\./)
    expect(repo.docs.get(out.doc.url)).toMatchObject({ role: "extract" })
  })

  it("but a target the guard refuses is refused, not read another way", async () => {
    const { send, sent } = relayed(() => new Response("never"))
    const ctx = { fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }) }), direct: true, repo: fakeRepo(), reader: "https://reader.test/" }
    await expect(webFetch.execute({ url: "http://10.0.0.1/admin" }, ctx)).rejects.toBeInstanceOf(Refused)
    expect(sent).toEqual([])
  })

  it("web_fetch keeps the PDF itself, as a Node host would", async () => {
    const { send } = relayed(() => new Response(pdf, { headers: { "content-type": "application/pdf", "x-relay-final-url": "https://site.test/cells.pdf" } }))
    const repo = fakeRepo()
    const ctx = { fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }) }), direct: true, repo, reader: "https://reader.test/" }
    const out = await webFetch.execute({ url: "https://site.test/cells.pdf" }, ctx)
    const kept = repo.docs.get(out.doc.url)
    expect(kept).toMatchObject({ role: "primary", mimeType: "application/pdf", source: "https://site.test/cells.pdf" })
    expect(new Uint8Array(kept.content)).toEqual(pdf)
  })

  it("and a page as the site sent it, with its text beside it", async () => {
    const html = "<html><head><title>Cells</title></head><body><h1>LF280K</h1><p>Rated capacity 280Ah.</p><script>x()</script></body></html>"
    const { send } = relayed(() => new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "x-relay-final-url": "https://site.test/cells" } }))
    const repo = fakeRepo()
    const ctx = { fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: send, relay: () => RELAY }) }), direct: true, repo }
    const out = await webFetch.execute({ url: "https://site.test/cells" }, ctx)
    const kept = repo.docs.get(out.doc.url)
    expect(kept).toMatchObject({ role: "primary", mimeType: "text/html" })
    expect(String(kept.content)).toBe(html)
    expect(String(kept.text)).toMatch(/Rated capacity 280Ah/)
    expect(String(kept.text)).not.toMatch(/x\(\)/)
  })
})

describe("a relay that cannot be reached", () => {
  // The relay is ours, so not reaching it is the network being away: the call
  // had no effect and runs again when the network is back (net/network.js).
  const unreachable = async () => {
    throw new TypeError("Failed to fetch")
  }
  const ctx = () => ({ fetchImpl: guardedFetch({ fetch: relayFetch({ fetch: unreachable, relay: () => RELAY }) }), direct: true, repo: fakeRepo() })

  it("is an interruption to http_request, not a failed request", async () => {
    const attempt = httpRequest.execute({ url: "https://api.test/x" }, ctx())
    await expect(attempt).rejects.toSatisfy(isInterruption)
    expect(await runTool(httpRequest, { url: "https://api.test/x" }, ctx())).toMatchObject({ interrupted: true, isError: false })
  })

  it("while a request that fails at its target is still an error, with the CORS hint", async () => {
    const failing = async () => {
      throw new TypeError("Failed to fetch")
    }
    const direct = { fetchImpl: guardedFetch({ fetch: failing }), direct: false, repo: fakeRepo() }
    const result = await runTool(httpRequest, { url: "https://api.test/x" }, direct)
    expect(result).toMatchObject({ isError: true })
    expect(result.output).toMatch(/Request failed: .*CORS/)
  })
})
