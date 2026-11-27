import { describe, it, expect } from "vitest"
import { handle, corsHeaders, DEFAULTS, LANES } from "./relay.js"

/** A request to the relay, as a browser page would send it. */
function ask(target, { method = "GET", origin = "https://patchwork.test", key = null, headers = {} } = {}) {
  const h = new Headers(headers)
  if (origin) h.set("origin", origin)
  if (key) h.set("x-relay-key", key)
  return new Request(`https://relay.test/fetch${target == null ? "" : `?url=${encodeURIComponent(target)}`}`, { method, headers: h })
}

/** The web, as a table of URL -> response; every request recorded. */
function web(pages) {
  const sent = []
  const fetch = async (url, init) => {
    sent.push({ url, init })
    const page = pages[url]
    if (!page) return new Response("not here", { status: 404 })
    return typeof page === "function" ? page(init) : page()
  }
  return { fetch, sent }
}

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x80])

describe("relaying", () => {
  it("returns the site's bytes exactly, with its status and type, and where redirects ended", async () => {
    const { fetch } = web({
      "https://maker.test/sheet": () => new Response(null, { status: 302, headers: { location: "/files/sheet.pdf" } }),
      "https://maker.test/files/sheet.pdf": () => new Response(pdf, { status: 200, headers: { "content-type": "application/pdf", "set-cookie": "track=1" } }),
    })
    const response = await handle(ask("https://maker.test/sheet"), { fetch })
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf)
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("x-relay-final-url")).toBe("https://maker.test/files/sheet.pdf")
    expect(response.headers.get("set-cookie")).toBe(null)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("x-relay-error")).toBe(null)
  })

  it("passes on the site's own errors as the site's, not the relay's", async () => {
    const response = await handle(ask("https://maker.test/missing"), { fetch: web({}).fetch })
    expect([response.status, response.headers.get("x-relay-error")]).toEqual([404, null])
  })

  it("forwards only harmless headers, and never a cookie or credential", async () => {
    const { fetch, sent } = web({ "https://maker.test/": () => new Response("ok") })
    await handle(ask("https://maker.test/", { headers: { accept: "text/html", cookie: "session=1", authorization: "Bearer x", range: "bytes=0-9" } }), { fetch })
    expect(sent[0].init.headers).toEqual({ "user-agent": "PatchworkFetchRelay/1.0 (+https://www.inkandswitch.com/)", accept: "text/html", range: "bytes=0-9" })
    expect(sent[0].init.redirect).toBe("manual")
  })

  it("passes Brave's search key to Brave's API alone, and drops it when a redirect leaves", async () => {
    const BRAVE = "https://api.search.brave.com/res/v1/web/search?q=x"
    const { fetch, sent } = web({
      [BRAVE]: () => new Response("{}"),
      "https://maker.test/": () => new Response("ok"),
      "https://api.search.brave.com/moved": () => new Response(null, { status: 302, headers: { location: "https://maker.test/" } }),
    })
    const token = { "x-subscription-token": "brave-key" }
    await handle(ask(BRAVE, { headers: token }), { fetch })
    await handle(ask("https://maker.test/", { headers: token }), { fetch })
    await handle(ask("https://api.search.brave.com/moved", { headers: token }), { fetch })
    expect(sent.map((s) => [s.url, s.init.headers["x-subscription-token"] ?? null])).toEqual([
      [BRAVE, "brave-key"],
      ["https://maker.test/", null],
      ["https://api.search.brave.com/moved", "brave-key"],
      ["https://maker.test/", null],
    ])
  })

  it("answers HEAD without a body", async () => {
    const { fetch } = web({ "https://maker.test/": () => new Response("big", { headers: { "content-type": "text/html" } }) })
    const response = await handle(ask("https://maker.test/", { method: "HEAD" }), { fetch })
    expect([response.status, response.headers.get("content-type"), await response.text()]).toEqual([200, "text/html", ""])
  })
})

