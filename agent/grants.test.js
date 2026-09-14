import { describe, it, expect } from "vitest"
import {
  initSession,
  needsApproval,
  grantKey,
  grantCandidates,
  grantCovering,
  grantOffers,
  urlPrefixes,
  callTarget,
  makeTurn,
  callBlock,
  CALL,
  findCall,
} from "./session.js"
import { decide } from "./loop.js"
import { memoryStore } from "./store.js"

const fresh = () => { const d = {}; initSession(d, {}); return d }
const editTool = { id: "doc_edit", risk: "write" }

describe("callTarget", () => {
  it("prefers an explicit url", () => {
    expect(callTarget({ input: { url: "automerge:a" } }, "automerge:subject")).toBe("automerge:a")
  })
  it("falls back to root, then to the session subject", () => {
    expect(callTarget({ input: { root: "automerge:r" } }, "automerge:s")).toBe("automerge:r")
    expect(callTarget({ input: {} }, "automerge:s")).toBe("automerge:s")
  })
  it("is null when nothing identifies a document", () => {
    expect(callTarget({ input: {} }, null)).toBeNull()
  })
})

describe("scoped grants", () => {
  it("a grant for one document does not cover another", () => {
    const doc = fresh()
    doc.grants[grantKey("doc_edit", "automerge:a")] = "session"

    const onA = { input: { url: "automerge:a" } }
    const onB = { input: { url: "automerge:b" } }

    expect(needsApproval(doc, editTool, onA)).toBe(false)
    expect(needsApproval(doc, editTool, onB)).toBe(true)
  })

  it("covers calls that fall back to the subject", () => {
    const doc = fresh()
    doc.grants[grantKey("doc_edit", "automerge:subject")] = "session"
    expect(needsApproval(doc, editTool, { input: {} }, "automerge:subject")).toBe(false)
    expect(needsApproval(doc, editTool, { input: {} }, "automerge:other")).toBe(true)
  })

  it("an unscoped grant no longer covers a document-targeted call", () => {
    // This is the behaviour change: approving the tool once must not hand it
    // every document you own.
    const doc = fresh()
    doc.grants.doc_edit = "session"
    expect(needsApproval(doc, editTool, { input: { url: "automerge:a" } })).toBe(true)
  })

  it("an unscoped grant still covers a tool that targets no document", () => {
    const doc = fresh()
    doc.grants.web_search = "session"
    expect(needsApproval(doc, { id: "web_search", risk: "external" }, { input: { query: "x" } })).toBe(false)
  })

  it("still lets read tools through and still always asks for alwaysAsk tools", () => {
    const doc = fresh()
    doc.grants[grantKey("tool_install", "automerge:a")] = "always"
    expect(needsApproval(doc, { id: "doc_read", risk: "read" }, { input: {} })).toBe(false)
    expect(
      needsApproval(doc, { id: "tool_install", risk: "external", alwaysAsk: true }, { input: { url: "automerge:a" } })
    ).toBe(true)
  })
})

describe("decide records the scoped grant", () => {
  function session() {
    const doc = fresh()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", { url: "automerge:a" }, { id: "c1" })]))
    return memoryStore(doc)
  }

  it("writes a tool@document key for a session grant", () => {
    const store = session()
    decide(store, "c1", "session")
    expect(store.doc().grants).toEqual({ "doc_edit@automerge:a": "session" })
  })

  it("uses the subject when the call names no document", () => {
    const doc = fresh()
    doc.turns.push(makeTurn("assistant", [callBlock("doc_edit", {}, { id: "c1" })]))
    const store = memoryStore(doc)
    decide(store, "c1", "session", "automerge:subject")
    expect(store.doc().grants["doc_edit@automerge:subject"]).toBe("session")
  })

  it("grants nothing for a one-off approval", () => {
    const store = session()
    decide(store, "c1", "once")
    expect(store.doc().grants).toEqual({})
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.approved)
  })

  it("grants nothing on a denial", () => {
    const store = session()
    decide(store, "c1", "deny")
    expect(store.doc().grants).toEqual({})
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.denied)
  })
})

// ------------------------------------------------------- subtree grants

describe("urlPrefixes", () => {
  it("walks up from a page to its origin", () => {
    expect(urlPrefixes("https://docs.python.org/3/library/os.html")).toEqual([
      "https://docs.python.org/3/library/",
      "https://docs.python.org/3/",
      "https://docs.python.org/",
    ])
  })

  it("treats a directory URL as its own innermost prefix", () => {
    expect(urlPrefixes("https://docs.python.org/3/library/")).toEqual([
      "https://docs.python.org/3/library/",
      "https://docs.python.org/3/",
      "https://docs.python.org/",
    ])
  })

  it("keeps the port and scheme, because they are part of the origin", () => {
    expect(urlPrefixes("http://localhost:8080/a/b")).toEqual(["http://localhost:8080/a/", "http://localhost:8080/"])
  })

  it("has nothing to say about a non-web target", () => {
    expect(urlPrefixes("automerge:2qMVfMqBCLg7JkLaaxr6oPmr2umh")).toEqual([])
    expect(urlPrefixes(null)).toEqual([])
  })
})

