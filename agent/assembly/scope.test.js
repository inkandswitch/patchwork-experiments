/**
 * A research step can keep what it finds and can reach nothing else.
 *
 * The claim (README, "Research steps keep things") is made of the session's
 * scope alone, so it is tested from the outside: a real repo full of the
 * person's documents, each carrying a sentinel, a research step's context
 * built by `confine` from a context that has every one of them, and every
 * tool the step has called with every way of naming something that it might
 * be handed — by a page, by its prompt, or by guessing. After each call:
 *
 *   I1  every document the repo was asked for is in the plan's ledger, and
 *       every read of one was at the heads the ledger recorded for it;
 *   I2  every document that changed was made in that call, is a finding in
 *       the ledger nobody else had edited, or is the plan — and of the plan,
 *       only its ledger;
 *   I4  no request went to a refused host, reader target included, and each
 *       refused target was refused: an error, and nothing kept;
 *   and no sentinel is in the result, or in any URL, header or body sent; and
 *   no result names a tool the step does not have.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { Repo, initSubduction, parseAutomergeUrl, interpretAsDocumentId, generateAutomergeUrl, encodeHeads } from "@automerge/automerge-repo"
import { initSession } from "../session/schema.js"
import { makeTurn, textBlock, callBlock, resultBlock } from "../session/blocks.js"
import { initPlan, STEP } from "../workflow/plan.js"
import { runTool } from "../kernel/tool.js"
import { BUILTIN_TOOLS } from "./builtin.js"
import { guardedFetch } from "../net/guard.js"
import { braveSearch } from "../tools/web.js"
import { keepSource } from "../tools/sources.js"
import { findingWrite } from "../tools/findings.js"
import { sourceRead } from "../tools/read-source.js"
import { confine, scopedRepo, scopeOf, assertScopeAgrees, webScope, sameScope, NOT_A_SOURCE, EDITED_OUTSIDE, ScopeRefusal } from "../kernel/scope.js"
import { KERNEL_TYPES, KERNEL_REFUSAL } from "../kernel/kernel-repo.js"
import { SCOPED_TOOL_IDS, researchToolset } from "../fixtures/tool-ids.js"

await initSubduction()

const ORIGIN = "https://patchwork.test"
const READER = "https://reader.test/"
const SENTINEL = "SENTINEL"

/** Heads as a set, as the ledger compares them. */
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

