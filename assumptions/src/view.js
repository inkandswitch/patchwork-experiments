/**
 * The register's view: three lenses over one register, and an entry panel.
 *
 *   Needs attention   people's judgements to answer, problems in queue
 *                     order, and the weak leaves that matter most
 *   Entries           every entry, grouped by the first segment of its id,
 *                     rows in calculation order; groups with problems open
 *   Requirements      every check on one scale, the share of its limit it
 *                     uses, worst first
 *   Structure         the map of groups, one group's entries, one entry's
 *                     inputs and outputs (structure.js)
 *
 * Check the folder (and a quiet rescan whenever the view opens) runs the
 * same check as the agent's assumptions_check (check.js): where entries are
 * used, model runs whose code changed, quotes whose sources changed. A model
 * entry's panel records a new run, as the agent's assumptions_set does.
 *
 * The panel answers the questions about the entry it shows: its value, its
 * basis (claims with quotes in context, or the calculation), its inputs and
 * outputs, where it is used, and what people have said. Ids are
 * links; following one pushes the panel, and the breadcrumb is the line of
 * inquiry. People add claims and judgements here; nobody approves anything.
 *
 * Rows are built from the same parts as the agent's text (text.js), so a
 * row's cells read exactly as its figure line. Colour appears only where
 * something needs a person; evidence is a glyph's fill, and every glyph is
 * also a word. Rendering morphs the live DOM (morph.js), so a re-render
 * keeps scroll, open sections, focus and typed text; events are delegated.
 */

import { checkFolder, readSource, recordInputs, runDocuments, runRecord } from "./check.js"
import { render as renderFormula } from "./formula.js"
import { morph } from "./morph.js"
import { checkClaim } from "./quote.js"
import { evaluate, groupOf, intendedUse, materialize, peoplesMarks } from "./register.js"
import { RANK, SET_ASIDE, SOURCE_KINDS } from "./support.js"
import { entryIO, groupGraph, groupMap, inputsOf, layered, placeLayered, staleLinks } from "./structure.js"
import { allProblems, progressText, unopenedText, confidenceText, entryParts, groupLine, readsNothingText, restsOnText, sheetOrder, staleText, summaryLine, valueText } from "./text.js"
import { observedUse, scanProblems } from "./uses.js"
import { formatBounds, formatValue, isNumeric, parseValue } from "./values.js"
import { useCounts, usesOf } from "./where.js"

const LENSES = [
  ["attention", "Needs attention"],
  ["entries", "Entries"],
  ["requirements", "Requirements"],
  ["structure", "Structure"],
]
const NAME_KEY = "assumptions:name"
/** How long a model document stays still before its new results are read: a run writes outputs cell by cell. */
const MODEL_SETTLE_MS = 1500
/** Bases in ring order, with what each says about how a value is known. */
const BASIS_KEYS = [["claims", "sourced"], ["estimate", "estimated"], ["choice", "decided"], ["model", "computed by a model"], ["formula", "calculated"], ["check", "requirements"], ["unknown", "unknown"]]
const DOC_URL = /automerge:[1-9A-HJ-NP-Za-km-z]+(?:#[1-9A-HJ-NP-Za-km-z|]+)?/g
const MEMO = ["value", "support", "derived", "confidence", "outcome", "stale", "broken"]

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue
    if (key === "class") node.className = value
    else node.setAttribute(key, value === true ? "" : String(value))
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue
    node.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child)
  }
  return node
}

const idLink = (id, title) => h("a", { href: "#", class: "id", "data-open": id, title }, id)

function readName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ""
  } catch {
    return ""
  }
}
function saveName(name) {
  try {
    if (name) localStorage.setItem(NAME_KEY, name)
  } catch {}
}

const plain = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))
const levelOf = (ev) => ev?.support?.level ?? null

/** The definition of an entry: what a change to it changes (not what the register writes back). */
function definition(entry) {
  if (!entry) return null
  const { basis, claims, pick, estimate, unknown, choice, formula, model, check, appliesIf, about, use } = entry
  return JSON.stringify(plain({ basis, claims, pick, estimate, unknown, choice, formula, model: model ? { ...model, at: undefined } : undefined, check, appliesIf, about, use }))
}