describe("a grant on a subtree", () => {
  const fetchTool = { id: "web_fetch", risk: "external" }
  const at = (url) => ({ input: { url } })

  function granted(key) {
    const doc = fresh()
    doc.grants[key] = "always"
    return doc
  }

  it("covers pages below it", () => {
    const doc = granted("web_fetch@https://docs.python.org/3/")
    expect(needsApproval(doc, fetchTool, at("https://docs.python.org/3/library/os.html"))).toBe(false)
    expect(needsApproval(doc, fetchTool, at("https://docs.python.org/3/"))).toBe(false)
  })

  it("does not cover pages beside it", () => {
    const doc = granted("web_fetch@https://docs.python.org/3/")
    expect(needsApproval(doc, fetchTool, at("https://docs.python.org/2/tutorial.html"))).toBe(true)
  })

  it("does not cover a different host, however similar the string", () => {
    // The attack this design exists to refuse: prefixes are built from parsed
    // path segments, so no amount of look-alike spelling matches.
    const doc = granted("web_fetch@https://example.com/")
    expect(needsApproval(doc, fetchTool, at("https://example.com.attacker.net/x"))).toBe(true)
    expect(needsApproval(doc, fetchTool, at("https://notexample.com/x"))).toBe(true)
    expect(needsApproval(doc, fetchTool, at("http://example.com/x"))).toBe(true) // scheme is part of the origin
  })

  it("is not fooled by a path that merely mentions another site", () => {
    const doc = granted("web_fetch@https://evil.test/")
    expect(needsApproval(doc, fetchTool, at("https://bank.test/?next=https://evil.test/"))).toBe(true)
  })

  it("ignores the fragment, which never changes what is fetched", () => {
    const doc = granted("web_fetch@https://docs.python.org/3/library/os.html")
    expect(needsApproval(doc, fetchTool, at("https://docs.python.org/3/library/os.html#os.walk"))).toBe(false)
  })

  it("treats the host case-insensitively", () => {
    const doc = granted("web_fetch@https://docs.python.org/")
    expect(needsApproval(doc, fetchTool, at("https://DOCS.Python.ORG/3/"))).toBe(false)
  })

  it("lets one grant cover the whole tool", () => {
    const doc = granted("web_fetch@*")
    expect(needsApproval(doc, fetchTool, at("https://anywhere.test/x"))).toBe(false)
    // …and only that tool.
    expect(needsApproval(doc, { id: "http_request", risk: "external" }, at("https://anywhere.test/x"))).toBe(true)
  })

  it("does not let a subtree grant leak into another tool", () => {
    const doc = granted("web_fetch@https://docs.python.org/")
    expect(needsApproval(doc, { id: "http_request", risk: "external" }, at("https://docs.python.org/3/"))).toBe(true)
  })

  it("still refuses a sensitive document however broad the grant", () => {
    const doc = granted("doc_edit@*")
    const edit = { id: "doc_edit", risk: "write" }
    expect(needsApproval(doc, edit, { input: { url: "automerge:ordinary" } })).toBe(false)
    expect(needsApproval(doc, edit, { input: { url: "automerge:settings" } }, null, ["automerge:settings"])).toBe(true)
  })

  it("names the grant that answered, so a decision can be explained", () => {
    const doc = granted("web_fetch@https://docs.python.org/")
    expect(grantCovering(doc, "web_fetch", "https://docs.python.org/3/x.html")).toBe(
      "web_fetch@https://docs.python.org/"
    )
    expect(grantCovering(doc, "web_fetch", "https://other.test/")).toBe(null)
  })
})

describe("the scopes offered to a human", () => {
  it("offers page, directory, site and anything for a web page", () => {
    const offers = grantOffers("web_fetch", "https://docs.python.org/3/library/os.html")
    expect(offers.map((o) => o.label)).toEqual(["this page", "/3/library/", "docs.python.org", "any site"])
    expect(offers.map((o) => o.key)).toEqual([
      "web_fetch@https://docs.python.org/3/library/os.html",
      "web_fetch@https://docs.python.org/3/library/",
      "web_fetch@https://docs.python.org/",
      "web_fetch@*",
    ])
  })

  it("does not offer the same scope twice for a directory URL", () => {
    const offers = grantOffers("web_fetch", "https://example.test/docs/")
    expect(offers.map((o) => o.label)).toEqual(["/docs/", "example.test", "any site"])
  })

  it("collapses to site and anything at the root of a site", () => {
    const offers = grantOffers("web_fetch", "https://example.test/")
    expect(offers.map((o) => o.label)).toEqual(["example.test", "any site"])
  })

  it("offers document scopes for a document target", () => {
    expect(grantOffers("doc_edit", "automerge:abc").map((o) => o.label)).toEqual(["this document", "any document"])
  })

  it("offers a single always for a call with no target", () => {
    expect(grantOffers("web_search", null)).toEqual([
      { key: "web_search", label: "always", detail: "every web_search call in this session" },
    ])
  })

  it("offers only scopes that would actually cover the call", () => {
    const target = "https://docs.python.org/3/library/os.html"
    const candidates = grantCandidates("web_fetch", target)
    for (const offer of grantOffers("web_fetch", target)) {
      expect(candidates).toContain(offer.key)
    }
  })
})

describe("deciding with a chosen scope", () => {
  function fetchCall() {
    const doc = fresh()
    doc.turns.push(
      makeTurn("assistant", [
        callBlock("web_fetch", { url: "https://docs.python.org/3/library/os.html" }, { id: "c1" }),
      ])
    )
    return memoryStore(doc)
  }

  it("stores the key the human picked, not the narrowest one", () => {
    const store = fetchCall()
    decide(store, "c1", { grant: "web_fetch@https://docs.python.org/" })

    expect(store.doc().grants).toEqual({ "web_fetch@https://docs.python.org/": "always" })
    expect(findCall(store.doc(), "c1").block.status).toBe(CALL.approved)
  })

  it("makes the next call in that subtree run without asking", () => {
    const store = fetchCall()
    decide(store, "c1", { grant: "web_fetch@https://docs.python.org/" })

    const next = { input: { url: "https://docs.python.org/3/tutorial/index.html" } }
    expect(needsApproval(store.doc(), { id: "web_fetch", risk: "external" }, next)).toBe(false)
  })
})