/**
 * The person's account, a workflow with a research step, and that step's
 * confined context. Everything the step must never reach carries SENTINEL.
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
  user.note = make({ "@patchwork": { type: "file" }, name: "n.md", content: `# ${SENTINEL} note\nwhat was learned` })
  user.notes = make({ "@patchwork": { type: "folder" }, title: "Agent notes", docs: [{ name: "n.md", type: "file", url: user.note.url }], "patchwork-agent-notes": true })
  user.private = make({ "@patchwork": { type: "file" }, name: "private.md", content: `${SENTINEL} private` })
  user.root = make({ "@patchwork": { type: "folder" }, title: `${SENTINEL} root`, docs: [{ name: "Agent notes", type: "folder", url: user.notes.url }, { name: "private.md", type: "file", url: user.private.url }] })
  user.skills = make({ "@patchwork": { type: "folder" }, title: "skills", docs: [] })
  user.modules = make({ title: `${SENTINEL} modules`, modules: [] })
  user.account = make({ title: `${SENTINEL} account`, rootFolderUrl: user.root.url })
  user.orchestrator = make({})
  user.orchestrator.change((d) => {
    initSession(d, { subject: user.subject.url })
    d.turns.push(makeTurn("user", [textBlock(`${SENTINEL} what the person asked`)]))
  })
  user.full = make({})
  user.full.change((d) => {
    initSession(d, { subject: user.subject.url })
    d.turns.push(makeTurn("assistant", [textBlock(`${SENTINEL} what a full step read`)]))
  })
  // A person linked a private document into the Sources folder by hand. The
  // folder is a view for people: it must grant the research steps nothing.
  user.folder = make({ "@patchwork": { type: "folder" }, title: "Sources · Pack", docs: [{ name: "private.md", type: "file", url: user.private.url }] })
  user.plan = make({})
  user.plan.change((d) => {
    initPlan(d, {
      title: "Pack",
      goal: "Choose a pack",
      subject: user.subject.url,
      sessionUrl: user.orchestrator.url,
      sourcesFolderUrl: user.folder.url,
      steps: [
        { id: "research", title: "R", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" },
        { id: "sibling", title: "S", prompt: "p", why: "w", where: "worker", tier: "fast", access: "web" },
        { id: "full", title: "F", prompt: "p", why: "w", where: "worker", tier: "fast" },
      ],
    })
    Object.assign(d.steps[2], { status: STEP.done, result: `${SENTINEL} full result`, sessionUrl: user.full.url })
  })
  const research = webScope(user.plan.url, "research")
  user.own = make({})
  user.own.change((d) => {
    initSession(d, {})
    d.scope = research
    d.turns.push(makeTurn("assistant", [callBlock("web_search", { query: "q" }, { id: "c1" })]))
    d.turns.push(makeTurn("tool", [resultBlock("c1", "what the search said")]))
  })
  user.sibling = make({})
  user.sibling.change((d) => {
    initSession(d, {})
    d.scope = webScope(user.plan.url, "sibling")
    d.turns.push(makeTurn("user", [textBlock(`${SENTINEL} sibling transcript`)]))
  })

  // What the research steps have kept so far: a page and a finding of this
  // step's, and a finding of its sibling's.
  const ledger = {}
  const mine = scopedRepo(repo, user.plan, { stepId: "research" })
  const sib = scopedRepo(repo, user.plan, { stepId: "sibling" })
  ledger.source = (await keepSource({ repo: mine }, { source: "https://web.test/kept", role: "extract", content: "# Kept\nfrom the web" })).ref.url
  ledger.finding = (await findingWrite.execute({ text: "mine" }, { repo: mine, scope: { stepId: "research" } })).doc.url
  ledger.sibling = (await findingWrite.execute({ text: "theirs" }, { repo: sib, scope: { stepId: "sibling" } })).doc.url
  // And one of the sibling's findings that a person has since edited by hand.
  ledger.edited = (await findingWrite.execute({ text: "theirs, then a person's" }, { repo: sib, scope: { stepId: "sibling" } })).doc.url
  ;(await repo.find(ledger.edited)).change((d) => { d.content = `${SENTINEL} a person's words` })

  // The web: a page whose body names the person's documents, a site that
  // redirects to Patchwork's own origin (whose answer carries a sentinel, so
  // keeping or showing it is seen), and a binary file. Every request that
  // reaches the network — beneath the guard — is recorded.
  const sent = []
  const handoff = `${ORIGIN}/automerge%3A${idOf(user.subject.url)}/x`
  const response = (body, { url = "", type = "text/plain" } = {}) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    url,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    async arrayBuffer() {
      return (typeof body === "string" ? new TextEncoder().encode(body) : body).buffer
    },
    async text() {
      return String(body)
    },
  })
  const web = async (url, init = {}) => {
    sent.push({ url: String(url), init })
    const target = String(url).startsWith(READER) ? String(url).slice(READER.length) : String(url)
    if (target === "https://web.test/redirect") return response(`${SENTINEL} served by Patchwork's own origin`, { url: handoff })
    if (target === "https://web.test/bin") return response(new Uint8Array([0, 1, 2, 3, 80, 75]), { url, type: "application/octet-stream" })
    if (target === "https://web.test/ids") {
      return response(`Title: Ids\n\n# Ids\n${Object.values(user).map((h) => h.url).join(" ")}\n![x](${handoff})`, { url })
    }
    return response("Title: Page\n\n# Page\nwords", { url })
  }
  const fetchImpl = guardedFetch({ fetch: web, deny: [ORIGIN] })

  // A runner's context with everything in it. Raw repo access is recorded by
  // the canonical id asked for, and every read of a document found, with the
  // heads it was read at and the heads the ledger had for it at that moment.
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
  const full = {
    repo: recording,
    subject: user.subject.url,
    rootFolderUrl: user.root.url,
    notesFolderUrl: user.notes.url,
    skillsFolderUrl: user.skills.url,
    accountDocHandle: user.account,
    contactUrl: user.account.url,
    moduleSettingsUrl: user.modules.url,
    sensitiveDocs: [user.modules.url, user.account.url],
    sessionUrl: user.own.url,
    element: {},
    getMount: () => null,
    workflows: { repo, startSession: () => null },
    session: { url: user.own.url, doc: () => user.own.doc(), change: (fn) => user.own.change(fn) },
    startStepSession: () => null,
    splice: () => null,
    pageFetch: web,
    events: null,
    direct: false,
    reader: READER,
    fetchImpl,
    search: braveSearch({ key: () => "brave-key", fetchImpl }),
    signal: undefined,
  }
  const ctx = await confine(full, research)
  asked.length = 0
  return { repo, user, ledger, ctx, full, sent, asked, reads, handoff, fetchImpl }
}

// ------------------------------------------------------------ the product

describe("whatever a research step is handed, it reaches only the web and its workflow's ledger", () => {
  let w
  let tools
  // The platform's own fetch, which no tool may use: every request must go
  // through the context's guarded one. Stubbed to say so and throw.
  const platform = []
  const originals = {}
  const hosts = () => [globalThis, globalThis.window].filter((g, i, all) => g && all.indexOf(g) === i)
  beforeAll(async () => {
    w = await world()
    tools = (await researchToolset()).tools
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

  // Written from the rule (guard.js), not taken from it: the hosts no request
  // may reach, and the values that name them, which a fetching tool must
  // refuse outright.
  const REFUSED_HOSTS = ["localhost", "127.0.0.1", "[::1]", "169.254.169.254", new URL(ORIGIN).host]
  const REFUSED_VALUES = ["origin handoff", "localhost", "loopback", "v6 loopback", "metadata", "redirect to the origin"]
  const FETCHING = ["web_fetch.url", "http_request.url"]
  const OTHER_TOOLS = BUILTIN_TOOLS.map((t) => t.id).filter((id) => !SCOPED_TOOL_IDS.includes(id))

  /** Every value a URL-ish field might be handed, by name. */
  function values() {
    const out = {
      omitted: undefined,
      empty: "",
      "ledger source": w.ledger.source,
      "ledger finding": w.ledger.finding,
      "sibling's finding": w.ledger.sibling,
      "sibling's finding, edited by a person": w.ledger.edited,
      "bare scheme": "automerge:",
      "origin handoff": w.handoff,
      localhost: "http://localhost/x",
      loopback: "http://127.0.0.1/x",
      "v6 loopback": "http://[::1]/x",
      metadata: "http://169.254.169.254/latest/meta-data",
      "redirect to the origin": "https://web.test/redirect",
      "a page full of ids": "https://web.test/ids",
      "a binary file": "https://web.test/bin",
    }
    for (const [name, handle] of Object.entries(w.user)) {
      for (const [form, spelling] of Object.entries(spellings(handle.url))) out[`${name} as ${form}`] = spelling
    }
    return out
  }

  /** The input a tool gets with `value` in `field`, and what else it needs to run. */
  const FIELDS = {
    web_search: [["query", (v) => ({ query: v ?? "q" })]],
    web_fetch: [["url", (v) => ({ url: v, fresh: true })]],
    http_request: [["url", (v) => ({ url: v })]],
    source_read: [["source", (v) => ({ source: v, limit: 40 })], ["find", (v) => ({ source: w.ledger.source, find: v ?? "x" })]],
    source_list: [["find", (v) => (v === undefined ? {} : { find: v })]],
    finding_write: [
      ["finding", (v) => ({ text: "more", finding: v })],
      ["cites", (v) => ({ text: "cited", cites: v === undefined ? undefined : [v] })],
    ],
    session_recall: [["callId", (v) => ({ callId: v })]],
    workflow_request: [
      ["why", (v) => ({ why: v, reopen: ["r"] })],
      ["reopen", (v) => ({ why: "found", reopen: v === undefined ? undefined : [v] })],
    ],
  }

  const heads = () => new Map(Object.values(w.repo.handles).filter((h) => h.doc()).map((h) => [h.documentId, h.heads().join()]))
  /** Each finding in the ledger: its live heads, and the heads the ledger recorded. */
  const findings = () =>
    new Map(
      Object.entries(w.user.plan.doc().sources)
        .filter(([, e]) => e.kind === "finding")
        .map(([id, e]) => [id, { live: w.repo.handles[id].heads(), recorded: [...e.heads] }])
    )
  const withoutLedger = (plan) => JSON.stringify({ ...plan, sources: null })
  const userIds = () => new Set(Object.values(w.user).filter((h) => h !== w.user.plan).map((h) => h.documentId))

  it("covers every tool it has", () => {
    expect(tools.map((t) => t.id).sort()).toEqual(Object.keys(FIELDS).sort())
  })

  it("holds I1, I2 and I4 for every tool, field and value, and lets no sentinel out", async () => {
    let calls = 0
    for (const tool of tools) {
      for (const [field, inputFor] of FIELDS[tool.id]) {
        for (const [name, value] of Object.entries(values())) {
          const label = `${tool.id}.${field} = ${name}`
          const before = heads()
          const findingsBefore = findings()
          const entriesBefore = Object.keys(w.user.plan.doc().sources).length
          const planBefore = withoutLedger(w.user.plan.doc())
          w.asked.length = 0
          w.reads.length = 0
          w.sent.length = 0
          const made = new Set()
          const create2 = w.ctx.repo.create2
          const outcome = await runTool(tool, inputFor(value), {
            ...w.ctx,
            recall: () => w.user.own.doc().turns,
            repo: { ...w.ctx.repo, create2: async () => { const h = await create2(); made.add(h.documentId); return h } },
          })
          calls++
          const ledger = w.user.plan.doc().sources

          // I1: asked for nothing outside the ledger, and read each thing at
          // the heads the ledger had for it — or, for what this call itself
          // wrote, at the heads it wrote. The plan is read too, but only by
          // the scoped repo, for its ledger: that is how it knows the rest.
          const after = heads()
          for (const id of w.asked) expect(Object.keys(ledger), `${label} read ${id}`).toContain(id)
          for (const read of w.reads.filter((r) => r.id !== w.user.plan.documentId)) {
            const atLedger = sameHeads(read.heads, read.ledger)
            const ownWrite = before.get(read.id) !== after.get(read.id) && sameHeads(read.heads, ledger[read.id]?.heads)
            expect(atLedger || ownWrite, `${label} read ${read.id} at heads the ledger did not record`).toBe(true)
          }

          // I2: changed only what it made, a finding nobody else had edited,
          // or the plan's ledger.
          for (const [id, h] of after) {
            if (before.get(id) === h) continue
            const allowed = made.has(id) || ledger[id]?.kind === "finding" || id === w.user.plan.documentId
            expect(allowed, `${label} changed ${id}`).toBe(true)
            expect(userIds().has(id), `${label} changed a document of the person's`).toBe(false)
            const was = findingsBefore.get(id)
            if (was) expect(sameHeads(was.live, was.recorded), `${label} wrote over a finding someone else had edited`).toBe(true)
          }
          expect(withoutLedger(w.user.plan.doc()), `${label} changed the plan beyond its ledger`).toBe(planBefore)

          // I4: no request reached a refused host, the reader's target
          // included; and a fetching tool handed a refused target refused it,
          // keeping nothing.
          for (const { url } of w.sent) {
            const targets = url.startsWith(READER) ? [url, url.slice(READER.length)] : [url]
            for (const target of targets) {
              const { protocol, host } = new URL(target)
              expect(["http:", "https:"], `${label} sent ${target}`).toContain(protocol)
              expect(REFUSED_HOSTS, `${label} sent ${target}`).not.toContain(host)
            }
          }
          if (FETCHING.includes(`${tool.id}.${field}`) && REFUSED_VALUES.includes(name)) {
            expect(outcome.isError, `${label} was not refused: ${outcome.output}`).toBe(true)
            expect(Object.keys(ledger), `${label} kept something`).toHaveLength(entriesBefore)
          }

          // Every tool a result names is one the step has: a result that
          // points at a missing tool is a dead end the model walks into.
          for (const id of OTHER_TOOLS) expect(outcome.output, `${label} names ${id}`).not.toMatch(new RegExp(`\\b${id}\\b`))

          // Nothing of the person's in what came back or what went out.
          const outbound = w.sent.map(({ url, init }) => [url, JSON.stringify(init.headers ?? {}), String(init.body ?? "")].join("\n")).join("\n")
          expect(outcome.output, `${label} output`).not.toContain(SENTINEL)
          expect(outbound, `${label} requests`).not.toContain(SENTINEL)
        }
      }
    }
    expect(calls).toBeGreaterThan(500)
  }, 60000)

  it("and no tool reached for the platform's own fetch", () => {
    expect(platform).toEqual([])
  })
})

