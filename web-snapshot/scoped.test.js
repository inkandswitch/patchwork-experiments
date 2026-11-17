/**
 * web_capture in a research step: it works only through the context it is
 * handed, which is what its `scoped: true` promises the agent.
 *
 * The agent gives a research step's tools a confined context
 * (test-support/confined.js restates agent/scope.js `confine`), and admits a
 * plugin that declares `scoped: true` with that context and nothing more.
 * The agent's own tests hold its side: what is admitted, and with what. This
 * holds the plugin's: driven the way a research step drives it, over a repo
 * full of the person's documents each carrying a sentinel, with its `url`
 * set to every way of naming something it might be handed — by a page, by
 * its prompt, or by guessing — after each call:
 *
 *   I1  every document the repo was asked for is in the plan's ledger, and
 *       every read of one was at the heads the ledger recorded for it;
 *   I2  every document that changed was made in that call, or is the plan —
 *       and of the plan, only its ledger;
 *   I4  no request went to a refused host, reader target included, and each
 *       refused target was refused: an error, and nothing kept;
 *   and no sentinel is in the result, or in any URL, header or body sent;
 *   no result names a tool a research step does not have; it read no field
 *   of its context but the confined ones; and it never touched the
 *   platform's own fetch.
 *
 * Then, the parts: a capture lands in the ledger, says what it is, and
 * answers the next capture of the page from there without the network.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Repo, initSubduction, parseAutomergeUrl, interpretAsDocumentId, encodeHeads } from "@automerge/automerge-repo"
import { webCapture } from "./web-capture.js"
import { guardedFetch } from "./guard.js"
import { keepSource, readable } from "./keep.js"
import { confine, scopedRepo, CONFINED_KEYS } from "./test-support/confined.js"

await initSubduction()

const ORIGIN = "https://patchwork.test"
const READER = "https://reader.test/"
const SENTINEL = "SENTINEL"

const sameHeads = (a, b) => {
  const left = new Set(a ?? [])
  const right = new Set(b ?? [])
  return left.size === right.size && [...left].every((h) => right.has(h))
}

const idOf = (url) => {
  try {
    return interpretAsDocumentId(String(url ?? "").trim())
  } catch {
    return null
  }
}

/** Every spelling of one document the repo would open. */
function spellings(url) {
  const { documentId, binaryDocumentId } = parseAutomergeUrl(url)
  const hex = [...binaryDocumentId].map((b) => b.toString(16).padStart(2, "0")).join("")
  return {
    url,
    heads: `${url}#${encodeHeads(["00".repeat(32)])[0]}`,
    path: `${url}/x`,
    bare: documentId,
    uuid: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
  }
}

const json = (value) => JSON.stringify({ code: 200, data: value })

/**
 * The person's documents, a workflow plan with a ledger, the web, and a
 * research step's confined context over all of it.
 */