describe("refusing", () => {
  const refused = async (request, options) => {
    const response = await handle(request, { fetch: web({}).fetch, ...options })
    return { status: response.status, error: response.headers.get("x-relay-error") }
  }

  it("every private, local or non-web target, in any spelling", async () => {
    for (const target of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://10.1.2.3/",
      "http://192.168.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "file:///etc/passwd",
      "ftp://maker.test/",
      "https://other.test/automerge%3A4WWt6zLWShj2gB6n8b75kvwTUUHL",
    ]) {
      const { status, error } = await refused(ask(target))
      expect(status, target).toBe(403)
      expect(error, target).toMatch(/^refused /)
    }
  })

  it("a redirect to a private address, before following it", async () => {
    const { fetch, sent } = web({ "https://maker.test/": () => new Response(null, { status: 301, headers: { location: "http://169.254.169.254/" } }) })
    const response = await handle(ask("https://maker.test/"), { fetch })
    expect(response.status).toBe(403)
    expect(sent.map((s) => s.url)).toEqual(["https://maker.test/"])
  })

  it("a name that resolves to a private address, where names are resolved", async () => {
    const lookup = async (host) => (host === "sneaky.test" ? [{ address: "93.184.216.34" }, { address: "10.0.0.5" }] : [{ address: "93.184.216.34" }])
    expect((await refused(ask("https://sneaky.test/"), { lookup })).error).toMatch(/resolves to 10\.0\.0\.5/)
    expect((await refused(ask("https://nowhere.test/"), { lookup: async () => [] })).error).toMatch(/did not resolve/)
  })

  it("anything but GET and HEAD; a missing or wrong key; a page origin not allowed", async () => {
    expect((await refused(ask("https://maker.test/", { method: "POST" }))).status).toBe(405)
    expect((await refused(ask("https://maker.test/"), { key: "k" })).status).toBe(401)
    expect((await refused(ask("https://maker.test/", { key: "wrong" }), { key: "k" })).status).toBe(401)
    expect((await refused(ask("https://maker.test/", { origin: "https://evil.test" }), { origins: "https://patchwork.test" })).status).toBe(403)
    expect((await refused(ask(null))).status).toBe(400)
  })

  it("more than it will carry, whether the site says so or not", async () => {
    const big = new Uint8Array(1000)
    const declared = { "https://maker.test/": () => new Response(big, { headers: { "content-length": "1000" } }) }
    expect((await refused(ask("https://maker.test/"), { fetch: web(declared).fetch, maxBytes: 999 })).status).toBe(413)
    const streamed = { "https://maker.test/": () => new Response(new ReadableStream({ start(c) { c.enqueue(big); c.enqueue(big); c.close() } })) }
    expect((await refused(ask("https://maker.test/"), { fetch: web(streamed).fetch, maxBytes: 1500 })).status).toBe(413)
  })

  it("a site that does not answer in time", async () => {
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))
    const { status, error } = await refused(ask("https://slow.test/"), { fetch: hang, timeoutMs: 20 })
    expect([status, error]).toEqual([502, "no answer within 20 ms"])
  })

  it("too many redirects", async () => {
    const loop = { "https://maker.test/a": () => new Response(null, { status: 302, headers: { location: "/a" } }) }
    expect((await refused(ask("https://maker.test/a"), { fetch: web(loop).fetch })).status).toBe(508)
  })
})

describe("being called from a page", () => {
  it("answers a preflight, and lets the page read its headers", async () => {
    const response = await handle(ask("https://maker.test/", { method: "OPTIONS" }), { fetch: web({}).fetch })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-headers")).toMatch(/x-relay-key/)
    expect(response.headers.get("access-control-allow-headers")).toMatch(/x-subscription-token/)
    expect(corsHeaders("https://patchwork.test", null)["access-control-expose-headers"]).toMatch(/x-relay-final-url/)
  })

  it("names the allowed origin back, and nothing to a page not allowed", () => {
    expect(corsHeaders("https://patchwork.test", "https://patchwork.test, https://other.test")["access-control-allow-origin"]).toBe("https://patchwork.test")
    expect(corsHeaders("https://evil.test", ["https://patchwork.test"])).toBe(null)
    expect(corsHeaders(null, ["https://patchwork.test"])).toEqual({})
  })

  it("keeps its defaults for options a deployment left unset", async () => {
    const { fetch } = web({ "https://maker.test/": () => new Response("ok") })
    const response = await handle(ask("https://maker.test/"), { fetch, key: null, origins: null, maxBytes: undefined, timeoutMs: undefined, maxRedirects: Number.NaN })
    expect([response.status, await response.text()]).toEqual([200, "ok"])
  })

  it("has limits that a deployment can only tighten from sensible defaults", () => {
    expect(DEFAULTS).toEqual({ maxBytes: 50 * 1024 * 1024, timeoutMs: 30_000, maxRedirects: 5 })
  })
})