// ------------------------------------------------------------ the parts

describe("web_fetch answers from the ledger", () => {
  // [what the ledger holds of this URL, read the same way] × fresh → answered
  // from it, with no request? The rule: a kept source of the URL, by this step
  // or any other, answers unless `fresh` is set; a finding never does, and
  // nor does an entry nothing has been written into yet.
  const URL_ = "https://web.test/again"
  const HOLDS = {
    nothing: { answers: false, keep: async () => null },
    "this step's source": { answers: true, keep: async (w, mine) => (await keepSource({ repo: mine }, kept())).ref.url },
    "a sibling's source": { answers: true, keep: async (w, _mine, sib) => (await keepSource({ repo: sib }, kept())).ref.url },
    "a finding": {
      answers: false,
      keep: async (w, mine) => {
        const made = await mine.create2()
        made.change((d) => Object.assign(d, { role: "finding", name: "f.md", content: "noted", source: URL_, capture: { engine: "reader-markdown" } }))
        return made.url
      },
    },
    "an entry not yet written": { answers: false, keep: async (w, mine) => (await mine.create2()).url },
  }
  const kept = () => ({ source: URL_, role: "extract", content: "# Again\nkept", capture: { via: "reader", engine: "reader-markdown" } })

  const cases = []
  for (const [holds, { answers }] of Object.entries(HOLDS)) for (const fresh of [undefined, true]) cases.push([holds, fresh, answers && !fresh])

  it.each(cases)("ledger holds %s, fresh %s → answered from the ledger %s", async (holds, fresh, answered) => {
    const w = await world()
    const mine = scopedRepo(w.repo, w.user.plan, { stepId: "research" })
    const sib = scopedRepo(w.repo, w.user.plan, { stepId: "sibling" })
    const url = await HOLDS[holds].keep(w, mine, sib)
    w.sent.length = 0
    w.asked.length = 0
    const outcome = await runTool(tools.webFetch, { url: URL_, ...(fresh ? { fresh } : {}) }, w.ctx)
    expect(outcome.isError, outcome.output).toBe(false)
    if (answered) {
      expect(outcome.output.startsWith(`Already kept at ${url} (fetched `), outcome.output).toBe(true)
      expect(w.sent).toEqual([])
    } else {
      expect(outcome.output.startsWith("Kept "), outcome.output).toBe(true)
      expect(w.sent.map((r) => r.url)).toEqual([`${READER}${URL_}`])
    }
    const ledger = Object.keys(w.user.plan.doc().sources)
    for (const id of w.asked) expect(ledger).toContain(id)
  })

  const tools = {}
  beforeAll(async () => {
    tools.webFetch = (await researchToolset()).get("web_fetch")
  })
})