async function world() {
  const repo = new Repo({ network: [] })
  const make = (value) => {
    const handle = repo.create({})
    handle.change((d) => Object.assign(d, value))
    return handle
  }
  const user = {}
  user.subject = make({ title: `${SENTINEL}-subject`, content: `${SENTINEL} subject` })
  user.private = make({ "@patchwork": { type: "file" }, name: "private.md", content: `${SENTINEL} private` })
  user.root = make({ "@patchwork": { type: "folder" }, title: `${SENTINEL} root`, docs: [{ name: "private.md", type: "file", url: user.private.url }] })
  user.account = make({ title: `${SENTINEL} account`, rootFolderUrl: user.root.url })
  user.session = make({ "@patchwork": { type: "agent-session" }, turns: [{ role: "user", text: `${SENTINEL} what the person asked` }] })
  user.folder = make({ "@patchwork": { type: "folder" }, title: "Sources · Pack", docs: [{ name: "private.md", type: "file", url: user.private.url }] })
  user.plan = make({ "@patchwork": { type: "agent-workflow" }, title: "Pack", goal: `${SENTINEL} goal`, sourcesFolderUrl: user.folder.url, sources: {} })
  const scope = { kind: "web", ledgerUrl: user.plan.url, stepId: "research" }

  // What the research steps kept so far: a page of this step's.
  const ledger = {}
  ledger.source = (await keepSource({ repo: scopedRepo(repo, user.plan, { stepId: "research" }) }, { source: "https://web.test/kept", role: "extract", content: "# Kept\nfrom the web" })).ref.url

  const sent = []
  const handoff = `${ORIGIN}/automerge%3A${idOf(user.subject.url)}/x`
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])
  const response = (body, { url = "", type = "text/plain", status = 200 } = {}) => {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "OK",
      url,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
      body: { cancel() {} },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => new TextDecoder().decode(bytes),
    }
  }
  // A page whose rendering names every one of the person's documents and
  // loads an image from the origin's handoff route.
  const idsPage = `<html><body><h1>Ids</h1><p>${Object.values(user).map((h) => h.url).join(" ")}</p><img src="${handoff}"><img src="/ok.png"><link rel=stylesheet href="${ORIGIN}/s.css"></body></html>`
  const web = async (url, init = {}) => {
    sent.push({ url: String(url), init })
    const asReader = String(url).startsWith(READER)
    const target = asReader ? String(url).slice(READER.length) : String(url)
    if (target === "https://web.test/redirect") return response(`${SENTINEL} served by Patchwork's own origin`, { url: handoff, type: "text/html" })
    if (target === "https://web.test/bin") return response(new Uint8Array([0, 1, 2, 3, 80, 75]), { url: target, type: "application/octet-stream" })
    if (target === "https://web.test/ok.png") return response(PNG, { url: target, type: "image/png" })
    if (asReader && target === "https://web.test/ids") return response(json({ title: "Ids", url: target, html: idsPage }), { type: "application/json" })
    if (asReader) return response(json({ title: "Page", url: target, html: `<h1>Page</h1><p>words</p>` }), { type: "application/json" })
    // The page itself, asked directly, fails as CORS does in a browser.
    throw new TypeError("Failed to fetch")
  }
  const fetchImpl = guardedFetch({ fetch: web, deny: [ORIGIN] })

  // The runner's repo, recording every document asked for and every read.
  const asked = []
  const reads = []
  const ledgerHeads = (id) => [...(user.plan.doc().sources?.[id]?.heads ?? [])]
  const observed = (handle, id) => ({
    url: handle.url,
    documentId: handle.documentId,
    heads: () => handle.heads(),
    doc: () => (reads.push({ id, heads: handle.heads(), ledger: ledgerHeads(id) }), handle.doc()),
    view: (heads) => {
      const view = handle.view(heads)
      return { doc: () => (reads.push({ id, heads: [...heads], ledger: ledgerHeads(id) }), view.doc()) }
    },
    change: (fn) => handle.change(fn),
  })
  const recording = {
    find: async (url) => (asked.push(idOf(url)), observed(await repo.find(url), idOf(url))),
    create2: (...args) => repo.create2(...args),
  }
  // A runner's context with everything a full session has; confine keeps
  // what a research step gets.
  const full = {
    repo: recording,
    subject: user.subject.url,
    rootFolderUrl: user.root.url,
    accountDocHandle: user.account,
    sessionUrl: user.session.url,
    session: { url: user.session.url, doc: () => user.session.doc() },
    workflows: { repo },
    pageFetch: web,
    events: null,
    direct: false,
    reader: READER,
    fetchImpl,
    signal: undefined,
  }
  const ctx = await confine(full, scope)
  asked.length = 0
  return { repo, user, ledger, ctx, sent, asked, reads, handoff }
}