describe("lanes to model APIs", () => {
  /** A request to a lane, as the agent in a page sends it. */
  function onLane(path, { method = "POST", origin = "https://patchwork.test", key = null, headers = {}, body } = {}) {
    const h = new Headers(headers)
    if (origin) h.set("origin", origin)
    if (key) h.set("x-relay-key", key)
    return new Request(`https://relay.test${path}`, { method, headers: h, body })
  }
  const RESPONSES = "https://api.openai.com/v1/responses"

  it("sends the body and the token to the one fixed address, and nothing else of the page's", async () => {
    const { fetch, sent } = web({ [RESPONSES]: () => new Response("data: {}\n\n", { headers: { "content-type": "text/event-stream", "x-request-id": "req_1", "set-cookie": "x=1" } }) })
    const body = JSON.stringify({ model: "m", input: [], stream: true })
    const response = await handle(
      onLane("/openai/v1/responses?url=https://elsewhere.test/", { key: "k", body, headers: { authorization: "Bearer tok", "content-type": "application/json", cookie: "s=1", "x-subscription-token": "brave" } }),
      { fetch, key: "k" }
    )
    expect(sent.map((s) => s.url)).toEqual([RESPONSES])
    expect(sent[0].init.method).toBe("POST")
    expect(sent[0].init.redirect).toBe("manual")
    expect(sent[0].init.headers).toEqual({ "user-agent": "PatchworkFetchRelay/1.0 (+https://www.inkandswitch.com/)", authorization: "Bearer tok", "content-type": "application/json" })
    expect(new TextDecoder().decode(sent[0].init.body)).toBe(body)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe("data: {}\n\n")
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    expect(response.headers.get("x-request-id")).toBe("req_1")
    expect(response.headers.get("set-cookie")).toBe(null)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("streams the answer as it comes, not once it has all come", async () => {
    let finish
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"))
        finish = () => {
          controller.enqueue(new TextEncoder().encode("data: last\n\n"))
          controller.close()
        }
      },
    })
    const { fetch } = web({ [RESPONSES]: () => new Response(upstream, { headers: { "content-type": "text/event-stream" } }) })
    const response = await handle(onLane("/openai/v1/responses", { body: "{}" }), { fetch })
    const reader = response.body.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n")
    finish()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: last\n\n")
  })

  it("passes the API's refusals on as the API's, with what to wait", async () => {
    const { fetch } = web({ [RESPONSES]: () => new Response('{"error":{"message":"slow down"}}', { status: 429, headers: { "content-type": "application/json", "retry-after": "3" } }) })
    const response = await handle(onLane("/openai/v1/responses", { body: "{}" }), { fetch })
    expect([response.status, response.headers.get("retry-after"), response.headers.get("x-relay-error")]).toEqual([429, "3", null])
  })

  it("takes only its own method, and only with the key", async () => {
    const { fetch, sent } = web({ "https://api.openai.com/v1/models": () => new Response("{}") })
    expect((await handle(onLane("/openai/v1/models", { method: "POST", body: "{}", key: "k" }), { fetch, key: "k" })).status).toBe(405)
    expect((await handle(onLane("/openai/v1/responses", { method: "GET", key: "k" }), { fetch, key: "k" })).status).toBe(405)
    expect((await handle(onLane("/openai/v1/models", { method: "GET" }), { fetch, key: "k" })).status).toBe(401)
    expect((await handle(onLane("/openai/v1/models", { method: "GET", key: "wrong" }), { fetch, key: "k" })).status).toBe(401)
    expect(sent).toEqual([])
    expect((await handle(onLane("/openai/v1/models", { method: "GET", key: "k" }), { fetch, key: "k" })).status).toBe(200)
  })

  it("refuses a body past maxBytes, and does not follow a redirect", async () => {
    const { fetch, sent } = web({ [RESPONSES]: () => new Response(null, { status: 307, headers: { location: "https://elsewhere.test/" } }) })
    expect((await handle(onLane("/openai/v1/responses", { body: "x".repeat(20) }), { fetch, maxBytes: 10 })).status).toBe(413)
    expect(sent).toEqual([])
    const redirected = await handle(onLane("/openai/v1/responses", { body: "{}" }), { fetch })
    expect(redirected.status).toBe(502)
    expect(sent.map((s) => s.url)).toEqual([RESPONSES])
  })

  it("answers a page's preflight for the token and the key", async () => {
    const response = await handle(onLane("/openai/v1/responses", { method: "OPTIONS" }), { fetch: web({}).fetch })
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-methods")).toBe("POST")
    expect(response.headers.get("access-control-allow-headers")).toMatch(/authorization/)
    expect(response.headers.get("access-control-allow-headers")).toMatch(/x-relay-key/)
  })

  it("goes only to OpenAI's API, over https", () => {
    for (const lane of Object.values(LANES)) expect(lane.target).toMatch(/^https:\/\/api\.openai\.com\/v1\//)
  })
})