describe("confine", () => {
  // §5.2, written out: what a research step's context may hold, and each
  // field of the runner's context it must never hold.
  const ALLOWED = ["direct", "events", "fetchImpl", "reader", "repo", "scope", "search", "signal"]
  const FORBIDDEN = [
    "subject", "rootFolderUrl", "notesFolderUrl", "skillsFolderUrl", "accountDocHandle", "contactUrl", "moduleSettingsUrl",
    "sessionUrl", "element", "getMount", "workflows", "session", "startStepSession", "sensitiveDocs",
  ]

  it("is built from its allowlist: nothing else of the runner's context is there", async () => {
    const { ctx, full } = await world()
    expect(Object.keys(ctx).sort()).toEqual(ALLOWED)
    for (const field of FORBIDDEN) {
      expect(field in full, `the runner's context has ${field}, so its absence below means something`).toBe(true)
      expect(field in ctx, field).toBe(false)
    }
    expect(ctx.scope).toEqual({ stepId: "research" })
    // The guard, the very one the runner was given.
    expect(ctx.fetchImpl).toBe(full.fetchImpl)
    expect(ctx.repo).not.toBe(full.repo)
  })

  it("has a repo that can read the ledger, make documents, and do nothing else", async () => {
    const { ctx } = await world()
    expect(Object.keys(ctx.repo).sort()).toEqual(["create2", "find", "sources"])
    expect(Object.isFrozen(ctx.repo)).toBe(true)
  })
})

