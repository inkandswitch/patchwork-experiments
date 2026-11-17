import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { checkTarget, guardedFetch, isPrivateAddress, Refused, SYNC_SERVERS, fetcher, assertTarget } from "./guard.js"
import { viewFetch } from "./snapshot/fetch.js"

/**
 * The guard is a table: every target is allowed or refused by rule, and the
 * rule is written out here rather than derived, so a test cannot agree with
 * a bug by sharing its arithmetic.
 */

const allowed = (url, policy) => checkTarget(url, policy) === null

// ------------------------------------------------------------------ IPv4

/** Every edge of every refused range, and the address just outside it. */
const V4_EDGES = [
  ["0.0.0.0", false],
  ["0.255.255.255", false],
  ["1.0.0.0", true],
  ["9.255.255.255", true],
  ["10.0.0.0", false],
  ["10.255.255.255", false],
  ["11.0.0.0", true],
  ["100.63.255.255", true],
  ["100.64.0.0", false],
  ["100.127.255.255", false],
  ["100.128.0.0", true],
  ["126.255.255.255", true],
  ["127.0.0.0", false],
  ["127.0.0.1", false],
  ["127.255.255.255", false],
  ["128.0.0.0", true],
  ["169.253.255.255", true],
  ["169.254.0.0", false],
  ["169.254.169.254", false],
  ["169.254.255.255", false],
  ["169.255.0.0", true],
  ["172.15.255.255", true],
  ["172.16.0.0", false],
  ["172.31.255.255", false],
  ["172.32.0.0", true],
  ["192.167.255.255", true],
  ["192.168.0.0", false],
  ["192.168.255.255", false],
  ["192.169.0.0", true],
  ["8.8.8.8", true],
]

const hex = (n) => n.toString(16)

/** The same address, every way a URL can spell it. */
function spellings(dotted) {
  const [a, b, c, d] = dotted.split(".").map(Number)
  return {
    dotted,
    decimal: String(a * 16777216 + b * 65536 + c * 256 + d),
    short: `${a}.${b * 65536 + c * 256 + d}`,
    hex: `0x${hex(a)}.0x${hex(b)}.0x${hex(c)}.0x${hex(d)}`,
    octal: [a, b, c, d].map((n) => `0${n.toString(8)}`).join("."),
    trailingDot: `${dotted}.`,
    mapped: `[::ffff:${dotted}]`,
    mappedHex: `[::ffff:${hex((a << 8) | b)}:${hex((c << 8) | d)}]`,
    mappedFull: `[0:0:0:0:0:ffff:${dotted}]`,
  }
}

describe("IPv4 addresses, in every spelling", () => {
  for (const [address, expected] of V4_EDGES) {
    for (const [form, host] of Object.entries(spellings(address))) {
      it(`${address} as ${form} (${host}) is ${expected ? "allowed" : "refused"}`, () => {
        expect(allowed(`http://${host}/x`)).toBe(expected)
      })
    }
  }
})

// ------------------------------------------------------------------ IPv6

const V6 = [
  ["[::]", false],
  ["[::1]", false],
  ["[0:0:0:0:0:0:0:1]", false],
  // IPv4-compatible addresses are judged by the IPv4 address inside them, so
  // ::2 is 0.0.0.2, which is in 0.0.0.0/8.
  ["[::2]", false],
  ["[::8.8.8.8]", true],
  ["[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", true],
  ["[fc00::]", false],
  ["[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", false],
  ["[fe00::]", true],
  ["[fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", true],
  ["[fe80::]", false],
  ["[fe80::1]", false],
  ["[febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", false],
  ["[fec0::]", false], // site-local
  ["[fec0::1]", false],
  ["[feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]", false],
  ["[ff00::]", true],
  ["[2001:4860:4860::8888]", true],
]

/**
 * IPv6 forms that carry an IPv4 address and reach it: each is judged by the
 * address inside, so every one is refused exactly when that IPv4 address is.
 * The prefix and where the 32 bits sit are written out per form.
 */