describe("web_capture, driven as a research step drives it, reaches only the web and its workflow's ledger", () => {
  let w
  const platform = []
  const originals = {}
  const hosts = () => [globalThis, globalThis.window].filter((g, i, all) => g && all.indexOf(g) === i)
  beforeAll(async () => {
    w = await world()
    for (const [i, g] of hosts().entries()) {
      originals[i] = g.fetch
      g.fetch = (url) => {
        platform.push(String(url))
        throw new Error("a tool used the platform's fetch")
      }
    }
  })
  afterAll(() => {
    for (const [i, g] of hosts().entries()) g.fetch = originals[i]
  })

  // Written from the rule (guard.js), not taken from it.
  const REFUSED_HOSTS = ["localhost", "127.0.0.1", "[::1]", "169.254.169.254", new URL(ORIGIN).host]
  const REFUSED_VALUES = ["origin handoff", "localhost", "loopback", "v6 loopback", "metadata", "redirect to the origin"]
  const KEPT_VALUES = ["a page full of ids", "a binary file", "an ordinary page"]
  /** What web_capture asks its context for beyond the confined fields, when someone else hands them over. */
  const OPTIONAL = ["progress", "session"]
  // Tools a research step does not have, which no result may send it to.
  const NOT_A_RESEARCH_TOOL = ["source_file", "doc_read", "doc_edit", "fs_read", "fs_write", "fs_edit", "web_import"]

  function values() {
    const out = {
      omitted: undefined,
      empty: "",
      "ledger source": w.ledger.source,
      "bare scheme": "automerge:",
      "origin handoff": w.handoff,
      localhost: "http://localhost/x",
      loopback: "http://127.0.0.1/x",
      "v6 loopback": "http://[::1]/x",
      metadata: "http://169.254.169.254/latest/meta-data",
      "redirect to the origin": "https://web.test/redirect",
      "a page full of ids": "https://web.test/ids",
      "a binary file": "https://web.test/bin",
      "an ordinary page": "https://web.test/page",
    }
    for (const [name, handle] of Object.entries(w.user)) {
      for (const [form, spelling] of Object.entries(spellings(handle.url))) out[`${name} as ${form}`] = spelling
    }
    return out
  }

  const heads = () => new Map(Object.values(w.repo.handles).filter((h) => h.doc()).map((h) => [h.documentId, h.heads().join()]))
  const withoutLedger = (plan) => JSON.stringify({ ...plan, sources: null })
  const userIds = () => new Set(Object.values(w.user).filter((h) => h !== w.user.plan).map((h) => h.documentId))

  it("holds I1, I2 and I4 for every value, reads only its confined context, and lets no sentinel out", async () => {
    let calls = 0
    for (const [name, value] of Object.entries(values())) {
      for (const again of [true, false]) {
        const label = `web_capture.url = ${name}${again ? " · again" : ""}`
        const before = heads()
        const entriesBefore = Object.keys(w.user.plan.doc().sources).length
        const planBefore = withoutLedger(w.user.plan.doc())
        w.asked.length = 0
        w.reads.length = 0
        w.sent.length = 0
        const made = new Set()
        const create2 = w.ctx.repo.create2
        const repo = { ...w.ctx.repo, create2: async () => { const h = await create2(); made.add(h.documentId); return h } }
        // Every field of the context the tool reads, recorded.
        const touched = new Set()
        const ctx = new Proxy({ ...w.ctx, repo }, { get: (target, key) => (touched.add(key), target[key]) })
        let output
        let failed = false
        try {
          output = (await webCapture.execute({ url: value, again }, ctx)).text
        } catch (err) {
          failed = true
          output = `Error: ${err?.message ?? err}`
        }
        calls++
        const ledger = w.user.plan.doc().sources

        // Only the confined context. Beyond it the tool asks for two fields
        // it uses when they are there — a person's `progress` (the view's)
        // and a full session's `session` — and here they are not.
        for (const key of touched) expect([...CONFINED_KEYS, ...OPTIONAL], `${label} read ctx.${String(key)}`).toContain(key)
        for (const key of OPTIONAL) expect(ctx[key]).toBe(undefined)

        // I1
        const after = heads()
        for (const id of w.asked) expect(Object.keys(ledger), `${label} read ${id}`).toContain(id)
        for (const read of w.reads.filter((r) => r.id !== w.user.plan.documentId)) {
          const atLedger = sameHeads(read.heads, read.ledger)
          const ownWrite = before.get(read.id) !== after.get(read.id) && sameHeads(read.heads, ledger[read.id]?.heads)
          expect(atLedger || ownWrite, `${label} read ${read.id} at heads the ledger did not record`).toBe(true)
        }

        // I2
        for (const [id, h] of after) {
          if (before.get(id) === h) continue
          const allowed = made.has(id) || id === w.user.plan.documentId
          expect(allowed, `${label} changed ${id}`).toBe(true)
          expect(userIds().has(id), `${label} changed a document of the person's`).toBe(false)
        }
        expect(withoutLedger(w.user.plan.doc()), `${label} changed the plan beyond its ledger`).toBe(planBefore)
        // Everything it made is in the ledger, as the step's.
        for (const id of made) expect(ledger[id], `${label} made ${id} outside the ledger`).toMatchObject({ by: "research" })

        // I4
        for (const { url } of w.sent) {
          const targets = url.startsWith(READER) ? [url, url.slice(READER.length)] : [url]
          for (const target of targets) {
            const { protocol, host } = new URL(target)
            expect(["http:", "https:"], `${label} sent ${target}`).toContain(protocol)
            expect(REFUSED_HOSTS, `${label} sent ${target}`).not.toContain(host)
          }
        }
        // And what is on the web is kept: the matrix is not passing by refusing everything.
        if (KEPT_VALUES.includes(name)) expect(failed, `${label}: ${output}`).toBe(false)
        if (REFUSED_VALUES.includes(name)) {
          expect(failed, `${label} was not refused: ${output}`).toBe(true)
          expect(Object.keys(ledger), `${label} kept something`).toHaveLength(entriesBefore)
        }

        for (const id of NOT_A_RESEARCH_TOOL) expect(output, `${label} names ${id}`).not.toMatch(new RegExp(`\\b${id}\\b`))
        const outbound = w.sent.map(({ url, init }) => [url, JSON.stringify(init.headers ?? {}), String(init.body ?? "")].join("\n")).join("\n")
        expect(output, `${label} output`).not.toContain(SENTINEL)
        expect(outbound, `${label} requests`).not.toContain(SENTINEL)
      }
    }
    expect(calls).toBeGreaterThan(70)
  }, 60000)

  it("and never reached for the platform's own fetch", () => {
    expect(platform).toEqual([])
  })
})