describe("scopedRepo", () => {
  it("reads a source at the heads the ledger recorded, whatever has happened to it since", async () => {
    const w = await world()
    const raw = await w.repo.find(w.ledger.source)
    raw.change((d) => { d.content = new ImmutableString(`# Kept\n${SENTINEL} written in later`) })
    const out = await sourceRead.execute({ source: w.ledger.source }, w.ctx)
    expect(out).toContain("from the web")
    expect(out).not.toContain(SENTINEL)
  })

  it("will not write over a finding someone else edited, and says what to do instead", async () => {
    const w = await world()
    const raw = await w.repo.find(w.ledger.finding)
    raw.change((d) => { d.content = "a person's words" })
    await expect(findingWrite.execute({ text: "more", finding: w.ledger.finding }, w.ctx)).rejects.toThrow(EDITED_OUTSIDE)
    expect((await w.repo.find(w.ledger.finding)).doc().content).toBe("a person's words")
  })

  it("will not write to a kept source: only a finding is writable", async () => {
    const w = await world()
    const source = await w.ctx.repo.find(w.ledger.source)
    expect(source.change).toBeUndefined()
    await expect(findingWrite.execute({ text: "more", finding: w.ledger.source }, w.ctx)).rejects.toThrow(/not a finding/)
  })

  it("records each change's heads, so the next read is what was written", async () => {
    const w = await world()
    await findingWrite.execute({ text: "second thought", finding: w.ledger.finding }, w.ctx)
    const finding = await w.repo.find(w.ledger.finding)
    expect([...w.user.plan.doc().sources[finding.documentId].heads]).toEqual(finding.heads())
    expect(await sourceRead.execute({ source: w.ledger.finding }, w.ctx)).toContain("mine\n\nsecond thought")
  })

  it("a crash between making a document and entering it in the ledger leaves it unreadable", async () => {
    const w = await world()
    let made = null
    const raw = { find: (url) => w.repo.find(url), create2: async () => (made = await w.repo.create2()) }
    const ledger = { doc: () => w.user.plan.doc(), change: () => { throw new Error("crashed") } }
    await expect(scopedRepo(raw, ledger, { stepId: "research" }).create2()).rejects.toThrow("crashed")
    expect(made).not.toBeNull()
    await expect(w.ctx.repo.find(made.url)).rejects.toThrow(NOT_A_SOURCE)
  })

  // Every kernel type, made by every write a step's repo allows: a new
  // document, and a finding it holds. Each is refused, and changes nothing.
  it.each(KERNEL_TYPES.flatMap((type) => [["a new document", type], ["a finding", type]]))("will not make %s an %s", async (what, type) => {
    const w = await world()
    const handle = what === "a finding" ? await w.ctx.repo.find(w.ledger.finding) : await w.ctx.repo.create2()
    const raw = await w.repo.find(handle.url)
    const [before, entry] = [raw.heads(), { ...w.user.plan.doc().sources[handle.documentId] }]
    expect(() => handle.change((d) => { d["@patchwork"] = { type } })).toThrow(KERNEL_REFUSAL)
    expect(raw.heads()).toEqual(before)
    expect(raw.doc()["@patchwork"]?.type).not.toBe(type)
    expect({ ...w.user.plan.doc().sources[handle.documentId] }).toEqual(entry)
  })

  it("decides kind by the first description, so a source cannot later turn into a writable finding", async () => {
    const w = await world()
    const made = await w.ctx.repo.create2()
    made.change((d) => { d.role = "extract"; d.name = "x" })
    made.change((d) => { d.role = "finding" })
    expect(w.user.plan.doc().sources[made.documentId].kind).toBe("source")
    expect((await w.ctx.repo.find(made.url)).change).toBeUndefined()
  })
})