const CARRIERS = {
  compatible: ([a, b, c, d]) => `[::${a}.${b}.${c}.${d}]`,
  mapped: ([a, b, c, d]) => `[::ffff:${a}.${b}.${c}.${d}]`,
  siit: ([a, b, c, d]) => `[::ffff:0:${a}.${b}.${c}.${d}]`,
  nat64: ([a, b, c, d]) => `[64:ff9b::${a}.${b}.${c}.${d}]`,
  "nat64 hex": ([a, b, c, d]) => `[64:ff9b::${hex((a << 8) | b)}:${hex((c << 8) | d)}]`,
  "6to4": ([a, b, c, d]) => `[2002:${hex((a << 8) | b)}:${hex((c << 8) | d)}::]`,
  "6to4 with a host part": ([a, b, c, d]) => `[2002:${hex((a << 8) | b)}:${hex((c << 8) | d)}:1::1]`,
}

describe("IPv6 addresses", () => {
  it.each(V6)("%s allowed: %s", (host, expected) => {
    expect(allowed(`https://${host}/`)).toBe(expected)
  })

  it("reads the same addresses when a DNS answer spells them without brackets", () => {
    for (const [host, expected] of V6) {
      expect(isPrivateAddress(host.slice(1, -1))).toBe(!expected)
    }
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateAddress("fd12:3456::1")).toBe(true)
    expect(isPrivateAddress("93.184.216.34")).toBe(false)
  })

  for (const [form, spell] of Object.entries(CARRIERS)) {
    for (const [address, expected] of V4_EDGES) {
      const host = spell(address.split(".").map(Number))
      it(`${address} carried as ${form} (${host}) is ${expected ? "allowed" : "refused"}`, () => {
        expect(allowed(`http://${host}/`)).toBe(expected)
      })
    }
  }

  it("leaves a NAT64 or 6to4 prefix alone when it does not carry an address that way", () => {
    // Not the /96 NAT64 prefix (a nonzero hextet in the middle), and not 2002::/16.
    expect(isPrivateAddress("64:ff9b:1::a00:1")).toBe(false)
    expect(isPrivateAddress("2003:a00:1::")).toBe(false)
  })

  it("says an answer that is not an address is not one", () => {
    expect(isPrivateAddress("example.com")).toBe(null)
    expect(isPrivateAddress("1.2.3")).toBe(null)
    expect(isPrivateAddress("1:2:3")).toBe(null)
  })
})

// ------------------------------------------------------------------ names, origins, paths, schemes

describe("names for this machine", () => {
  it.each([
    ["localhost", false],
    ["localhost.", false],
    ["LOCALHOST", false],
    ["a.localhost", false],
    ["a.b.localhost.", false],
    ["notlocalhost", true],
    ["localhost.example.com", true],
    ["example.com", true],
  ])("%s allowed: %s", (host, expected) => {
    expect(allowed(`http://${host}:8080/`)).toBe(expected)
  })
})

describe("origins the runner denies", () => {
  const policy = { deny: ["https://patchwork.inkandswitch.com", "wss://subduction.sync.inkandswitch.com"] }

  it.each([
    ["https://patchwork.inkandswitch.com/", false],
    ["https://patchwork.inkandswitch.com/automerge%3Aabc/x", false],
    ["https://PATCHWORK.inkandswitch.com:443/x", false],
    ["https://subduction.sync.inkandswitch.com/", false],
    ["https://other.inkandswitch.com/", true],
    ["https://patchwork.inkandswitch.com.example.net/", true],
    ["https://patchwork.inkandswitch.com:8443/", true],
    // A trailing dot names the same host, fully qualified.
    ["https://patchwork.inkandswitch.com./x", false],
    ["https://PATCHWORK.inkandswitch.com.:443/x", false],
    ["https://subduction.sync.inkandswitch.com./", false],
    ["https://patchwork.inkandswitch.com../x", false],
    ["http://patchwork.inkandswitch.com/", true], // another origin: the scheme differs
  ])("%s allowed: %s", (url, expected) => {
    expect(allowed(url, policy)).toBe(expected)
  })

  it("reads a deny entry spelled with a trailing dot the same way", () => {
    expect(allowed("https://patchwork.inkandswitch.com/x", { deny: ["https://patchwork.inkandswitch.com."] })).toBe(false)
  })

  it.each([
    ["https://subduction.sync.inkandswitch.com/", false],
    ["https://sync3.automerge.org/", false],
    ["https://sync3.automerge.org./x", false],
    ["https://automerge.org/", true],
  ])("the sync servers every runner denies: %s allowed: %s", (url, expected) => {
    expect(allowed(url, { deny: SYNC_SERVERS })).toBe(expected)
  })
})

