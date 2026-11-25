import { describe, it, expect } from "vitest"
import { initSession, CALL, STATUS, _resetIds } from "../session/schema.js"
import { needsApproval, grantKey, grantCandidates, grantOffers, urlPrefixes, callTarget, callScope } from "../session/grants.js"
import { makeTurn, textBlock, callBlock } from "../session/blocks.js"
import { claimLease } from "../session/lease.js"
import { callsAwaitingApproval, findCall } from "../session/calls.js"
import { decide, run } from "../kernel/loop.js"
import { FULL_TOOLS as BUILTIN_TOOLS } from "../fixtures/tool-ids.js"
import { makeMock } from "../fixtures/mock-provider.js"
import { memoryStore } from "../kernel/store.js"
import { settled } from "../fixtures/session.js"

const fresh = () => { const d = {}; initSession(d, {}); return d }
// The real doc_edit says its url defaults to the session's subject; a fake
// that says nothing is about the url it is given and nothing else.
const editTool = { id: "doc_edit", risk: "write", target: { fields: ["url"], fallback: "subject" } }

describe("callTarget", () => {
  it("prefers an explicit url", () => {
    expect(callTarget({ input: { url: "automerge:a" } }, "automerge:subject")).toBe("automerge:a")
  })
  it("with no tool definition to consult, keeps the historical rule: url, root, then the subject", () => {
    expect(callTarget({ input: { root: "automerge:r" } }, "automerge:s")).toBe("automerge:r")
    expect(callTarget({ input: {} }, "automerge:s")).toBe("automerge:s")
  })
  it("is null when nothing identifies a document", () => {
    expect(callTarget({ input: {} }, null)).toBeNull()
  })
})

describe("what a call is about is the tool's to say", () => {
  const subject = "automerge:subject"

  it("does not assume the subject for a tool that says nothing", () => {
    expect(callTarget({ input: {} }, subject, { id: "some_plugin_tool", risk: "write" })).toBeNull()
    expect(callTarget({ input: { url: "automerge:a" } }, subject, { id: "some_plugin_tool", risk: "write" })).toBe("automerge:a")
  })

  it("lets a tool name its fields, in order, and its fallback", () => {
    const mount = { id: "view_mount", target: { fields: ["docUrl", "url"] } }
    expect(callTarget({ input: { docUrl: "automerge:d", url: "automerge:pkg" } }, subject, mount)).toBe("automerge:d")
    expect(callTarget({ input: { url: "automerge:pkg" } }, subject, mount)).toBe("automerge:pkg")
    expect(callTarget({ input: {} }, subject, mount)).toBeNull()

    const edit = { id: "doc_edit", target: { fields: ["url"], fallback: "subject" } }
    expect(callTarget({ input: {} }, subject, edit)).toBe(subject)
  })

  it("lets a tool say it is about nothing, whatever its input", () => {
    const search = { id: "web_search", target: "none" }
    expect(callTarget({ input: { query: "x", url: "https://a.test/" } }, subject, search)).toBeNull()
  })

  it("knows a root is a folder and a url is a document", () => {
    const write = { id: "fs_write", target: { fields: ["url", "root"] } }
    expect(callScope({ input: { root: "automerge:r", path: "a/b.js" } }, subject, write)).toEqual({ target: "automerge:r", kind: "folder" })
    expect(callScope({ input: { url: "automerge:f" } }, subject, write)).toEqual({ target: "automerge:f", kind: "document" })
    expect(callScope({ input: { path: "a/b.js" } }, subject, write)).toEqual({ target: null, kind: null })
  })

  it("is what the real tools declare", () => {
    const tools = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]))
    const about = (id, input) => callTarget({ input }, subject, tools.get(id))

    // Watched: every one of these was keyed on the subject, and the card said
    // "this document" about a call that never touched it.
    expect(about("web_search", { query: "petri nets" })).toBeNull()
    expect(about("fs_write", { path: "petri/tool.js", content: "" })).toBeNull()
    expect(about("doc_create", { datatype: "folder" })).toBeNull()
    expect(about("view_interact", { mountId: "m1", action: "click" })).toBeNull()
    expect(about("view_mount", { docUrl: "automerge:d" })).toBe("automerge:d")
    expect(about("tool_check", { url: "automerge:pkg", datatype: "x" })).toBe("automerge:pkg")

    // The ones that really do default to the subject still do.
    expect(about("doc_edit", { ops: [] })).toBe(subject)
    expect(about("doc_read", {})).toBe(subject)
  })
})