describe("scopeOf", () => {
  const plan = generateAutomergeUrl()
  it.each([
    ["absent", {}, null],
    ["null", { scope: null }, null],
    ["well formed", { scope: { kind: "web", ledgerUrl: plan, stepId: "r" } }, { kind: "web", ledgerUrl: plan, stepId: "r" }],
  ])("%s → %j", (_name, doc, expected) => {
    expect(scopeOf(doc)).toEqual(expected)
  })

  // Every way of being almost right is wrong, and fails closed.
  it.each([
    ["another kind", { kind: "full", ledgerUrl: plan, stepId: "r" }],
    ["no kind", { ledgerUrl: plan, stepId: "r" }],
    ["no ledger", { kind: "web", stepId: "r" }],
    ["a ledger that is not a URL", { kind: "web", ledgerUrl: "plan", stepId: "r" }],
    ["a ledger at some heads", { kind: "web", ledgerUrl: `${plan}#${encodeHeads(["00".repeat(32)])[0]}`, stepId: "r" }],
    ["a part of a ledger", { kind: "web", ledgerUrl: `${plan}/steps`, stepId: "r" }],
    ["no step", { kind: "web", ledgerUrl: plan }],
    ["an empty step", { kind: "web", ledgerUrl: plan, stepId: "" }],
    ["a field too many", { kind: "web", ledgerUrl: plan, stepId: "r", extra: 1 }],
    ["not an object", "web"],
  ])("%s throws", (_name, scope) => {
    expect(() => scopeOf({ scope })).toThrow(ScopeRefusal)
  })
})