describe("web_capture in a research step", () => {
  it("lands in the ledger as a web-snapshot, reads back, and answers the next capture of the page from there", async () => {
    const w = await world()
    const out = await webCapture.execute({ url: "https://web.test/page" }, w.ctx)
    const id = idOf(out.doc.url)
    const entry = w.user.plan.doc().sources[id]
    expect(entry).toMatchObject({ url: out.doc.url, kind: "source", what: "web-snapshot", type: "web-snapshot", source: "https://web.test/page", engine: "reader-dom", by: "research", name: "Page" })
    expect(entry.chars).toBe("# Page\n\nwords".length)
    // Read through the step's own repo, as source_read reads it.
    const kept = await w.ctx.repo.find(out.doc.url)
    expect(readable(kept.doc())).toBe("# Page\n\nwords")
    // A kept snapshot is read-only to the step.
    expect(kept.change).toBe(undefined)

    w.sent.length = 0
    const again = await webCapture.execute({ url: "https://web.test/page" }, w.ctx)
    expect(again.text).toMatch(/^Already captured at automerge:\w+ \(\d\d:\d\d UTC\)\. source_read \{source:"automerge:\w+", offset:0\}\. Pass again:true for a new snapshot\.$/)
    expect(again.doc.url).toBe(out.doc.url)
    expect(w.sent).toEqual([])
  })

  it("is refused a document outside the ledger, whatever it is told", async () => {
    const w = await world()
    await expect(w.ctx.repo.find(w.user.private.url)).rejects.toThrow("Not one of this workflow's sources.")
    expect(w.asked).toEqual([])
  })
})