describe("paths that name a document", () => {
  it.each([
    ["/automerge:3FUxPV2rSarnxQqAbajGAKaCXXih", false],
    ["/x/automerge:abc/y", false],
    ["/AUTOMERGE:abc", false],
    ["/automerge%3Aabc", false],
    ["/automerge%253Aabc", false], // encoded twice
    ["/automerge%25253Aabc", false], // three times
    ["/x%2Fautomerge:abc", false], // a slash hidden in a segment
    ["/%E0%A4%A", false], // malformed: refused rather than guessed at
    ["/100%", false],
    ["/100%zz", false],
    ["/automerge%3", false],
    // A well-formed escape of a byte that is not UTF-8 is an ordinary path.
    ["/caf%E9.html", true],
    ["/files/r%E9sum%E9.pdf", true],
    ["/caf%C3%A9.html", true],
    ["/100%25", true], // a literal percent sign, escaped
    ["/automerge%3A%E9", false], // still a document, whatever follows
    ["/%E9/automerge%3Aabc", false],
    ["/%E9%2Fautomerge%3Aabc", false],
    ["/about-automerge:abc", true],
    ["/docs/automerge-repo", true],
    ["/search", true],
  ])("%s allowed: %s", (path, expected) => {
    expect(allowed(`https://example.com${path}`)).toBe(expected)
  })

  it("does not read the query, which is not a path", () => {
    expect(allowed("https://example.com/search?q=automerge:abc")).toBe(true)
  })
})