describe("assertScopeAgrees", () => {
  // [what the session says of its plan, what scope it has] → runs?
  it("agrees exactly when the plan and the scope say the same", async () => {
    const w = await world()
    const plan = w.user.plan.url
    const named = (stepId) => ({ workflow: { planUrl: plan, stepId } })
    const cases = [
      [named("research"), webScope(plan, "research"), true],
      [named("research"), null, false], // the scope was removed
      [named("research"), webScope(plan, "sibling"), false], // another step's
      [named("full"), null, true], // a full step, unconfined
      [named("full"), webScope(plan, "full"), false], // a scope naming a full step
      [{}, webScope(plan, "research"), true], // confined with nothing named: still checked against the plan
      [{}, webScope(w.user.subject.url, "research"), false], // a scope naming something that is not a plan
      [{}, null, true], // an ordinary session
    ]
    for (const [doc, scope, runs] of cases) {
      const attempt = assertScopeAgrees(doc, scope, w.repo)
      if (runs) await expect(attempt).resolves.toBeUndefined()
      else await expect(attempt).rejects.toThrow(ScopeRefusal)
    }
  })

  it("compares scopes field by field", () => {
    const a = webScope("automerge:x", "r")
    expect(sameScope(a, { ...a })).toBe(true)
    for (const field of ["kind", "ledgerUrl", "stepId"]) expect(sameScope(a, { ...a, [field]: "other" })).toBe(false)
    expect(sameScope(null, null)).toBe(true)
    expect(sameScope(a, null)).toBe(false)
  })
})