describe("the web search that granted the web", () => {
  // The bug in one test. A session open on a document; the model searches; the
  // card offers "this document" and "any document"; the user, asked about a
  // search, picks the broad one — and every web tool may now reach every site.
  const subject = "automerge:3H3XydHzrADXYsr6AmWvzStGSrMs"
  const tools = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]))
  const toolset = { get: (id) => tools.get(id) ?? null }

  it("no longer offers document scopes for a search, or writes web@* from one", () => {
    const search = tools.get("web_search")
    const block = callBlock("web_search", { query: "petri nets" }, { id: "c1" })
    const { target, kind } = callScope(block, subject, search)
    expect(target).toBeNull()
    expect(grantOffers("web_search", target, kind ?? "document").map((o) => o.key)).toEqual(["web_search"])

    const doc = fresh()
    doc.turns.push(makeTurn("assistant", [block]))
    const store = memoryStore(doc)
    decide(store, "c1", "always", subject, { toolset })
    expect(store.doc().grants).toEqual({ web_search: "always" })

    const fetchTool = tools.get("web_fetch")
    expect(needsApproval(store.doc(), fetchTool, { input: { url: "https://evil.example/x" } }, subject)).toBe(true)
  })

  it("says what 'any site' actually covers", () => {
    const offers = grantOffers("web_fetch", "https://docs.python.org/3/library/os.html")
    expect(offers.at(-1)).toEqual({ key: "web@*", label: "any site", detail: "every web fetch, capture, search and plain GET in this session" })
  })
})

describe("file tools share one grant", () => {
  const tools = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]))

  it("an fs_write grant on a folder covers an fs_edit under it, and the old key still works", () => {
    const doc = fresh()
    doc.grants["files@automerge:pkg"] = "always"
    expect(needsApproval(doc, tools.get("fs_edit"), { input: { root: "automerge:pkg", path: "a.js", edits: [{ op: "replace", find: "a", text: "b" }] } })).toBe(false)
    expect(needsApproval(doc, tools.get("fs_delete"), { input: { root: "automerge:other", path: "a.js" } })).toBe(true)

    const legacy = fresh()
    legacy.grants["fs_write@*"] = "always" // written before the grouping
    expect(needsApproval(legacy, tools.get("fs_write"), { input: { url: "automerge:f", content: "" } })).toBe(false)
  })

  it("offers folder scopes for a root, and says what 'any folder' covers", () => {
    const offers = grantOffers("fs_write", "automerge:pkg", "folder")
    expect(offers.map((o) => o.label)).toEqual(["this folder", "any folder"])
    expect(offers[0].detail).toBe("anything inside automerge:pkg")
    expect(offers[1]).toEqual({ key: "files@*", label: "any folder", detail: "every file write, edit, delete and filing in this session" })
  })

  it("offers a plain always for a write by path, which goes wherever the path says", () => {
    const write = tools.get("fs_write")
    const { target, kind } = callScope({ input: { path: "petri/tool.js", content: "" } }, "automerge:subject", write)
    expect(grantOffers("fs_write", target, kind ?? "document")).toEqual([
      { key: "fs_write", label: "always", detail: "every fs_write call in this session" },
    ])
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
})