describe("schemes", () => {
  it.each([
    ["https://example.com/", true],
    ["http://example.com/", true],
    ["ftp://example.com/", false],
    ["data:text/html,hi", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["ws://example.com/", false],
    ["not a url", false],
    ["", false],
  ])("%s allowed: %s", (url, expected) => {
    expect(allowed(url)).toBe(expected)
  })
})

// ------------------------------------------------------------------ the fetch itself

/** A recording fetch that answers from a list of responses, in order. */
function scripted(responses) {
  const calls = []
  const send = async (url, init) => {
    calls.push({ url, init })
    const next = responses[calls.length - 1]
    if (!next) throw new Error(`unexpected request ${url}`)
    return next
  }
  return { calls, send }
}

const redirect = (to, status = 302) => ({
  status,
  ok: false,
  headers: { get: (name) => (name.toLowerCase() === "location" ? to : null) },
  body: { cancel() {} },
})
const ok = (url) => ({ status: 200, ok: true, url, headers: { get: () => null } })

describe("redirects in node, one checked hop at a time", () => {
  const hopUrl = (i) => `https://hop${i}.example.com/`

  for (let hops = 0; hops <= 5; hops++) {
    it(`follows a chain of ${hops} redirect${hops === 1 ? "" : "s"} to the end`, async () => {
      const responses = Array.from({ length: hops }, (_, i) => redirect(hopUrl(i + 1)))
      responses.push(ok(hopUrl(hops)))
      const { calls, send } = scripted(responses)
      const response = await guardedFetch({ fetch: send, direct: true })(hopUrl(0))
      expect(response.status).toBe(200)
      expect(calls.map((c) => c.url)).toEqual(Array.from({ length: hops + 1 }, (_, i) => hopUrl(i)))
      expect(calls.every((c) => c.init.redirect === "manual")).toBe(true)
    })

    for (let refusedAt = 1; refusedAt <= hops; refusedAt++) {
      it(`stops at a refused hop ${refusedAt} of ${hops}, without requesting it`, async () => {
        const responses = Array.from({ length: hops }, (_, i) =>
          redirect(i + 1 === refusedAt ? "http://169.254.169.254/latest/meta-data" : hopUrl(i + 1))
        )
        responses.push(ok(hopUrl(hops)))
        const { calls, send } = scripted(responses)
        await expect(guardedFetch({ fetch: send, direct: true })(hopUrl(0))).rejects.toBeInstanceOf(Refused)
        expect(calls).toHaveLength(refusedAt)
        expect(calls.some((c) => c.url.includes("169.254"))).toBe(false)
      })
    }
  }

  it("gives up after five redirects", async () => {
    const responses = Array.from({ length: 6 }, (_, i) => redirect(hopUrl(i + 1)))
    const { calls, send } = scripted(responses)
    await expect(guardedFetch({ fetch: send, direct: true })(hopUrl(0))).rejects.toThrow(/after 5 redirects/)
    expect(calls).toHaveLength(6)
  })

  it("resolves a relative Location against the hop that sent it", async () => {
    const { calls, send } = scripted([redirect("/next"), ok("https://example.com/next")])
    await guardedFetch({ fetch: send, direct: true })("https://example.com/a/b")
    expect(calls[1].url).toBe("https://example.com/next")
  })

  it("turns a POST answered with 303 into a GET with no body, as a browser does", async () => {
    const { calls, send } = scripted([redirect("https://example.com/done", 303), ok("https://example.com/done")])
    await guardedFetch({ fetch: send, direct: true })("https://example.com/form", { method: "POST", body: "x=1" })
    expect(calls[1].init.method).toBe("GET")
    expect(calls[1].init.body).toBeUndefined()
  })

  it("never sends a refused target at all", async () => {
    const { calls, send } = scripted([])
    await expect(guardedFetch({ fetch: send, direct: true })("http://127.1/")).rejects.toBeInstanceOf(Refused)
    expect(calls).toHaveLength(0)
  })
})

describe("redirects in a browser, which the platform follows", () => {
  it("refuses a final URL the guard would not have fetched, leaving the body unread", async () => {
    let cancelled = 0
    let read = 0
    const response = {
      status: 200,
      ok: true,
      url: "http://192.168.1.1/admin",
      headers: { get: () => null },
      body: { cancel: () => cancelled++ },
      arrayBuffer: async () => (read++, new ArrayBuffer(0)),
      text: async () => (read++, ""),
    }
    const { calls, send } = scripted([response])
    await expect(guardedFetch({ fetch: send })("https://example.com/r")).rejects.toBeInstanceOf(Refused)
    expect(calls[0].init.redirect).toBe("follow")
    expect(cancelled).toBe(1)
    expect(read).toBe(0)
  })

  it("hands back a response whose final URL is fine", async () => {
    const { send } = scripted([ok("https://example.com/final")])
    const response = await guardedFetch({ fetch: send })("https://example.com/r")
    expect(response.url).toBe("https://example.com/final")
  })

  it("refuses the page's own origin even when nothing else would", async () => {
    const { calls, send } = scripted([])
    const guarded = guardedFetch({ fetch: send, deny: ["https://patchwork.inkandswitch.com"] })
    await expect(guarded("https://patchwork.inkandswitch.com/automerge:abc")).rejects.toBeInstanceOf(Refused)
    expect(calls).toHaveLength(0)
    expect(guarded.policy.deny).toEqual(["https://patchwork.inkandswitch.com"])
  })
})

describe("DNS answers in node", () => {
  const answers = {
    "public.example.com": ["93.184.216.34", "2606:2800:220:1::1"],
    "mixed.example.com": ["93.184.216.34", "10.0.0.1", "93.184.216.35"],
    "v6private.example.com": ["2606:2800:220:1::1", "fd00::1"],
    "mapped.example.com": ["::ffff:127.0.0.1"],
  }
  // Every host the tests ask about has an answer here; any other is a lookup
  // that came back empty.
  const lookup = async (host) => (answers[host] ?? []).map((address) => ({ address }))

  it.each([
    ["public.example.com", true],
    ["mixed.example.com", false],
    ["v6private.example.com", false],
    ["mapped.example.com", false],
    ["unanswered.example.com", false], // no address at all is not "every address is public"
  ])("%s allowed: %s", async (host, expected) => {
    const { calls, send } = scripted([ok(`https://${host}/`)])
    const attempt = guardedFetch({ fetch: send, direct: true, lookup })(`https://${host}/`)
    if (expected) {
      await expect(attempt).resolves.toBeTruthy()
      expect(calls).toHaveLength(1)
    } else {
      await expect(attempt).rejects.toBeInstanceOf(Refused)
      expect(calls).toHaveLength(0)
    }
  })

  it("checks the name each redirect lands on, too", async () => {
    const { calls, send } = scripted([redirect("https://mixed.example.com/"), ok("https://mixed.example.com/")])
    await expect(guardedFetch({ fetch: send, direct: true, lookup })("https://public.example.com/")).rejects.toBeInstanceOf(Refused)
    expect(calls).toHaveLength(1)
  })

  it.each([
    ["an empty list", async () => []],
    ["nothing", async () => null],
  ])("refuses a name whose lookup returns %s", async (_, empty) => {
    const { calls, send } = scripted([ok("https://anything.example/")])
    await expect(guardedFetch({ fetch: send, direct: true, lookup: empty })("https://anything.example/")).rejects.toThrow(
      "Refused to fetch https://anything.example/: anything.example did not resolve."
    )
    expect(calls).toHaveLength(0)
  })

  it("does not look up an address that is already an address", async () => {
    let looked = 0
    const { send } = scripted([ok("https://93.184.216.34/")])
    await guardedFetch({ fetch: send, direct: true, lookup: async () => (looked++, []) })("https://93.184.216.34/")
    expect(looked).toBe(0)
  })
})

describe("no fetch without a guard", () => {
  it("refuses to build a guard around nothing", () => {
    expect(() => guardedFetch({})).toThrow(/needs the fetch it guards/)
  })
})

// ------------------------------------------------------------------ how this package wires it

describe("the fetch web_capture uses", () => {
  const guarded = guardedFetch({ fetch: async () => ok("https://example.com/") })

  it.each([
    ["no context", undefined],
    ["no fetch", {}],
    ["a fetch that is not a function", { fetchImpl: "fetch" }],
    ["the platform's fetch, which carries no policy", { fetchImpl: async () => ok("https://example.com/") }],
  ])("refuses to run with %s", (_, ctx) => {
    expect(() => fetcher(ctx)).toThrow(/No guarded fetch was provided/)
  })

  it("uses the agent's guarded fetch as it was given", () => {
    expect(fetcher({ fetchImpl: guarded })).toBe(guarded)
  })

  it("checks a target it hands the reader against that fetch's own policy", () => {
    const denying = guardedFetch({ fetch: async () => ok("x"), deny: ["https://patchwork.example.org"] })
    expect(() => assertTarget("https://patchwork.example.org/x", denying)).toThrow(Refused)
    expect(() => assertTarget("http://127.0.0.1/", denying)).toThrow(Refused)
    expect(() => assertTarget("https://example.com/", denying)).not.toThrow()
  })
})

describe("the fetch a person captures with, from the snapshot view", () => {
  const SYNC_ORIGINS = ["https://subduction.sync.inkandswitch.com", "https://sync3.automerge.org"]
  const PAGE = "https://patchwork.example.org"
  let sent

  beforeEach(() => {
    window.happyDOM.setURL(`${PAGE}/#doc`)
    sent = []
    // The platform's fetch, which a refused request must never reach.
    vi.stubGlobal("fetch", async (url, init) => {
      sent.push({ url, init })
      return ok(url)
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("refuses the page's own origin and every sync server, and lets the browser follow redirects", () => {
    expect(viewFetch().policy).toEqual({ deny: [PAGE, ...SYNC_ORIGINS], direct: false, dns: false })
  })

  it.each([
    `${PAGE}/x`,
    `${PAGE}/automerge%3A4NMNnkMhL8jXrdJ9jamS58PAVdXu/index.js`,
    "https://sync3.automerge.org/",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s without calling the platform's fetch", async (url) => {
    await expect(viewFetch()(url)).rejects.toBeInstanceOf(Refused)
    expect(sent).toEqual([])
  })

  it("sends anything else through the platform's fetch", async () => {
    await viewFetch()("https://example.com/")
    expect(sent.map((s) => s.url)).toEqual(["https://example.com/"])
  })
})