describe("finding_write", () => {
  it("writes a finding into the ledger, as the step's, citing only what is there", async () => {
    const w = await world()
    const out = await findingWrite.execute({ title: "Pack cells", text: "LFP, 280 Ah.", cites: [w.ledger.source, `${w.ledger.source}#${encodeHeads(["00".repeat(32)])[0]}`] }, w.ctx)
    const url = out.doc.url
    expect(out.text).toBe(`Kept finding 'Pack cells' at ${url} (12 chars). Cite it in your result.`)
    const doc = (await w.repo.find(url)).doc()
    expect({ name: doc.name, role: doc.role, content: doc.content, by: { ...doc.by } }).toEqual({ name: "Pack cells.md", role: "finding", content: "LFP, 280 Ah.", by: { stepId: "research" } })
    // Every spelling of one source is one citation, by its plain URL.
    expect([...doc.cites]).toEqual([w.ledger.source])
    expect(w.user.plan.doc().sources[idOf(url)]).toMatchObject({ kind: "finding", what: "finding", by: "research", name: "Pack cells.md" })
  })

  it("adds to a finding, or rewrites it", async () => {
    const w = await world()
    await findingWrite.execute({ text: "second", finding: w.ledger.finding }, w.ctx)
    expect((await w.repo.find(w.ledger.finding)).doc().content).toBe("mine\n\nsecond")
    await findingWrite.execute({ text: "all new", finding: w.ledger.finding, mode: "replace", title: "Renamed" }, w.ctx)
    const doc = (await w.repo.find(w.ledger.finding)).doc()
    expect([doc.content, doc.name]).toEqual(["all new", "Renamed.md"])
  })

  it("refuses to cite what is not in the ledger, and writes nothing", async () => {
    const w = await world()
    const before = Object.keys(w.user.plan.doc().sources).length
    await expect(findingWrite.execute({ text: "x", cites: [w.user.private.url] }, w.ctx)).rejects.toThrow(/not one of this workflow's sources/)
    expect(Object.keys(w.user.plan.doc().sources)).toHaveLength(before)
  })

  it("is for research steps only", async () => {
    const w = await world()
    await expect(findingWrite.execute({ text: "x" }, { repo: w.repo })).rejects.toThrow(/not one/)
  })

  it("checks the citations in its text: a quote that is in the source is kept, and the source is cited", async () => {
    const w = await world()
    const out = await findingWrite.execute({ text: `It says so [page](${w.ledger.source} "Kept from the web").` }, w.ctx)
    expect([...(await w.repo.find(out.doc.url)).doc().cites]).toEqual([w.ledger.source])
  })

  it("refuses a quote that is not in its source, one too short to check, and a source that is not the workflow's — and writes nothing", async () => {
    const w = await world()
    const before = Object.keys(w.user.plan.doc().sources).length
    const cases = [
      [`[page](${w.ledger.source} "Kept from the sea")`, /"Kept from the sea" is not in .*quote its words exactly/],
      [`[page](${w.ledger.source} "the web")`, /too short/],
      [`[mine](${w.user.private.url} "${SENTINEL} private")`, /not one of this workflow's sources/],
    ]
    for (const [text, refusal] of cases) {
      await expect(findingWrite.execute({ text: `Claim ${text}.` }, w.ctx)).rejects.toThrow(refusal)
    }
    expect(Object.keys(w.user.plan.doc().sources)).toHaveLength(before)
  })
})