describe("the scopes offered to a human", () => {
  it("offers page, directory, site and anything for a web page", () => {
    const offers = grantOffers("web_fetch", "https://docs.python.org/3/library/os.html")
    expect(offers.map((o) => o.label)).toEqual(["this page", "/3/library/", "docs.python.org", "any site"])
    // Keyed by GROUP, not by tool: "may you read docs.python.org" is one
    // decision, and it used to be asked once per web tool.
    expect(offers.map((o) => o.key)).toEqual([
      "web@https://docs.python.org/3/library/os.html",
      "web@https://docs.python.org/3/library/",
      "web@https://docs.python.org/",
      "web@*",
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

describe("one answer releases every call it covers", () => {
  // Watched: the model made three docs.python.org fetches in one turn, the user
  // granted the site on the first, and the other two went on sitting there
  // pending — approval is decided when a call is written and was never
  // reconsidered. Three clicks for one decision.
  const fetchTool = {
    id: "web_fetch",
    name: "Fetch",
    where: "worker",
    risk: "external",
    execute: async (input) => `fetched ${input.url}`,
  }
  const toolset = (tools) => {
    const byId = new Map(tools.map((t) => [t.id, t]))
    return { tools, schemas: [], get: (id) => byId.get(id) ?? null }
  }

  async function threeFetches() {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("fetch three pages")])]
    claimLease(doc, "local", Date.now())
    const store = memoryStore(doc)

    const provider = makeMock([
      [
        { type: "call", id: "c1", name: "web_fetch", input: { url: "https://docs.python.org/3/a.html" } },
        { type: "call", id: "c2", name: "web_fetch", input: { url: "https://docs.python.org/3/b.html" } },
        { type: "call", id: "c3", name: "web_fetch", input: { url: "https://docs.python.org/3/c.html" } },
      ],
      [{ type: "text", delta: "done" }],
    ])
    await run({ store, provider, toolset: toolset([fetchTool]), canRun: () => true, flushMs: 0 })
    return { store, provider }
  }

  it("asks once, not once per call", async () => {
    const { store, provider } = await threeFetches()
    expect(callsAwaitingApproval(store.doc())).toHaveLength(3)

    // One decision: yes, that site. The toolset is what lets it release the
    // others — and it has to happen here, because needsWork stands down while
    // anything awaits approval and a runner would never get a turn to notice.
    decide(store, "c1", { grant: "web@https://docs.python.org/" }, null, { toolset: toolset([fetchTool]) })
    expect(callsAwaitingApproval(store.doc())).toHaveLength(0)
    // …and the session stops claiming to be waiting for someone.
    expect(settled(store.doc())).toBe(STATUS.idle)

    await run({ store, provider, toolset: toolset([fetchTool]), canRun: () => true, flushMs: 0 })

    expect(callsAwaitingApproval(store.doc())).toHaveLength(0)
    for (const id of ["c1", "c2", "c3"]) {
      expect(findCall(store.doc(), id).block.status, id).toBe(CALL.done)
    }
  })

  it("leaves a call the grant does not cover still waiting", async () => {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("go")])]
    claimLease(doc, "local", Date.now())
    const store = memoryStore(doc)
    const provider = makeMock([
      [
        { type: "call", id: "c1", name: "web_fetch", input: { url: "https://docs.python.org/a" } },
        { type: "call", id: "c2", name: "web_fetch", input: { url: "https://elsewhere.test/b" } },
      ],
      [{ type: "text", delta: "done" }],
    ])
    await run({ store, provider, toolset: toolset([fetchTool]), canRun: () => true, flushMs: 0 })

    decide(store, "c1", { grant: "web@https://docs.python.org/" }, null, { toolset: toolset([fetchTool]) })
    await run({ store, provider, toolset: toolset([fetchTool]), canRun: () => true, flushMs: 0 })

    // Only ever loosens: the other site is a different decision.
    expect(callsAwaitingApproval(store.doc()).map((c) => c.id)).toEqual(["c2"])
    expect(settled(store.doc())).toBe(STATUS.awaitingApproval)
  })

  it("does nothing when no toolset is there to judge with", async () => {
    // decide() is called from probes and from other realms without one; it must
    // degrade to the old behaviour rather than throwing.
    const { store } = await threeFetches()
    decide(store, "c1", { grant: "web@https://docs.python.org/" })
    expect(callsAwaitingApproval(store.doc())).toHaveLength(2)
  })

  it("does not release a call that asks every time", async () => {
    _resetIds()
    const doc = {}
    initSession(doc, {})
    doc.turns = [makeTurn("user", [textBlock("go")])]
    doc.grants["web@*"] = "always"
    claimLease(doc, "local", Date.now())
    const store = memoryStore(doc)
    const asksAlways = { ...fetchTool, id: "http_request", alwaysAsk: () => true }
    const provider = makeMock([
      [{ type: "call", id: "c1", name: "http_request", input: { url: "https://x.test/" } }],
      [{ type: "text", delta: "done" }],
    ])
    await run({ store, provider, toolset: toolset([asksAlways]), canRun: () => true, flushMs: 0 })
    expect(callsAwaitingApproval(store.doc())).toHaveLength(1)
  })
})