export function AssumptionsView(handle, element, options = {}) {
  // Patchwork hands a tool its repo on the element; window.repo is the older way.
  const repo = options.repo ?? element.repo ?? globalThis.repo ?? null
  const state = { lens: "attention", stack: [], at: -1, q: "", support: "", kind: "", open: new Set(), closed: new Set(), form: null, error: null, preview: null, history: null, cursor: null, structure: { group: null, entry: null, unread: false }, checking: false, checkError: null, checkNote: null, progress: { documents: null, sources: null } }
  const style = h("style")
  style.textContent = CSS
  const root = h("div", { class: "asm", tabindex: "-1" })
  element.append(style, root)
  let doc, evaluation, problems, counts
  let disposed = false

  // Documents are shown by name, never as a bare automerge: URL. Titles load
  // as the documents do, and the view redraws when one arrives.
  const titles = new Map()
  const docName = (d) => d?.title || d?.name || d?.["@patchwork"]?.title || null
  function titleOf(url) {
    if (titles.has(url)) return titles.get(url)
    titles.set(url, null)
    if (repo) {
      Promise.resolve()
        .then(() => repo.find(url))
        .then((found) => {
          const name = docName(found?.doc?.())
          if (name) titles.set(url, name)
          if (name && !disposed) render()
        })
        .catch(() => {})
    }
    return null
  }

  const heads = () => (typeof handle.heads === "function" ? [...(handle.heads() ?? [])] : [])

  function compute() {
    doc = handle.doc() ?? { entries: {} }
    if (!doc.entries) doc = { ...doc, entries: {} }
    evaluation = evaluate(doc)
    problems = allProblems(evaluation, scanProblems(doc, evaluation))
    counts = useCounts(doc.scan)
  }

  // The register checks its stored results when it loads and repairs any
  // that don't follow from their inputs: a hand edit, an older client.
  function repair() {
    compute()
    if (materialize(plain(doc), evaluation, { at: heads() }).length) {
      handle.change((d) => materialize(d, evaluate(d), { at: heads() }), { message: "register: repair stored results" })
    }
  }

  // ------------------------------------------------------------ rendering

  function render() {
    compute()
    watchModels()
    const out = h("div")
    out.append(header(), h("div", { class: "body", "data-key": "body" }, lensView(), panel()))
    morph(root, out)
  }

  function header() {
    return h(
      "header",
      { "data-key": "header" },
      h("h1", {}, doc.title || "Assumptions"),
      h(
        "p",
        { class: "summary" },
        summaryLine(doc, evaluation, problems, { title: false }),
        " ",
        state.checking
          ? [h("span", { class: "progress", role: "status" }, progressText(state.progress)), " ", h("button", { type: "button", class: "link", "data-check-stop": "1" }, "Stop")]
          : h("button", { type: "button", class: "link", "data-check": "1", disabled: !repo, title: "Look through the task folder for where entries are used, model runs whose code changed, and quotes whose source changed" }, "Check the folder"),
        state.checkError ? h("span", { class: "error", role: "alert" }, ` ${state.checkError}`) : null,
        !state.checking && state.checkNote ? h("span", { class: "quiet" }, ` ${state.checkNote}`) : null,
      ),
      h(
        "nav",
        { role: "tablist" },
        LENSES.map(([key, label]) => h("button", { type: "button", role: "tab", "aria-selected": state.lens === key ? "true" : "false", "data-lens": key }, label)),
      ),
    )
  }

  function lensView() {
    const main = h("main", { class: `lens lens-${state.lens}`, "data-key": `lens:${state.lens}` })
    if (state.lens === "attention") main.append(...attention())
    else if (state.lens === "entries") main.append(...entriesLens())
    else if (state.lens === "structure") main.append(...structureLens())
    else main.append(...requirementsLens())
    return main
  }

  const glyph = (level) => (level ? h("span", { class: "glyph", "data-level": level, role: "img", "aria-label": level }) : null)
  const chip = (kind) => h("span", { class: `chip ${kind === "FAILS" ? "fail" : "warn"}` }, kind)

  /** Text with any entry id in it turned into a link. */
  function linkify(text) {
    const parts = []
    let last = 0
    for (const m of String(text).matchAll(/\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g)) {
      if (!doc.entries[m[0]]) continue
      parts.push(text.slice(last, m.index), idLink(m[0]))
      last = m.index + m[0].length
    }
    parts.push(text.slice(last))
    return parts
  }

  /** A link to a document, named by its title: a kept source, a model's run, a web page. */
  function docLink(url, fallback = "a document") {
    if (/^https?:/i.test(url)) {
      let host = url
      try {
        host = new URL(url).hostname
      } catch {}
      return h("a", { href: url, target: "_blank", rel: "noopener", class: "doc" }, fallback === "a document" ? host : fallback)
    }
    return h("a", { href: "#", class: "doc", "data-doc": url }, titleOf(url) ?? fallback)
  }

  /** Text with entry ids and document URLs in it turned into links. */
  function rich(text) {
    const s = String(text ?? "")
    const out = []
    let last = 0
    for (const m of s.matchAll(DOC_URL)) {
      out.push(linkify(s.slice(last, m.index)), docLink(m[0]))
      last = m.index + m[0].length
    }
    out.push(linkify(s.slice(last)))
    return out
  }

  // ------------------------------------------------------------ needs attention

  function attention() {
    const out = []
    const item = (id, key, ...children) => h("li", { "data-id": id, "data-key": key, class: state.cursor === id ? "cursor" : null }, ...children)
    if (evaluation.judgements.length) {
      out.push(
        h("h2", {}, "Judgements to answer"),
        h(
          "ul",
          { class: "queue" },
          evaluation.judgements.map(({ id, judgement: j }) =>
            item(id, `j:${id}:${j.key}`, h("span", { class: "chip warn" }, "JUDGEMENT"), " ", idLink(id), ` · ${j.by?.who ?? "a person"}${j.on ? ` on ${j.on}` : ""}: `, h("q", {}, rich(j.says ?? j.verdict)), j.path ? h("span", { class: "quiet" }, ` · ${j.path}`) : null),
          ),
        ),
      )
    }
    out.push(h("h2", {}, problems.length ? `Problems (${problems.length})` : "Problems"))
    if (!problems.length) out.push(h("p", { class: "quiet" }, "Nothing needs attention."))
    else out.push(h("ul", { class: "queue" }, problems.map((p, i) => item(p.id, `p:${i}:${p.kind}:${p.id}`, chip(p.kind), " ", rich(p.text), p.fix ? h("div", { class: "fix" }, "fix: ", rich(p.fix)) : null))))
    const unopened = doc.scan?.unopened ?? []
    if (unopened.length) {
      out.push(
        h("h2", {}, `Couldn't open (${unopened.length})`),
        h("p", { class: "quiet" }, "The last check couldn't open these documents in the folder, so it couldn't look at them. Check the folder again once they're available."),
        h("ul", { class: "queue" }, unopened.map((u) => h("li", { "data-key": `u:${u.url}` }, docLink(u.url, u.path || "a document"), h("span", { class: "quiet" }, ` · ${u.why}`)))),
      )
    }
    const weak = weakLeaves()
    if (weak.length) {
      out.push(
        h("h2", {}, "Weak leaves that matter"),
        h("p", { class: "quiet" }, "Where a source, a measurement or a judgement would most change a result. Nothing waits on these."),
        h("ul", { class: "queue" }, weak.map(({ id, why }) => item(id, `w:${id}`, glyph(levelOf(evaluation.byId.get(id))), " ", idLink(id), ` ${formatValue(evaluation.byId.get(id).value, doc.entries[id].unit)} · ${why}`))),
      )
    }
    return out
  }

  /** Weak and unknown leaves: those that would settle a requirement first, then by how much rests on them. */
  function weakLeaves() {
    const settles = new Map()
    for (const [id, ev] of evaluation.byId) for (const s of ev.outcome?.settle ?? []) if (!settles.has(s.id)) settles.set(s.id, `would settle ${id}: it ${s.why}`)
    const resting = new Map()
    for (const [id, ev] of evaluation.byId) for (const leaf of ev.leaves ?? []) if (leaf !== id) resting.set(leaf, (resting.get(leaf) ?? 0) + 1)
    return Object.keys(doc.entries)
      .filter((id) => ["weak", "none"].includes(levelOf(evaluation.byId.get(id))) && doc.entries[id].basis !== "formula" && (settles.has(id) || resting.get(id)))
      .map((id) => {
        const n = resting.get(id) ?? 0
        return { id, why: settles.get(id) ?? `${n} result${n === 1 ? "" : "s"} or requirement${n === 1 ? "" : "s"} rest${n === 1 ? "s" : ""} on it`, rank: (settles.has(id) ? 1e6 : 0) + n * 10 + (2 - RANK[levelOf(evaluation.byId.get(id))]) }
      })
      .sort((a, b) => b.rank - a.rank || (a.id < b.id ? -1 : 1))
      .slice(0, 12)
  }

  // ------------------------------------------------------------ entries

  function visible(id) {
    const entry = doc.entries[id]
    if (state.q && !`${id} ${entry.label ?? ""} ${entry.note ?? ""}`.toLowerCase().includes(state.q.toLowerCase())) return false
    if (state.support && levelOf(evaluation.byId.get(id)) !== state.support) return false
    if (state.kind && entry.kind !== state.kind) return false
    return true
  }

  function select(name, options, any) {
    return h("select", { "data-filter": name, "aria-label": name }, options.map((o) => h("option", { value: o, selected: state[name] === o }, o || any)))
  }

  function entriesLens() {
    const groups = new Map()
    for (const id of Object.keys(doc.entries).sort()) groups.set(groupOf(id), [...(groups.get(groupOf(id)) ?? []), id])
    const filters = h(
      "div",
      { class: "filters", "data-key": "filters" },
      h("input", { type: "search", placeholder: "Search ids, labels, notes  ( / )", "data-filter": "q", "aria-label": "Search", value: state.q }),
      select("support", ["", "corroborated", "supported", "weak", "none", "chosen"], "any support"),
      select("kind", ["", "fact", "decision", "requirement", "result"], "any kind"),
    )
    const table = h("table", { class: "entries", "data-key": "entries" }, h("thead", {}, h("tr", {}, ["id", "value", "bounds", "status", "evidence", "judgements", "uses", "flags"].map((c) => h("th", { scope: "col" }, c)))))
    const filtering = Boolean(state.q || state.support || state.kind)
    for (const [group, members] of groups) {
      const shown = members.filter(visible)
      if (!shown.length) continue
      const troubled = problems.some((p) => members.includes(p.id))
      const open = filtering || state.open.has(group) || (troubled && !state.closed.has(group))
      const body = h("tbody", { "data-key": `g:${group}` }, h("tr", { class: "group" }, h("th", { colspan: "8", scope: "rowgroup" }, h("button", { type: "button", "data-group": group, "aria-expanded": open ? "true" : "false" }, groupLine(group, members, doc.entries, evaluation, problems)))))
      if (open) for (const id of sheetOrder(evaluation, doc.entries, shown)) body.append(row(id))
      table.append(body)
    }
    return [filters, table]
  }

  function row(id) {
    const entry = doc.entries[id]
    const ev = evaluation.byId.get(id)
    const cells = entryParts(id, entry, evaluation, { scan: doc.scan, counts, problems })
      .filter((p) => p.part !== "cite")
      .map((p) => {
        if (p.part === "id") return h("td", { class: "id" }, idLink(id, entry.label ?? null))
        if (p.part === "status") return h("td", { class: "status", "data-level": levelOf(ev) ?? "" }, p.text)
        if (p.part === "flags") return h("td", { class: "flags" }, p.text ? p.text.split(" ").map((f, i) => [i ? " " : "", chip(f)]) : "")
        return h("td", { class: p.part }, p.part === "evidence" ? rich(p.text) : p.text)
      })
    return h("tr", { class: `entry${state.stack[state.at] === id ? " selected" : ""}${state.cursor === id ? " cursor" : ""}`, "data-id": id, "data-key": `e:${id}`, tabindex: "0" }, cells)
  }

  // ------------------------------------------------------------ requirements

  /** The share of its limit a check uses: value / limit for an upper limit, limit / value for a lower one. */
  function utilisation(o) {
    const iv = (v) => (isNumeric(v) ? [v.min ?? (v.exact ? v.nominal : -Infinity), v.max ?? (v.exact ? v.nominal : Infinity)] : [-Infinity, Infinity])
    if (!o?.op || o.result === "n/a" || o.result === "broken") return null
    const [a, b] = iv(o.lhs)
    const [c, d] = iv(o.rhs)
    const ratio = (x, y) => (x?.nominal != null && y?.nominal ? x.nominal / y.nominal : null)
    if (o.op === "<" || o.op === "<=") return c > 0 ? { lo: a / d, hi: b / c, nominal: ratio(o.lhs, o.rhs) } : null
    if (o.op === ">" || o.op === ">=") return a > 0 && c > 0 ? { lo: c / b, hi: d / a, nominal: ratio(o.rhs, o.lhs) } : null
    return null
  }

  function bar(u, top, failing = false) {
    const W = 180
    const H = 16
    const x = (v) => Math.max(0, Math.min(W, (v / top) * W))
    const ns = "http://www.w3.org/2000/svg"
    const svg = document.createElementNS(ns, "svg")
    for (const [k, v] of Object.entries({ viewBox: `0 0 ${W} ${H}`, width: W, height: H, "aria-hidden": "true" })) svg.setAttribute(k, v)
    const add = (tag, attrs) => {
      const n = document.createElementNS(ns, tag)
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v)
      svg.append(n)
    }
    const lo = Number.isFinite(u.lo) ? Math.max(0, u.lo) : 0
    const hi = Number.isFinite(u.hi) ? Math.min(u.hi, top) : top
    const over = failing || u.hi > 1 ? " over" : ""
    if (x(hi) - x(lo) < 3) add("circle", { cx: x((lo + hi) / 2), cy: 8, r: 3.5, class: `range${over}` })
    else add("rect", { x: x(lo), y: 5, width: x(hi) - x(lo), height: 6, class: `range${over}` })
    // An unbounded side runs off the scale with an arrow; it is never cut at the frame.
    if (!Number.isFinite(u.hi) || u.hi > top) add("path", { d: `M${W - 6},2 L${W},8 L${W - 6},14 Z`, class: `arrow${over}` })
    if (!Number.isFinite(u.lo) || u.lo < 0) add("path", { d: "M6,2 L0,8 L6,14 Z", class: "arrow" })
    add("line", { x1: x(1), x2: x(1), y1: 0, y2: H, class: "limit" })
    if (u.nominal != null && Number.isFinite(u.nominal)) add("line", { x1: x(u.nominal), x2: x(u.nominal), y1: 3, y2: 13, class: "nominal" })
    return svg
  }

  function requirementsLens() {
    const order = { fails: 0, broken: 1, depends: 2, holds: 3, "n/a": 4 }
    const rows = Object.keys(doc.entries)
      .filter((id) => doc.entries[id].basis === "check")
      .map((id) => ({ id, o: evaluation.byId.get(id).outcome ?? {}, u: utilisation(evaluation.byId.get(id).outcome) }))
      .sort((a, b) => (order[a.o.result] ?? 9) - (order[b.o.result] ?? 9) || (b.u?.hi ?? 0) - (a.u?.hi ?? 0) || (a.id < b.id ? -1 : 1))
    if (!rows.length) return [h("p", { class: "quiet" }, "No requirements are checked by the register yet.")]
    const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "unbounded")
    // One scale for every row: a check's margin is comparable with every other's.
    const finiteHighs = rows.map((r) => r.u?.hi).filter(Number.isFinite)
    const top = Math.max(1.25, Math.min(2, Math.max(0, ...finiteHighs) * 1.05))
    return [
      h(
        "table",
        { class: "requirements", "data-key": "requirements" },
        h("thead", {}, h("tr", {}, ["outcome", "requirement", "share of limit", "in words"].map((c) => h("th", { scope: "col" }, c)))),
        h(
          "tbody",
          {},
          rows.map(({ id, o, u }) =>
            h(
              "tr",
              { "data-id": id, "data-key": `r:${id}`, class: state.cursor === id ? "cursor" : null },
              h("td", { class: "outcome" }, o.result === "fails" ? chip("FAILS") : o.result === "depends" ? chip("DEPENDS") : o.result),
              h("td", {}, idLink(id), h("div", { class: "quiet" }, doc.entries[id].check)),
              h("td", { class: "margin" }, u ? bar(u, top, o.result === "fails") : h("span", { class: "quiet" }, o.result === "n/a" ? "" : "no common scale")),
              h(
                "td",
                {},
                u ? (Number.isFinite(u.hi) ? `worst ${pct(u.hi)} of its limit` : "worst case unbounded") + (u.nominal != null ? `, ${pct(u.nominal)} at nominal` : "") : `${o.lhs ? formatValue(o.lhs) : "unbounded"} ${o.op ?? ""} ${o.rhs ? formatValue(o.rhs) : "unbounded"}`,
                o.result === "depends" && o.settle?.[0] ? h("div", {}, linkify(`depends on ${o.settle[0].id}, which ${o.settle[0].why}`)) : null,
                o.result === "n/a" ? h("div", { class: "quiet" }, `doesn't apply: ${doc.entries[id].appliesIf}`) : null,
              ),
            ),
          ),
        ),
      ),
    ]
  }

  // ------------------------------------------------------------ structure

  /**
   * The register's structure at three depths, with a breadcrumb between them:
   *
   *   All groups   every group (an id's first word), inputs on the left and
   *                outputs on the right. The ring says how the group's values
   *                are known; a line's width, how many entries one group reads
   *                from another; amber, a stale result and the link it went
   *                stale along. Dashed lines are read against the flow.
   *   a group      its entries between the groups they read and the groups
   *                that read them; entries linked to nothing fold into a line
   *   an entry     what it reads and what reads it, two steps each way
   *
   * Pointing at a node lights its links. Every node is a link with its figure
   * in words. assumptions_read with `structure` writes the same three views.
   */
  function structureLens() {
    if (!Object.keys(doc.entries).length) return [h("p", { class: "quiet" }, "No entries yet.")]
    const s = state.structure
    if (s.entry && !doc.entries[s.entry]) s.entry = null
    if (s.group && !Object.keys(doc.entries).some((id) => groupOf(id) === s.group)) s.group = null
    const crumbs = h(
      "nav",
      { class: "crumbs structure-crumbs", "aria-label": "structure" },
      s.group || s.entry ? h("a", { href: "#", "data-structure": "map" }, "All groups") : h("strong", {}, "All groups"),
      s.group ? [" › ", s.entry ? h("a", { href: "#", "data-structure": "group" }, s.group) : h("strong", {}, s.group)] : null,
      s.entry ? [" › ", h("strong", {}, s.entry)] : null,
    )
    if (s.entry) return [crumbs, ...entryGraph(s.entry)]
    if (s.group) return [crumbs, ...groupView(s.group)]
    return [crumbs, ...mapView()]
  }

  const kindsText = (g) => BASIS_KEYS.filter(([b]) => g.basis[b]).map(([b, words]) => `${g.basis[b]} ${words}`).join(", ")

  /** A group as a ring of its entries' bases, with its count inside. */
  function donut(cx, cy, r, g, total) {
    const out = []
    let a = 0
    const arc = (a0, a1) => {
      const p = (t) => [cx + r * Math.sin(t), cy - r * Math.cos(t)]
      const [x0, y0] = p(a0), [x1, y1] = p(a1)
      return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
    }
    for (const [b] of BASIS_KEYS) {
      const k = g.basis[b]
      if (!k) continue
      const a1 = a + (k / total) * Math.PI * 2
      const d = k === total ? `${arc(0, Math.PI)}${arc(Math.PI, Math.PI * 2 - 1e-4).replace(/^M[^A]*/, "")}` : arc(a + 0.04, a1 - 0.04)
      out.push(el("path", { d, class: `ring b-${b}` }))
      a = a1
    }
    return out
  }

  function mapView() {
    const map = groupMap(doc, evaluation)
    const inside = [...map.groups.values()].reduce((sum, g) => sum + g.inside, 0)
    const loose = map.loose.length
      ? h("p", { class: "quiet" }, "Not linked to any other group: ", map.loose.map((name, i) => [i ? " · " : "", h("a", { href: "#", "data-sgroup": name }, name), ` ${map.groups.get(name).ids.length}`]))
      : null
    const head = h("p", { class: "structure-head" }, `${map.groups.size} groups, named by the first word of their ids · ${map.total} links between entries, ${inside} inside a group. Inputs on the left, outputs on the right; open a group to see its entries.`)
    if (!map.linked.length) return [head, h("p", { class: "quiet" }, "No group reads another yet."), loose]
    const radius = (n) => 7 + Math.sqrt(n) * 1.25
    const size = (name) => {
      const g = map.groups.get(name)
      const r = radius(g.ids.length)
      const w = Math.max(2 * r + 14, name.length * 7.2 + 8)
      return { w, h: 2 * r + 30 + (g.stale ? 14 : 0), portY: r + 6, inX: w / 2 - r - 8, outX: w / 2 + r + 6 }
    }
    const placed = placeLayered(map.layout, map.edges, size, { gap: 30, vgap: 10, slot: 8 })
    const svg = drawGraph(placed, {
      label: "the register's groups, inputs on the left, outputs on the right",
      edge: ({ edge, chain }) => ({ cls: [edge.flipped !== chain.back ? "back" : null, edge.link.stale ? "hot" : null], width: Math.min(6, 0.9 + edge.link.n * 0.26), from: edge.link.from, to: edge.link.to, hot: edge.link.stale, flipped: edge.flipped }),
      node: (name, box) => {
        const g = map.groups.get(name)
        const r = radius(g.ids.length)
        const cx = box.x + box.w / 2, cy = box.y + r + 6
        const label = `${name}: ${g.ids.length} entries (${kindsText(g)})${g.stale ? `, ${g.stale} stale` : ""}`
        return el(
          "g",
          { class: `gnode${g.stale ? " warn" : ""}`, "data-sgroup": name, "data-node": name, role: "link", tabindex: "0", "aria-label": label },
          el("title", {}, label),
          el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, class: "hit" }),
          g.stale ? el("circle", { cx, cy, r: r + 5, class: "stale-ring" }) : null,
          donut(cx, cy, r, g, g.ids.length),
          el("text", { x: cx, y: cy + 4, class: "g-count" }, String(g.ids.length)),
          el("text", { x: cx, y: cy + r + 15, class: "g-name" }, name),
          g.stale ? el("text", { x: cx, y: cy + r + 28, class: "g-stale" }, `${g.stale} STALE`) : null,
        )
      },
    })
    return [head, basisLegend("line width = how many entries one group reads from another · dashed = read against the flow · amber = a stale result and the link it went stale along"), h("div", { class: "graph-wrap", "data-key": "graph:map" }, svg), loose]
  }

  function basisLegend(rest) {
    return h("p", { class: "quiet legend" }, BASIS_KEYS.slice(0, 4).map(([b, words]) => h("span", { class: `key b-${b}` }, words)), ` · ${rest}`)
  }

  function groupView(name) {
    const g = groupGraph(doc, evaluation, name)
    const stale = g.ids.filter((id) => evaluation.byId.get(id)?.stale).length
    const head = h("p", { class: "structure-head" }, `${name}: ${g.ids.length} entries · ${g.given.length} given, ${g.computed.length} computed${stale ? ` · ${stale} STALE` : ""}. The groups they read on the left, the groups that read them on the right.`)
    const unread = g.unread.length
      ? h(
          "div",
          { class: "unread", "data-key": `unread:${name}` },
          h("p", {}, `${g.unread.length} ${g.unread.length === 1 ? "entry reads" : "entries read"} nothing and nothing reads ${g.unread.length === 1 ? "it" : "them"}. `, h("button", { type: "button", class: "link", "data-show-unread": "1" }, state.structure.unread ? "Hide them" : "Show them")),
          state.structure.unread ? h("p", {}, g.unread.map((id, i) => [i ? ", " : "", idLink(id)])) : null,
        )
      : null
    if (!g.nodes.length) return [head, unread]
    const prefix = `${name}_`
    const short = (id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id)
    const end = (key) => key.slice(key.indexOf(":") + 1)
    const size = (key) => {
      const r = 9
      if (key.startsWith("in:")) {
        const w = Math.max(2 * r + 14, end(key).length * 7.2 + 8)
        return { w, h: 2 * r + 30, portY: r + 6, inX: w / 2 - r - 6, outX: w / 2 + r + 6 }
      }
      if (key.startsWith("out:")) return { w: 2 * r + 18 + end(key).length * 7.2, h: 2 * r + 12, portY: r + 6, inX: 0, outX: 2 * r + 8 }
      const v = valueText(key, doc, evaluation)
      return { w: Math.min(280, Math.max(140, short(key).length * 6.8 + v.length * 6.4 + 30)), h: 22 }
    }
    const map = groupMap(doc, evaluation)
    const hotEnd = new Set(g.edges.filter((e) => e.stale).flatMap((e) => [e.u, e.v]).filter((k) => k.includes(":")))
    const placed = placeLayered(g.layout, g.edges, size, { gap: 48, vgap: 8, slot: 8 })
    const svg = drawGraph(placed, {
      label: `the entries of ${name}, between the groups they read and the groups that read them`,
      edge: ({ edge, chain }) => ({ cls: [chain.back ? "back" : null, edge.stale ? "hot" : null], width: edge.u.includes(":") || edge.v.includes(":") ? Math.min(4, 1 + (edge.n - 1) * 0.4) : 1.1, from: edge.u, to: edge.v, hot: edge.stale }),
      node: (key, box) => {
        if (key.includes(":")) {
          const other = end(key)
          const og = map.groups.get(other)
          const r = 9
          const out = key.startsWith("out:")
          const cx = out ? box.x + r + 4 : box.x + box.w / 2, cy = box.y + r + 6
          const n = g.edges.filter((e) => e.u === key || e.v === key).reduce((sum, e) => sum + e.n, 0)
          const label = `${other}: ${out ? `reads ${n} of ${name}'s entries` : `${n} of ${name}'s entries read it`}`
          return el(
            "g",
            { class: `gnode end${hotEnd.has(key) ? " warn" : ""}`, "data-sgroup": other, "data-node": key, role: "link", tabindex: "0", "aria-label": label },
            el("title", {}, label),
            el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, class: "hit" }),
            hotEnd.has(key) ? el("circle", { cx, cy, r: r + 4, class: "stale-ring" }) : null,
            donut(cx, cy, r, og, og.ids.length),
            out ? el("text", { x: cx + r + 8, y: cy + 4, class: "g-name start" }, other) : el("text", { x: cx, y: cy + r + 15, class: "g-name" }, other),
          )
        }
        const entry = doc.entries[key]
        const ev = evaluation.byId.get(key)
        const v = valueText(key, doc, evaluation)
        const warn = ev.stale || g.moved.has(key)
        const fails = entry.basis === "check" && ev.outcome?.result === "fails"
        const room = Math.floor((box.w - v.length * 6.4 - 26) / 6.8)
        const nm = short(key)
        const label = `${figureLabel(key, entry, ev, v, `${entry.kind} · ${entry.basis}`, null)}${ev.stale ? ` · STALE: ${staleText(ev.stale)}` : g.moved.has(key) ? " · moved since a result read it" : ""}`
        return el(
          "g",
          { class: ["node", "pill", key === state.stack[state.at] ? "focus" : null, fails ? "fails" : warn ? "warn" : null].filter(Boolean).join(" "), "data-open": key, "data-id": key, "data-node": key, role: "link", tabindex: "0", "aria-label": label },
          el("title", {}, label),
          el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, class: "box" }),
          el("text", { x: box.x + 8, y: box.y + 15, class: "p-id" }, nm.length > room ? `${nm.slice(0, Math.max(1, room - 1))}…` : nm),
          el("text", { x: box.x + box.w - 8, y: box.y + 15, class: `p-val${fails ? " fail" : ""}` }, v),
        )
      },
    })
    return [head, basisLegend("amber = a stale result, an input that moved under one, or the line it went stale along"), h("div", { class: "graph-wrap", "data-key": `graph:group:${name}` }, svg), unread]
  }

  /** One entry, what it reads and what reads it, two steps each way. */
  function entryGraph(focus) {
    const inputs = inputsOf(doc, evaluation)
    const reach = (next, limit) => {
      const depth = new Map([[focus, 0]])
      const todo = [focus]
      while (todo.length) {
        const n = todo.shift()
        for (const m of next(n)) if (!depth.has(m) && doc.entries[m]) depth.set(m, depth.get(n) + 1), todo.push(m)
      }
      depth.delete(focus)
      const near = [...depth].filter(([, d]) => d <= limit).map(([m]) => m)
      return { near, further: depth.size - near.length }
    }
    const readersOf = (n) => [...(evaluation.readers.get(n) ?? [])].filter((r) => r !== n)
    const up = reach((n) => inputs.get(n) ?? [], 2)
    const down = reach(readersOf, 2)
    const nodes = [focus, ...new Set([...up.near, ...down.near])]
    const inGraph = new Set(nodes)
    const hot = staleLinks(evaluation)
    const edges = []
    for (const v of nodes) for (const u of inputs.get(v) ?? []) if (inGraph.has(u)) edges.push({ u, v, model: doc.entries[v].basis === "model", stale: hot.has(`${u}>${v}`) })
    const layout = layered(nodes, edges)
    const W = 216, H = 58
    const placed = placeLayered(layout, edges, () => ({ w: W, h: H, spread: true }), { gap: 56, vgap: 12, slot: 14 })
    const clip = (text, chars) => (text.length > chars ? `${text.slice(0, chars - 1)}…` : text)
    const svg = drawGraph(placed, {
      label: `inputs and outputs of ${focus}`,
      edge: ({ edge, chain }) => ({ cls: [edge.model ? "model" : null, chain.back ? "back" : null, edge.stale ? "hot" : null], width: 1.25, from: edge.u, to: edge.v, hot: edge.stale }),
      node: (id, p) => {
        const entry = doc.entries[id]
        const ev = evaluation.byId.get(id)
        const o = ev.outcome
        const flags = problems.filter((pr) => pr.id === id).map((pr) => pr.kind)
        const outcome = entry.basis === "check" ? o?.result ?? "?" : null
        const valueStr = valueText(id, doc, evaluation)
        const meta = `${{ corroborated: "●", supported: "◐", weak: "○", none: "◌", chosen: "◆" }[levelOf(ev)] ?? ""} ${entry.kind} · ${entry.basis}`.trim()
        const flag = flags.find((f) => f !== "FAILS" && f !== "DEPENDS")
        const cls = ["node", id === focus ? "focus" : null, outcome === "fails" || flags.includes("FAILS") ? "fails" : outcome === "depends" || flag ? "warn" : null].filter(Boolean).join(" ")
        const label = figureLabel(id, entry, ev, valueStr, meta, flag)
        return el(
          "g",
          { class: cls, "data-open": id, "data-id": id, "data-node": id, role: "link", tabindex: "0", "aria-label": label },
          el("title", {}, label),
          el("rect", { x: p.x, y: p.y, width: W, height: H, rx: 7, class: "box" }),
          el("text", { x: p.x + 10, y: p.y + 17, class: "g-id" }, clip(id, 26)),
          el("text", { x: p.x + 10, y: p.y + 34, class: `g-val${outcome === "fails" ? " fail" : outcome === "depends" ? " warn" : ""}` }, clip(valueStr, 30)),
          el("text", { x: p.x + 10, y: p.y + 50, class: "g-meta" }, clip(meta, flag ? 22 : 34), flag ? el("tspan", { class: "g-flag" }, ` · ${flag}`) : null),
        )
      },
    })
    const direct = (inputs.get(focus) ?? new Set()).size
    const readBy = readersOf(focus).filter((r) => doc.entries[r]).length
    const more = [up.further ? `${up.further} further input${up.further === 1 ? "" : "s"}` : null, down.further ? `${down.further} further output${down.further === 1 ? "" : "s"}` : null].filter(Boolean)
    return [
      h("p", { class: "structure-head" }, idLink(focus), ` reads ${direct} entr${direct === 1 ? "y" : "ies"} and ${readBy} read${readBy === 1 ? "s" : ""} it. Inputs on the left, outputs on the right, two steps each way${more.length ? `; ${more.join(" and ")} not drawn` : ""}. Open any box to follow it.`),
      h("p", { class: "quiet legend" }, "solid: formula or check input, always current · dashed: model input, recorded when the model ran · amber: went stale along this line"),
      h("div", { class: "graph-wrap", "data-key": `graph:${focus}` }, svg),
    ]
  }

  function figureLabel(id, entry, ev, valueText, meta, flag) {
    return `${id}${entry.label ? ` (${entry.label})` : ""}: ${valueText} · ${meta.replace(/^[●◐○◌◆] /, "")}${levelOf(ev) ? `, ${levelOf(ev)}` : ""}${flag ? ` · ${flag}` : ""}`
  }

  // ------------------------------------------------------------ panel

  function panel() {
    const id = state.stack[state.at]
    const entry = id ? doc.entries[id] : null
    if (!entry) return h("aside", { class: "panel empty", "data-key": "panel:none" }, h("p", { class: "quiet" }, "Open an entry to see where its number comes from."))
    const ev = evaluation.byId.get(id)
    const parts = entryParts(id, entry, evaluation, { scan: doc.scan, counts, problems })
    const cite = parts.find((p) => p.part === "cite")?.text
    const section = (title, body) => h("section", { "data-key": `s:${title}` }, h("h3", {}, title), body)
    return h(
      "aside",
      { class: "panel", "data-key": `panel:${id}`, "aria-label": `entry ${id}` },
      h(
        "nav",
        { class: "crumbs", "aria-label": "line of inquiry" },
        state.stack.slice(0, state.at + 1).map((s, i) => [i ? " › " : "", i === state.at ? h("strong", {}, s) : h("a", { href: "#", "data-crumb": String(i) }, s)]),
        h("button", { type: "button", class: "close", "data-close": "1", "aria-label": "close" }, "×"),
      ),
      h("h2", {}, glyph(levelOf(ev)), " ", id, entry.label ? h("span", { class: "quiet" }, ` ${entry.label}`) : null),
      section("Value", [
        h("p", { class: "figure" }, entry.basis === "check" ? `${ev.outcome?.lhs ? formatValue(ev.outcome.lhs) : "unbounded"} ${ev.outcome?.op ?? "?"} ${ev.outcome?.rhs ? formatValue(ev.outcome.rhs) : "unbounded"}` : `${formatValue(ev.value, entry.unit)}${formatBounds(ev.value) ? ` ${formatBounds(ev.value)}` : ""}`),
        h("p", {}, parts.find((p) => p.part === "status").text),
        cite ? h("p", { class: "quiet" }, "cite as ", h("code", {}, cite.replace(/^cite: /, ""))) : null,
        ev.confidence ? h("p", {}, confidenceText(entry, ev, evaluation)) : null,
        entry.note ? h("p", { class: "quiet" }, rich(entry.note)) : null,
      ]),
      section("Basis", basis(id, entry, ev)),
      section("Inputs", inputsSection(id, entry, ev)),
      section("Outputs", outputsSection(id)),
      section("Used in", usedIn(id)),
      section("Judgements and history", judgementsAndHistory(id, entry, ev)),
      h(
        "div",
        { class: "controls" },
        h("button", { type: "button", "data-form": "claim" }, "Add a claim"),
        h("button", { type: "button", "data-form": "judgement" }, "Add a judgement"),
        ["estimate", "choice", "formula", "check", "unknown"].includes(entry.basis) ? h("button", { type: "button", "data-form": "edit" }, "Edit") : null,
        entry.basis === "model" ? h("button", { type: "button", "data-form": "run" }, "Record a run") : null,
      ),
      state.form ? form(id, entry) : null,
    )
  }

  function basis(id, entry, ev) {
    switch (entry.basis) {
      case "claims": {
        const aside = new Map((entry.judgements ?? []).filter((j) => j.on && SET_ASIDE.includes(j.verdict)).map((j) => [j.on, j]))
        return [
          (entry.claims ?? []).map((c) => {
            const used = (ev.used ?? []).includes(c.key)
            const set = aside.get(c.key)
            const ctx = c.context
            return h(
              "div",
              { class: `claim${used ? " used" : ""}`, "data-key": `c:${c.key}` },
              h("div", {}, h("strong", {}, c.key), ` · ${used ? "used" : set ? `${set.verdict}: ${set.says ?? ""}` : "considered, not used"} · ${[c.sourceKind, c.subject].filter(Boolean).join(" · ") || "source"}${c.by?.kind === "person" ? ` · added by ${c.by.who ?? "a person"}` : ""}`),
              c.quote ? h("blockquote", {}, ctx ? [h("span", { class: "quiet" }, `…${ctx.before.slice(-120)}`), h("mark", {}, ctx.quote), h("span", { class: "quiet" }, `${ctx.after.slice(0, 120)}…`)] : h("mark", {}, c.quote)) : h("p", { class: "quiet" }, "no quote"),
              h("div", { class: "quiet" }, `read as: ${c.reading ?? "?"}${c.factor && c.factor !== 1 ? ` · × ${c.factor} into ${entry.unit ?? "the entry's unit"}` : ""} · ${c.lost === "missing" ? "QUOTE NO LONGER IN THE SOURCE" : c.lost === "unavailable" ? "source can't be opened to check" : c.verified ? "found in the kept source" : "quote not verified"}${c.section ? ` · near "${c.section}"` : ""}${c.conditions ? ` · ${c.conditions}` : ""}`),
              c.source ? h("div", {}, "source: ", docLink(c.source, "the kept source")) : h("div", { class: "quiet" }, "no source given"),
            )
          }),
          entry.pick ? h("p", {}, `pick: ${entry.pick.rule}${entry.pick.claim ? ` ${entry.pick.claim}` : ""}`, entry.pick.reason ? [" — ", rich(entry.pick.reason)] : null) : null,
        ]
      }
      case "formula": {
        const p = evaluation.parsed.get(id)
        if (!p?.formula) return h("p", {}, entry.formula ?? "")
        const show = (input) => formatValue(evaluation.byId.get(input)?.value, doc.entries[input]?.unit)
        return [
          h(
            "div",
            { class: "sheet" },
            h("div", {}, `${id} = ${renderFormula(p.formula.ast)}`),
            h("div", {}, `= ${renderFormula(p.formula.ast, show)}`),
            h("div", { class: "result" }, ev.broken ? `(${ev.broken})` : `= ${formatValue(ev.value, entry.unit)}${formatBounds(ev.value) ? ` ${formatBounds(ev.value)}` : ""}`),
          ),
        ]
      }
      case "model": {
        const ran = Object.keys(entry.model?.ran ?? {})
        return [
          h("p", {}, entry.model?.url ? docLink(entry.model.url, entry.model?.name ?? "the model") : entry.model?.name ?? "A model", `, tolerance ${entry.model?.tolerance ?? 0}`, entry.model?.ranAt ? ` · ran ${new Date(entry.model.ranAt).toLocaleString()}` : null, entry.model?.by?.kind === "person" ? ` by ${entry.model.by.who ?? "a person"}` : null),
          ran.length
            ? h(
                "ul",
                { class: "io" },
                ran.map((url) => {
                  const s = (ev.stale ?? []).find((r) => r.doc === url)
                  return h("li", {}, "read ", docLink(url, doc.scan?.docs?.[url]?.path || "a document"), s ? [" ", chip(s.reason === "changed" ? "CODE CHANGED" : "CAN'T OPEN")] : h("span", { class: "quiet" }, doc.scan?.docs?.[url] ? " · unchanged since the run" : " · not checked yet"))
                }),
              )
            : h("p", { class: "quiet" }, "No documents are recorded for this run, so a change to the model can't be noticed. Record a run to start."),
          ev.stale ? h("p", {}, chip("STALE"), ` ${staleText(ev.stale)}`) : null,
        ]
      }
      case "estimate":
        return h("p", {}, `estimate: ${formatValue(entry.estimate?.value, entry.unit)} — `, rich(entry.estimate?.reasoning ?? "no reasoning given"))
      case "unknown":
        return h("p", {}, `unknown${entry.unknown?.range ? `, somewhere in ${formatValue(entry.unknown.range, entry.unit)}` : ""}`, entry.unknown?.settle ? ["; settle by ", rich(entry.unknown.settle)] : null)
      case "choice":
        return [
          h("p", {}, `chosen: ${formatValue(entry.choice?.value, entry.unit)}`, entry.choice?.rationale ? [" — ", rich(entry.choice.rationale)] : null),
          (entry.choice?.alternatives ?? []).length ? h("ul", {}, entry.choice.alternatives.map((a) => h("li", {}, `over ${formatValue(a.value, entry.unit)}`, a.note ? [" — ", rich(a.note)] : null))) : null,
        ]
      case "check": {
        const o = ev.outcome ?? {}
        return [
          h("p", {}, linkify(entry.check ?? "")),
          entry.appliesIf ? h("p", {}, "applies if ", linkify(entry.appliesIf), ` (${o.applies})`) : null,
          h("p", {}, `over bounds: ${o.result} · over stated spreads: ${o.stated} · at nominal: ${o.nominal ?? "no nominal"}`),
          (o.settle ?? []).map((s) => h("p", {}, linkify(`${s.id} ${s.why}${s.settles ? `; narrowing it settles this (${s.settles})` : ""}`))),
        ]
      }
    }
    return null
  }

  function countLevels(ids) {
    const out = {}
    for (const id of ids) {
      const level = levelOf(evaluation.byId.get(id)) ?? "weak"
      out[level] = (out[level] ?? 0) + 1
    }
    return out
  }

  /** What it reads: each input now (and what a model ran with), then the leaves far upstream. */
  function inputsSection(id, entry, ev) {
    const io = entryIO(doc, evaluation, id)
    const direct = new Set(io.inputs.map((i) => i.id))
    const leaves = [...(ev.leaves ?? [])].filter((l) => l !== id).sort((a, b) => RANK[levelOf(evaluation.byId.get(a)) ?? "weak"] - RANK[levelOf(evaluation.byId.get(b)) ?? "weak"] || (a < b ? -1 : 1))
    return [
      io.inputs.length
        ? h(
            "ul",
            { class: "io" },
            io.inputs.map((i) =>
              h(
                "li",
                {},
                glyph(levelOf(evaluation.byId.get(i.id))),
                " ",
                idLink(i.id),
                ` = ${valueText(i.id, doc, evaluation)}`,
                i.ranWith ? h("span", { class: "quiet" }, ` · ran with ${formatValue(i.ranWith, doc.entries[i.id]?.unit)}`) : null,
                i.stale ? [" ", chip(i.stale === "moved" ? "MOVED" : "STALE")] : null,
              ),
            ),
          )
        : h("p", { class: "quiet" }, `None: ${readsNothingText(entry)}.`),
      leaves.some((l) => !direct.has(l)) ? h("p", { class: "quiet" }, `At the far end it ${restsOnText(ev.confidence?.restsOn ?? countLevels(leaves))}: `, leaves.map((l, i) => [i ? ", " : "", glyph(levelOf(evaluation.byId.get(l))), idLink(l)])) : null,
    ]
  }

  /** What reads it, directly and further on, with any already stale. */
  function outputsSection(id) {
    const io = entryIO(doc, evaluation, id)
    const open = h("p", {}, h("button", { type: "button", class: "link", "data-structure-entry": id }, "Open in Structure"))
    if (!io.outputs.length) return [h("p", { class: "quiet" }, "Nothing in the register reads it."), open]
    return [
      h("p", { class: "quiet" }, `${io.outputs.length} direct · ${io.further.length} further`),
      h(
        "ul",
        { class: "io" },
        io.outputs.map((o) => h("li", {}, glyph(levelOf(evaluation.byId.get(o.id))), " ", idLink(o.id), ` = ${valueText(o.id, doc, evaluation)}`, o.stale ? [" ", chip("STALE"), h("span", { class: "quiet" }, ` ${staleText(o.stale)}`)] : null)),
      ),
      io.further.length ? h("p", {}, "further: ", io.further.slice(0, 12).map((f, i) => [i ? ", " : "", idLink(f)]), io.further.length > 12 ? ` and ${io.further.length - 12} more` : "") : null,
      open,
    ]
  }

  function usedIn(id) {
    if (!doc.scan) return h("p", { class: "quiet" }, "Not checked yet: Check the folder looks through the task folder.")
    const uses = usesOf(doc.scan, id)
    const disagreeing = problems.filter((p) => p.kind === "PROSE" && p.id === id).map((p) => p.text)
    return [
      h("p", { class: "quiet" }, `meant ${{ model: "for computing with", reference: "as context for prose", unused: "to stay unused" }[intendedUse(doc.entries[id])]}; ${{ model: "a model computes with it", prose: "only prose cites it", nowhere: "nothing uses it" }[observedUse(id, doc.entries[id], evaluation.readers, doc.scan)]}${doc.entries[id].use?.note ? ` — ${doc.entries[id].use.note}` : ""}`),
      uses.length
        ? h(
            "ul",
            { class: "uses" },
            uses.slice(0, 30).map((u) =>
              h("li", { class: disagreeing.some((t) => t.includes(`"${u.doc}"`) && t.includes(`line ${u.line} `)) ? "disagrees" : null }, `${u.use} · `, h("button", { type: "button", class: "link", "data-doc": u.url }, `${u.doc}${u.part ? ` ${u.part}` : ""}:${u.line}`), h("code", {}, u.text)),
            ),
          )
        : h("p", { class: "quiet" }, "no document names it"),
    ]
  }

  function judgementsAndHistory(id, entry, ev) {
    const items = (entry.judgements ?? []).map((j) => {
      let changed = null
      if (j.at?.length && typeof handle.view === "function") {
        try {
          changed = definition(handle.view(j.at).doc()?.entries?.[id]) !== definition(entry)
        } catch {}
      }
      return h(
        "li",
        { "data-key": `jj:${j.key}` },
        ev.support?.conflicts?.some((c) => c.from === j.key) ? [chip("CONFLICT"), " "] : null,
        `${j.by?.kind === "person" ? j.by.who ?? "a person" : "the agent"}${j.on ? ` on ${j.on}` : ""}: ${j.verdict}${j.value != null ? ` ${formatValue(j.value, entry.unit)}` : ""}`,
        j.says ? [" — ", h("q", {}, rich(j.says))] : null,
        changed ? h("span", { class: "quiet" }, " · the entry has changed since") : null,
        j.answer ? h("div", { class: "answer" }, `answered: ${j.answer.says}`) : null,
      )
    })
    return [
      items.length ? h("ul", { class: "judgements" }, items) : h("p", { class: "quiet" }, "no judgements"),
      state.history?.id === id
        ? h("ol", { class: "history" }, state.history.items.length ? state.history.items.map((c) => h("li", {}, `${c.time ? new Date(c.time * 1000).toLocaleString() : "—"} · ${c.message ?? "no message"}`)) : h("li", { class: "quiet" }, "no changes found"))
        : h("button", { type: "button", class: "link", "data-history": id }, "Show history"),
    ]
  }

  /** The changes that touched one entry's definition, newest first, from the document's own history. */
  function historyOf(id) {
    try {
      const all = handle.history?.() ?? []
      const start = Math.max(0, all.length - 200)
      const items = []
      for (let i = all.length - 1; i >= start; i--) {
        const before = i === 0 ? [] : all[i - 1]
        const patches = handle.diff(before, all[i])
        if (!patches.some((p) => p.path[0] === "entries" && p.path[1] === id && !MEMO.includes(p.path[2]))) continue
        const meta = handle.metadata?.(all[i][0])
        items.push({ time: meta?.time ?? null, message: meta?.message ?? null })
        if (items.length >= 30) break
      }
      return items
    } catch {
      return []
    }
  }

  // ------------------------------------------------------------ forms

  const field = (name, label, value = "") => h("label", {}, `${label} `, h("input", { name, value }))

  function form(id, entry) {
    const name = readName()
    const error = state.error ? h("p", { class: "error", role: "alert" }, state.error) : null
    const buttons = (label) => [h("button", { type: "submit" }, label), h("button", { type: "button", "data-cancel": "1" }, "Cancel")]
    if (state.form === "claim") {
      return h(
        "form",
        { "data-submit": "claim", "data-key": "form:claim" },
        h("h3", {}, "Add a claim"),
        field("source", "Source (automerge: URL of a kept document, or a web URL)"),
        field("quote", "Quote, verbatim, qualifier and all"),
        field("stated", "The figure as the quote gives it ('≤ 0.25', '5.42 ± 0.3')"),
        h("label", {}, "Kind of source ", h("select", { name: "sourceKind" }, SOURCE_KINDS.map((k) => h("option", { value: k }, k)))),
        field("subject", "Subject: product and edition"),
        field("factor", "Factor into the entry's unit (default 1)"),
        field("who", "Your name", name),
        ["estimate", "unknown"].includes(entry.basis) ? h("p", { class: "quiet" }, `A claim replaces the ${entry.basis}: the value will come from this source.`) : null,
        error,
        buttons("Add claim"),
      )
    }
    if (state.form === "run") {
      const ran = Object.keys(entry.model?.ran ?? {})
      const docs = ran.length ? ran : entry.model?.url ? [entry.model.url] : []
      const current = entry.model?.value
      return h(
        "form",
        { "data-submit": "run", "data-key": "form:run" },
        h("h3", {}, "Record a run"),
        h("p", { class: "quiet" }, `Run ${entry.model?.name ?? "the model"} with the inputs as they are now, then give its output here. The register records the inputs' values and the version of `, docs.length ? docs.map((u, i) => [i ? ", " : "", docLink(u, doc.scan?.docs?.[u]?.path || "a document")]) : "no documents", "."),
        field("value", "Its output ('42', '40–44', '42 (40–44)')", current == null ? "" : `${formatValue(current).replace(/^"|"$/g, "")}${formatBounds(current)?.startsWith("(") ? ` ${formatBounds(current)}` : ""}`),
        field("who", "Your name", name),
        error,
        buttons("Record run"),
      )
    }
    if (state.form === "judgement") {
      const onClaims = (entry.claims ?? []).flatMap((c) => SET_ASIDE.map((v) => [`${v}:${c.key}`, `claim ${c.key} is ${v.replace("-", " ")}`]))
      return h(
        "form",
        { "data-submit": "judgement", "data-key": "form:judgement" },
        h("h3", {}, "Add a judgement"),
        h("label", {}, "What you judge ", h("select", { name: "verdict" }, [["agrees", "the value is right"], ["disagrees", "the value is wrong"], ["value", "the value should be…"], ...onClaims].map(([v, label]) => h("option", { value: v }, label)))),
        field("value", "Your value or range, if you give one ('0.1–0.3')"),
        h("label", {}, "Why ", h("textarea", { name: "says", rows: "3" })),
        field("who", "Your name", name),
        h("p", { class: "quiet" }, `path: ${state.stack.slice(0, state.at + 1).join(" › ")}`),
        error,
        buttons("Add judgement"),
      )
    }
    const current = entry.basis === "estimate" ? entry.estimate?.value : entry.basis === "choice" ? entry.choice?.value : entry.basis === "unknown" ? entry.unknown?.range : null
    const shown = current == null ? "" : `${formatValue(current).replace(/^"|"$/g, "")}${formatBounds(current) && formatBounds(current).startsWith("(") ? ` ${formatBounds(current)}` : ""}`
    return h(
      "form",
      { "data-submit": "edit", "data-key": "form:edit" },
      h("h3", {}, `Edit ${id}`),
      ["estimate", "choice", "unknown"].includes(entry.basis) ? field("value", entry.basis === "unknown" ? "Range, if known" : "Value", shown) : null,
      entry.basis === "estimate" ? field("reasoning", "Reasoning", entry.estimate?.reasoning ?? "") : null,
      entry.basis === "formula" ? field("formula", "Formula", entry.formula ?? "") : null,
      entry.basis === "check" ? field("check", "Check", entry.check ?? "") : null,
      h("label", {}, `Why${peoplesMarks(entry).length ? " (needed: a person has added to it)" : ""} `, h("input", { name: "why" })),
      field("who", "Your name", name),
      state.preview ? h("p", { class: "preview" }, state.preview) : null,
      error,
      h("button", { type: "button", "data-preview": "1" }, "What would this change?"),
      buttons("Save"),
    )
  }

  function editFrom(entry, data) {
    const get = (k) => String(data.get(k) ?? "").trim()
    const value = () => parseValue(get("value"))
    if (entry.basis === "estimate") {
      const parsed = value()
      if (parsed.problem) return { problem: parsed.problem }
      if (!get("reasoning")) return { problem: "An estimate carries its reasoning." }
      return { fields: { estimate: { value: parsed.value, reasoning: get("reasoning") } } }
    }
    if (entry.basis === "choice") {
      const parsed = value()
      return parsed.problem ? { problem: parsed.problem } : { fields: { choice: { ...plain(entry.choice), value: parsed.value } } }
    }
    if (entry.basis === "unknown") {
      if (!get("value")) return { fields: { unknown: { ...plain(entry.unknown), range: null } } }
      const parsed = value()
      return parsed.problem ? { problem: parsed.problem } : { fields: { unknown: { ...plain(entry.unknown), range: parsed.value } } }
    }
    if (entry.basis === "formula") return { fields: { formula: get("formula") } }
    if (entry.basis === "check") return { fields: { check: get("check") } }
    return { problem: "This entry changes through its claims or its model." }
  }

  async function submit(kind, data) {
    const id = state.stack[state.at]
    const entry = doc.entries[id]
    const who = String(data.get("who") ?? "").trim()
    saveName(who)
    const by = { kind: "person", who: who || null }
    const at = heads()
    const message = (why) => `${who || "a person"}: ${why}`
    const nextKey = (list, prefix) => {
      const keys = new Set((list ?? []).map((x) => x.key))
      let n = 1
      while (keys.has(`${prefix}${n}`)) n++
      return `${prefix}${n}`
    }
    if (kind === "claim") {
      const source = String(data.get("source") ?? "").trim() || null
      const read = await readSource(repo, source)
      const text = read?.text ?? null
      const raw = { source, quote: String(data.get("quote") ?? "").trim() || null, stated: String(data.get("stated") ?? "").trim(), sourceKind: String(data.get("sourceKind")) }
      const checked = checkClaim(raw, { sourceText: text, unit: entry.unit ?? "" })
      if (checked.problem) return fail(checked.problem)
      const factor = Number(data.get("factor") || 1)
      if (!Number.isFinite(factor) || factor === 0) return fail("The factor is a non-zero number.")
      handle.change(
        (d) => {
          const e = d.entries[id]
          const claim = plain({ key: nextKey(e.claims, "c"), source, quote: raw.quote, stated: checked.claim.stated, factor, subject: String(data.get("subject") ?? "") || null, sourceKind: raw.sourceKind, origin: null, verified: checked.claim.verified, reading: checked.claim.reading, section: checked.claim.section, context: checked.claim.context, seen: checked.claim.verified ? read.seen : null, lost: null, by, at })
          if (!e.claims) e.claims = []
          e.claims.push(claim)
          if (e.basis === "estimate" || e.basis === "unknown") {
            delete e[e.basis]
            e.basis = "claims"
            e.pick = { rule: "one", claim: claim.key, reason: "a source replaces the estimate", considered: [claim.key], by }
          }
          materialize(d, evaluate(d), { at })
        },
        { message: message(`add a claim to ${id}`) },
      )
    } else if (kind === "run") {
      const parsed = parseValue(String(data.get("value") ?? ""))
      if (parsed.problem) return fail(`Its output: ${parsed.problem}`)
      const ran = Object.keys(entry.model?.ran ?? {})
      let run
      try {
        run = await runRecord(repo, ran.length ? ran : entry.model?.url ? [entry.model.url] : [])
      } catch (error) {
        return fail(`Couldn't record the run: ${error.message}.`)
      }
      handle.change(
        (d) => {
          const e = d.entries[id]
          e.model.value = plain(parsed.value)
          e.model.ran = plain(run.ran)
          e.model.ranAt = run.ranAt
          e.model.at = plain(at)
          e.model.by = plain(by)
          recordInputs(e, evaluate(d))
          materialize(d, evaluate(d), { at })
        },
        { message: message(`record a run of ${entry.model?.name ?? id}: ${formatValue(parsed.value, entry.unit)}`) },
      )
    } else if (kind === "judgement") {
      const [verdict, on = null] = String(data.get("verdict")).split(":")
      const says = String(data.get("says") ?? "").trim()
      if (verdict !== "agrees" && !says) return fail("Say why: a judgement without a reason gives the agent nothing to act on.")
      let value = null
      if (verdict === "value") {
        const parsed = parseValue(String(data.get("value") ?? ""))
        if (parsed.problem) return fail(`Your value: ${parsed.problem}`)
        value = parsed.value
      }
      handle.change(
        (d) => {
          const e = d.entries[id]
          if (!e.judgements) e.judgements = []
          e.judgements.push(plain({ key: nextKey(e.judgements, "j"), by, at, on, verdict, says: says || null, value, path: state.stack.slice(0, state.at + 1).join(" › ") }))
          materialize(d, evaluate(d), { at })
        },
        { message: message(`judge ${id}: ${verdict}`) },
      )
    } else {
      const change = editFrom(entry, data)
      if (change.problem) return fail(change.problem)
      const why = String(data.get("why") ?? "").trim()
      if (peoplesMarks(entry).length && !why) return fail("Say why: a person has added evidence or judgement to this entry.")
      handle.change(
        (d) => {
          Object.assign(d.entries[id], plain(change.fields))
          materialize(d, evaluate(d), { at })
        },
        { message: message(why || `edit ${id}`) },
      )
    }
    state.form = null
    state.error = null
    state.preview = null
    render()
  }

  /** What an edit would do, evaluated on an unsaved copy: "changes 4 results; fuse_ok goes from holds to depends". */
  function preview(data) {
    const id = state.stack[state.at]
    const change = editFrom(doc.entries[id], data)
    if (change.problem) return fail(change.problem)
    const copy = plain(doc)
    Object.assign(copy.entries[id], change.fields)
    const after = evaluate(copy)
    let values = 0
    const outcomes = []
    for (const [other, ev] of after.byId) {
      const was = evaluation.byId.get(other)
      if (other !== id && JSON.stringify(ev.value ?? null) !== JSON.stringify(was?.value ?? null)) values++
      if (ev.outcome && was?.outcome && ev.outcome.result !== was.outcome.result) outcomes.push(`${other} goes from ${was.outcome.result} to ${ev.outcome.result}`)
    }
    const broken = after.byId.get(id).broken
    state.preview = broken ? `This would break it: ${broken}.` : `Changes ${values} other result${values === 1 ? "" : "s"}${outcomes.length ? `; ${outcomes.join("; ")}` : "; no requirement changes its outcome"}.`
    state.error = null
    render()
  }

  function fail(message) {
    state.error = message
    render()
  }

  // ------------------------------------------------------------ events

  function openEntry(id) {
    if (!doc.entries[id]) return
    state.stack = state.stack.slice(0, state.at + 1)
    if (state.stack[state.at] !== id) state.stack.push(id)
    state.at = state.stack.length - 1
    state.cursor = id
    state.form = null
    state.error = null
    state.preview = null
    render()
  }

  function openForm(kind) {
    if (!state.stack[state.at]) return
    state.form = kind
    state.error = null
    state.preview = null
    render()
    root.querySelector("form input, form select")?.focus()
  }

  function onClick(event) {
    const target = event.target.closest?.("[data-open], [data-lens], [data-group], [data-sgroup], [data-structure], [data-structure-entry], [data-show-unread], [data-crumb], [data-close], [data-form], [data-cancel], [data-check], [data-check-stop], [data-doc], [data-history], [data-preview], tr[data-id], li[data-id]")
    if (!target || !root.contains(target)) return
    const d = target.dataset
    if (d.open) {
      event.preventDefault()
      if (state.lens === "structure" && doc.entries[d.open]) state.structure = { ...state.structure, group: groupOf(d.open), entry: d.open }
      openEntry(d.open)
    } else if (d.sgroup) {
      event.preventDefault()
      state.structure = { group: d.sgroup, entry: null, unread: false }
      render()
    } else if (d.structure) {
      event.preventDefault()
      state.structure = d.structure === "map" ? { group: null, entry: null, unread: false } : { ...state.structure, entry: null }
      render()
    } else if (d.structureEntry) {
      if (!doc.entries[d.structureEntry]) return
      state.lens = "structure"
      state.structure = { group: groupOf(d.structureEntry), entry: d.structureEntry, unread: false }
      render()
    } else if (d.showUnread) {
      state.structure = { ...state.structure, unread: !state.structure.unread }
      render()
    } else if (d.lens) {
      state.lens = d.lens
      state.cursor = null
      render()
    } else if (d.group) {
      const open = target.getAttribute("aria-expanded") === "true"
      ;(open ? state.open : state.closed).delete(d.group)
      ;(open ? state.closed : state.open).add(d.group)
      render()
    } else if (d.crumb) {
      event.preventDefault()
      state.at = Number(d.crumb)
      render()
    } else if (d.close) {
      state.stack = []
      state.at = -1
      state.form = null
      render()
    } else if (d.checkStop) checkController?.abort()
    else if (d.check) void check(false)
    else if (d.form) openForm(d.form)
    else if (d.cancel) {
      state.form = null
      state.error = null
      state.preview = null
      render()
    } else if (d.doc) {
      event.preventDefault()
      root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: d.doc, title: titles.get(d.doc) ?? undefined }, bubbles: true, composed: true }))
    }
    else if (d.history) {
      state.history = { id: d.history, items: historyOf(d.history) }
      render()
    } else if (d.preview) preview(new FormData(target.closest("form")))
    else if (d.id) openEntry(d.id)
  }

  /**
   * The folder check, as the agent runs it, with its progress on the summary
   * line and a Stop. `quiet` (on open) adds no change unless it found something.
   */
  let checkController = null
  let redraw = null
  const soon = () => {
    redraw ??= setTimeout(() => {
      redraw = null
      if (!disposed) render()
    }, 100)
  }
  async function check(quiet) {
    if (!repo || state.checking) return
    checkController = new AbortController()
    state.checking = true
    state.checkError = null
    state.checkNote = null
    state.progress = { documents: null, sources: null }
    render()
    try {
      const who = readName()
      const result = await checkFolder(handle, repo, {
        quiet,
        signal: checkController.signal,
        onProgress: (p) => {
          state.progress = { ...state.progress, [p.phase]: p }
          soon()
        },
        message: quiet ? "register: rescan on open" : `${who || "a person"}: check the folder`,
      })
      if (result.stopped) state.checkNote = "Stopped; the last check stands."
      else if (result.runs?.length) state.checkNote = `Read ${result.runs.length} result${result.runs.length === 1 ? "" : "s"} from ${[...new Set(result.runs.map((r) => r.path || "a model"))].join(", ")}.`
      else if (!result.scan && !quiet) state.checkError = "Nothing to check: this register has no task folder, model runs or kept sources."
    } catch (error) {
      state.checkError = `The check stopped: ${error.message}`
    }
    checkController = null
    state.checking = false
    if (!disposed) render()
    if (checkAgain && !disposed) {
      checkAgain = false
      void check(true)
    }
  }

  // The model documents, watched while the register is open: run one (in
  // another tab, say) and its results come in here without anyone copying them.
  const watched = new Map()
  let checkAgain = false
  let modelTimer = null
  const modelChanged = () => {
    clearTimeout(modelTimer)
    modelTimer = setTimeout(() => {
      if (disposed) return
      if (state.checking) checkAgain = true
      else void check(true)
    }, options.settleMs ?? MODEL_SETTLE_MS)
  }
  function watchModels() {
    if (!repo) return
    for (const url of runDocuments(doc.entries)) {
      if (watched.has(url)) continue
      watched.set(url, null)
      Promise.resolve()
        .then(() => repo.find(url))
        .then((found) => {
          if (disposed || typeof found?.on !== "function") return
          found.on("change", modelChanged)
          watched.set(url, found)
        })
        .catch(() => {})
    }
  }

  function onInput(event) {
    const name = event.target.dataset?.filter
    if (!name) return
    state[name] = event.target.value
    render()
  }

  function onSubmit(event) {
    const form = event.target.closest("form[data-submit]")
    if (!form) return
    event.preventDefault()
    void submit(form.dataset.submit, new FormData(form))
  }

  function onKey(event) {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
    if (event.key === "Escape") {
      if (state.form) state.form = null
      else {
        state.stack = []
        state.at = -1
      }
      state.error = null
      if (typing) event.target.blur()
      render()
      return
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return
    const ids = [...new Set([...root.querySelectorAll("main [data-id]")].map((n) => n.dataset.id))]
    const move = (step) => {
      const i = ids.indexOf(state.cursor)
      state.cursor = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + step))] ?? null
      render()
      root.querySelector(`main [data-id="${state.cursor}"]`)?.scrollIntoView?.({ block: "nearest" })
    }
    const keys = {
      j: () => move(1),
      k: () => move(-1),
      Enter: () => (event.target.dataset?.open || event.target.dataset?.sgroup ? onClick({ target: event.target, preventDefault() {} }) : state.cursor && openEntry(state.cursor)),
      a: () => openForm("claim"),
      d: () => openForm("judgement"),
      "[": () => {
        if (state.at > 0) state.at--
        render()
      },
      "]": () => {
        if (state.at < state.stack.length - 1) state.at++
        render()
      },
      "/": () => {
        if (state.lens !== "entries") {
          state.lens = "entries"
          render()
        }
        root.querySelector('input[data-filter="q"]')?.focus()
      },
    }
    const action = keys[event.key]
    if (!action) return
    event.preventDefault()
    action()
  }

  // Pointing at (or tabbing to) a node in a graph lights its lines and the nodes at their other ends.
  function light(event) {
    const node = event.target.closest?.("svg.graph [data-node]")
    if (!node) return
    const svg = node.closest("svg")
    const key = node.dataset.node
    svg.classList.add("lit")
    node.classList.add("on")
    for (const path of svg.querySelectorAll("path.edge")) {
      const { u, v } = path.dataset
      if (u !== key && v !== key) continue
      path.classList.add("on")
      const other = u === key ? v : u
      for (const n of svg.querySelectorAll("[data-node]")) if (n.dataset.node === other) n.classList.add("on")
    }
  }
  function unlight(event) {
    const svg = event.target.closest?.("svg.graph")
    if (!svg) return
    svg.classList.remove("lit")
    for (const n of svg.querySelectorAll(".on")) n.classList.remove("on")
  }

  repair()
  render()
  handle.on("change", render)
  void check(true)
  root.addEventListener("pointerover", light)
  root.addEventListener("pointerout", unlight)
  root.addEventListener("focusin", light)
  root.addEventListener("focusout", unlight)
  root.addEventListener("click", onClick)
  root.addEventListener("input", onInput)
  root.addEventListener("change", onInput)
  root.addEventListener("submit", onSubmit)
  root.addEventListener("keydown", onKey)
  return () => {
    disposed = true
    checkController?.abort()
    clearTimeout(redraw)
    clearTimeout(modelTimer)
    for (const found of watched.values()) found?.off?.("change", modelChanged)
    handle.off("change", render)
    root.removeEventListener("pointerover", light)
    root.removeEventListener("pointerout", unlight)
    root.removeEventListener("focusin", light)
    root.removeEventListener("focusout", unlight)
    root.removeEventListener("click", onClick)
    root.removeEventListener("input", onInput)
    root.removeEventListener("change", onInput)
    root.removeEventListener("submit", onSubmit)
    root.removeEventListener("keydown", onKey)
    root.remove()
    style.remove()
  }
}

const SVG = "http://www.w3.org/2000/svg"

function el(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v))
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(typeof k === "string" ? document.createTextNode(k) : k)
  return n
}

/**
 * Draws a placed layered layout (structure.js, placeLayered): lines first,
 * boxes over them. `edge(line)` gives a line's classes, width and true ends
 * (`from` reads into `to`; a `flipped` line is drawn from its reader, so its
 * arrowhead goes at the start). `node(key, box)` draws a box.
 */
function drawGraph(placed, { label, edge, node }) {
  const svg = el("svg", { class: "graph", width: Math.ceil(placed.width), height: Math.ceil(placed.height), viewBox: `0 0 ${Math.ceil(placed.width)} ${Math.ceil(placed.height)}`, role: "group", "aria-label": label })
  const marker = (id, cls) => el("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerUnits: "userSpaceOnUse", markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, el("path", { d: "M0 0L10 5L0 10z", class: cls }))
  svg.append(el("defs", {}, marker("asm-arrow", "arrowhead"), marker("asm-arrow-hot", "arrowhead hot")))
  const lines = el("g", { class: "edges" })
  const hot = el("g", { class: "edges" })
  for (const line of placed.lines) {
    const a = edge(line)
    const tip = a.hot ? "url(#asm-arrow-hot)" : "url(#asm-arrow)"
    ;(a.hot ? hot : lines).append(el("path", { d: line.d, class: ["edge", ...(a.cls ?? [])].filter(Boolean).join(" "), "stroke-width": a.width, "data-u": a.from, "data-v": a.to, "marker-start": a.flipped ? tip : null, "marker-end": a.flipped ? null : tip }))
  }
  svg.append(lines, hot)
  for (const [key, box] of placed.boxes) if (!box.virtual) svg.append(node(key, box))
  return svg
}

const CSS = `
/* Colours come from Patchwork's theme (--studio-*), which also sets color-scheme;
   the fallbacks follow color-scheme too, so text and background never disagree. */
.asm { --bg: var(--studio-fill, Canvas); --ink: var(--studio-line, CanvasText);
  --quiet: var(--studio-line-offset-30, color-mix(in oklch, var(--ink), var(--bg) 40%));
  --rule: var(--studio-fill-offset-30, color-mix(in oklch, var(--bg), var(--ink) 15%));
  --panel: var(--studio-fill-offset-20, color-mix(in oklch, var(--bg), var(--ink) 5%));
  --accent: var(--studio-link, light-dark(#2a5bd7, #7aa2ff));
  --warn: var(--studio-warning, light-dark(#a15c00, #f3b25a)); --fail: var(--studio-danger, light-dark(#b3261e, #ff8a80));
  --warn-bg: color-mix(in oklch, var(--warn) 18%, var(--bg)); --fail-bg: color-mix(in oklch, var(--fail) 18%, var(--bg));
  font: 13px/1.45 system-ui, -apple-system, sans-serif; color: var(--ink); background: var(--bg); height: 100%; display: flex; flex-direction: column; outline: none; }
.asm header { padding: 12px 16px 0; border-bottom: 1px solid var(--rule); }
.asm h1 { font-size: 16px; margin: 0 0 2px; }
.asm .summary { margin: 0 0 8px; color: var(--quiet); }
.asm .summary .progress { color: var(--ink); font-variant-numeric: tabular-nums; }
.asm nav[role=tablist] button { font: inherit; background: none; border: none; border-bottom: 2px solid transparent; padding: 6px 10px; color: var(--quiet); cursor: pointer; }
.asm nav[role=tablist] button[aria-selected=true] { color: var(--ink); border-bottom-color: var(--accent); }
.asm .body { flex: 1; display: flex; min-height: 0; }
.asm .lens { flex: 1; overflow: auto; padding: 8px 16px 24px; min-width: 0; }
.asm .panel { width: 42%; max-width: 560px; border-left: 1px solid var(--rule); background: var(--panel); overflow: auto; padding: 8px 16px 24px; }
@media (max-width: 720px) { .asm .body { flex-direction: column; } .asm .panel { width: auto; max-width: none; border-left: none; border-top: 1px solid var(--rule); } }
.asm h2 { font-size: 14px; margin: 14px 0 6px; }
.asm h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--quiet); margin: 14px 0 4px; }
.asm .quiet { color: var(--quiet); }
.asm a.id, .asm td.id, .asm code, .asm .sheet, .asm .figure { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.asm a { color: var(--accent); text-decoration: none; }
.asm a:hover { text-decoration: underline; }
.asm table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
.asm th { text-align: left; font-weight: 500; color: var(--quiet); border-bottom: 1px solid var(--rule); padding: 4px 6px; position: sticky; top: 0; background: var(--bg); }
.asm td { padding: 3px 6px; border-bottom: 1px solid var(--rule); vertical-align: top; }
.asm td.value { text-align: right; white-space: nowrap; }
.asm td.bounds, .asm td.evidence, .asm td.uses, .asm td.judgements { color: var(--quiet); }
.asm td.bounds { white-space: nowrap; }
.asm td.flags .chip { margin: 1px 0; }
.asm td.evidence { max-width: 16em; }
.asm td.status { min-width: 9em; }
.asm tr.group th { position: static; background: none; padding-top: 10px; }
.asm tr.group button { font: inherit; font-weight: 600; background: none; border: none; color: var(--ink); cursor: pointer; padding: 0; text-align: left; }
.asm tr.entry { cursor: pointer; }
.asm tr.selected, .asm .cursor { box-shadow: inset 3px 0 0 var(--accent); }
.asm td.status::before, .asm .glyph::before { margin-right: 4px; }
.asm [data-level=corroborated]::before { content: "●"; } .asm [data-level=supported]::before { content: "◐"; }
.asm [data-level=weak]::before { content: "○"; } .asm [data-level=none]::before { content: "◌"; } .asm [data-level=chosen]::before { content: "◆"; }
.asm .chip { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .03em; padding: 0 5px; border-radius: 3px; color: var(--ink); border: 1px solid transparent; }
.asm .chip.warn { background: var(--warn-bg); border-color: var(--warn); }
.asm .chip.fail { background: var(--fail-bg); border-color: var(--fail); }
.asm ul.queue { list-style: none; padding: 0; margin: 0; }
.asm ul.queue li { padding: 6px 4px; border-bottom: 1px solid var(--rule); cursor: pointer; }
.asm .fix { color: var(--quiet); margin-left: 2em; }
.asm .filters { display: flex; gap: 8px; margin: 4px 0 8px; flex-wrap: wrap; }
.asm .filters input { flex: 1; min-width: 160px; }
.asm input, .asm select, .asm textarea { font: inherit; padding: 3px 6px; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg); color: var(--ink); }
.asm .margin svg .range { fill: var(--quiet); opacity: .5; } .asm .margin svg .range.over, .asm .margin svg .arrow.over { fill: var(--fail); opacity: .8; }
.asm .margin svg .arrow { fill: var(--quiet); } .asm .margin svg .limit { stroke: var(--ink); stroke-width: 1; } .asm .margin svg .nominal { stroke: var(--ink); stroke-width: 2; }
.asm .crumbs { display: flex; align-items: center; gap: 2px; color: var(--quiet); font-family: ui-monospace, monospace; font-size: 12px; flex-wrap: wrap; }
.asm .crumbs .close { margin-left: auto; font-size: 16px; background: none; border: none; color: var(--quiet); cursor: pointer; }
.asm blockquote { margin: 4px 0; padding: 4px 8px; border-left: 2px solid var(--rule); font-family: ui-monospace, monospace; font-size: 12px; white-space: pre-wrap; }
.asm mark { background: var(--warn-bg); color: inherit; }
.asm .claim { margin: 8px 0; }
.asm .sheet div { padding: 1px 0; } .asm .sheet .result { font-weight: 600; }
.asm ul.inputs, .asm ul.uses, .asm ul.judgements, .asm ol.history { padding-left: 1.2em; margin: 4px 0; }
.asm ul.uses code { display: block; color: var(--quiet); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.asm li.disagrees { box-shadow: inset 3px 0 0 var(--warn); }
.asm button.link { font: inherit; background: none; border: none; padding: 0; color: var(--accent); cursor: pointer; }
.asm .controls { display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap; }
.asm .controls button, .asm form button { font: inherit; padding: 3px 10px; border: 1px solid var(--rule); border-radius: 4px; background: var(--bg); color: var(--ink); cursor: pointer; }
.asm form { display: grid; gap: 6px; margin-top: 10px; padding: 10px; border: 1px solid var(--rule); border-radius: 6px; background: var(--bg); }
.asm form label { display: grid; gap: 2px; color: var(--quiet); }
.asm .error { color: var(--fail); margin: 0; } .asm .preview { margin: 0; }
.asm .structure-head { margin: 4px 0 0; } .asm .legend { margin: 2px 0 8px; font-size: 12px; }
.asm .graph-wrap { overflow: auto; }
.asm svg.graph { display: block; }
.asm svg.graph .box { fill: var(--bg); stroke: var(--quiet); stroke-width: 1.25; }
.asm svg.graph .node { cursor: pointer; outline: none; }
.asm svg.graph .node:hover .box, .asm svg.graph .node:focus .box { stroke: var(--accent); stroke-width: 2; }
.asm svg.graph .node.focus .box { stroke: var(--accent); stroke-width: 2; fill: color-mix(in oklch, var(--accent) 12%, var(--bg)); }
.asm svg.graph .node.warn .box { stroke: var(--warn); } .asm svg.graph .node.fails .box { stroke: var(--fail); }
.asm svg.graph .node.focus.warn .box { stroke: var(--warn); } .asm svg.graph .node.focus.fails .box { stroke: var(--fail); }
.asm svg.graph .g-id { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--ink); }
.asm svg.graph .g-val { font-size: 12px; fill: var(--ink); font-variant-numeric: tabular-nums; } .asm svg.graph .g-val.fail { fill: var(--fail); font-weight: 600; } .asm svg.graph .g-val.warn { font-weight: 600; }
.asm svg.graph .g-meta { font-size: 11px; fill: var(--quiet); } .asm svg.graph .g-flag { font-weight: 600; fill: var(--ink); }
.asm svg.graph { max-width: 100%; height: auto; }
.asm svg.graph .edge { fill: none; stroke: var(--quiet); stroke-opacity: .6; } .asm svg.graph .edge.model, .asm svg.graph .edge.back { stroke-dasharray: 4 3; }
.asm svg.graph .edge.hot { stroke: var(--warn); stroke-opacity: 1; stroke-width: 2; }
.asm svg.graph .arrowhead { fill: var(--quiet); } .asm svg.graph .arrowhead.hot { fill: var(--warn); }
.asm svg.graph .gnode { cursor: pointer; outline: none; } .asm svg.graph .hit { fill: transparent; }
.asm svg.graph .gnode:hover .g-name, .asm svg.graph .gnode:focus .g-name { fill: var(--accent); }
.asm svg.graph .ring { fill: none; stroke-width: 5; } .asm svg.graph .gnode.end .ring { stroke-width: 4; }
.asm svg.graph .stale-ring { fill: none; stroke: var(--warn); stroke-width: 2; }
.asm svg.graph .g-count { font: 600 11px system-ui, sans-serif; fill: var(--ink); text-anchor: middle; }
.asm svg.graph .g-name { font: 600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--ink); text-anchor: middle; } .asm svg.graph .g-name.start { text-anchor: start; }
.asm svg.graph .g-stale { font: 600 10.5px system-ui, sans-serif; fill: var(--ink); text-anchor: middle; }
.asm svg.graph .p-id { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--ink); }
.asm svg.graph .p-val { font-size: 11px; fill: var(--quiet); text-anchor: end; font-variant-numeric: tabular-nums; } .asm svg.graph .p-val.fail { fill: var(--fail); font-weight: 600; }
.asm svg.graph.lit .edge:not(.on) { opacity: .12; } .asm svg.graph.lit [data-node]:not(.on) { opacity: .35; }
.asm svg.graph.lit .edge.on { stroke-opacity: 1; stroke: var(--accent); } .asm svg.graph.lit .edge.hot.on { stroke: var(--warn); }
.asm .b-claims { --c: light-dark(#2a6fdb, #6ea0ff); } .asm .b-estimate { --c: light-dark(#7b52c9, #b08cff); }
.asm .b-choice { --c: light-dark(#1f8f7a, #4cc9b0); } .asm .b-model { --c: light-dark(#4f6478, #a3b6c9); }
.asm .b-formula, .asm .b-check, .asm .b-unknown { --c: var(--quiet); }
.asm svg.graph .ring { stroke: var(--c); }
.asm .legend .key { white-space: nowrap; margin-right: 10px; } .asm .legend .key::before { content: ""; display: inline-block; width: 14px; height: 4px; margin: 0 4px 2px 0; background: var(--c); vertical-align: middle; }
.asm .structure-crumbs { margin: 4px 0 6px; } .asm .unread { margin-top: 8px; }
.asm ul.io { padding-left: 0; list-style: none; margin: 4px 0; } .asm ul.io li { padding: 1px 0; }
.asm a.doc { color: var(--accent); }
`
