/**
 * The register's view: three lenses over one register, and an entry panel.
 *
 *   Needs attention   people's judgements to answer, problems in queue
 *                     order, and the weak leaves that matter most
 *   Entries           every entry, grouped by the first segment of its id,
 *                     rows in calculation order; groups with problems open
 *   Requirements      every check on one scale, the share of its limit it
 *                     uses, worst first
 *
 * The panel answers the five questions about the entry it shows: its value,
 * its basis (claims with quotes in context, or the calculation), what it
 * rests on and feeds, where it is used, and what people have said. Ids are
 * links; following one pushes the panel, and the breadcrumb is the line of
 * inquiry. People add claims and judgements here; nobody approves anything.
 *
 * Rows are built from the same parts as the agent's text (text.js), so a
 * row's cells read exactly as its figure line. Colour appears only where
 * something needs a person; evidence is a glyph's fill, and every glyph is
 * also a word. Rendering morphs the live DOM (morph.js), so a re-render
 * keeps scroll, open sections, focus and typed text; events are delegated.
 */

import { render as renderFormula } from "./formula.js"
import { morph } from "./morph.js"
import { checkClaim } from "./quote.js"
import { evaluate, groupOf, intendedUse, materialize, peoplesMarks } from "./register.js"
import { RANK, SET_ASIDE, SOURCE_KINDS } from "./support.js"
import { allProblems, confidenceText, entryParts, groupLine, restsOnText, sheetOrder, summaryLine } from "./text.js"
import { observedUse, scanProblems } from "./uses.js"
import { formatBounds, formatValue, isNumeric, parseValue } from "./values.js"
import { sourceText, useCounts, usesOf } from "./where.js"

const LENSES = [
  ["attention", "Needs attention"],
  ["entries", "Entries"],
  ["requirements", "Requirements"],
]
const NAME_KEY = "assumptions:name"
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
  const state = { lens: "attention", stack: [], at: -1, q: "", support: "", kind: "", open: new Set(), closed: new Set(), form: null, error: null, preview: null, history: null, cursor: null }
  const style = h("style")
  style.textContent = CSS
  const root = h("div", { class: "asm", tabindex: "-1" })
  element.append(style, root)
  let doc, evaluation, problems, counts

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
    const out = h("div")
    out.append(header(), h("div", { class: "body", "data-key": "body" }, lensView(), panel()))
    morph(root, out)
  }

  function header() {
    return h(
      "header",
      { "data-key": "header" },
      h("h1", {}, doc.title || "Assumptions"),
      h("p", { class: "summary" }, summaryLine(doc, evaluation, problems, { title: false })),
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
            item(id, `j:${id}:${j.key}`, h("span", { class: "chip warn" }, "JUDGEMENT"), " ", idLink(id), ` · ${j.by?.who ?? "a person"}${j.on ? ` on ${j.on}` : ""}: `, h("q", {}, j.says ?? j.verdict), j.path ? h("span", { class: "quiet" }, ` · ${j.path}`) : null),
          ),
        ),
      )
    }
    out.push(h("h2", {}, problems.length ? `Problems (${problems.length})` : "Problems"))
    if (!problems.length) out.push(h("p", { class: "quiet" }, "Nothing needs attention."))
    else out.push(h("ul", { class: "queue" }, problems.map((p, i) => item(p.id, `p:${i}:${p.kind}:${p.id}`, chip(p.kind), " ", linkify(p.text), p.fix ? h("div", { class: "fix" }, `fix: ${p.fix}`) : null))))
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
        return h("td", { class: p.part }, p.text)
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
        entry.note ? h("p", { class: "quiet" }, entry.note) : null,
      ]),
      section("Basis", basis(id, entry, ev)),
      section("Rests on and feeds", restsOn(id, ev)),
      section("Used in", usedIn(id)),
      section("Judgements and history", judgementsAndHistory(id, entry, ev)),
      h(
        "div",
        { class: "controls" },
        h("button", { type: "button", "data-form": "claim" }, "Add a claim"),
        h("button", { type: "button", "data-form": "judgement" }, "Add a judgement"),
        ["estimate", "choice", "formula", "check", "unknown"].includes(entry.basis) ? h("button", { type: "button", "data-form": "edit" }, "Edit") : null,
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
              h("div", { class: "quiet" }, `read as: ${c.reading ?? "?"}${c.factor && c.factor !== 1 ? ` · × ${c.factor} into ${entry.unit ?? "the entry's unit"}` : ""} · ${c.verified ? "found in the kept source" : "quote not verified"}${c.section ? ` · near "${c.section}"` : ""}${c.conditions ? ` · ${c.conditions}` : ""}`),
              c.source ? h("button", { type: "button", class: "link", "data-doc": c.source }, /^automerge:/.test(c.source) ? "Open source" : c.source) : null,
            )
          }),
          entry.pick ? h("p", {}, `pick: ${entry.pick.rule}${entry.pick.claim ? ` ${entry.pick.claim}` : ""}${entry.pick.reason ? ` — ${entry.pick.reason}` : ""}`) : null,
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
          h("ul", { class: "inputs" }, p.formula.ids.map((input) => h("li", {}, glyph(levelOf(evaluation.byId.get(input))), " ", idLink(input), ` = ${show(input)}`))),
        ]
      }
      case "model":
        return [
          h("p", {}, `${entry.model?.name ?? "A model"}, tolerance ${entry.model?.tolerance ?? 0}`, entry.model?.url ? [" · ", h("button", { type: "button", class: "link", "data-doc": entry.model.url }, "open the run")] : null),
          h("ul", {}, Object.entries(entry.model?.inputs ?? {}).map(([input, v]) => h("li", {}, idLink(input), ` ran with ${formatValue(v, doc.entries[input]?.unit)}, now ${formatValue(evaluation.byId.get(input)?.value, doc.entries[input]?.unit)}`))),
          ev.stale ? h("p", {}, chip("STALE"), ` ${ev.stale.map((s) => `${s.input} ${s.reason}`).join(", ")}`) : null,
        ]
      case "estimate":
        return h("p", {}, `estimate: ${formatValue(entry.estimate?.value, entry.unit)} — ${entry.estimate?.reasoning ?? "no reasoning given"}`)
      case "unknown":
        return h("p", {}, `unknown${entry.unknown?.range ? `, somewhere in ${formatValue(entry.unknown.range, entry.unit)}` : ""}${entry.unknown?.settle ? `; settle by ${entry.unknown.settle}` : ""}`)
      case "choice":
        return [
          h("p", {}, `chosen: ${formatValue(entry.choice?.value, entry.unit)}${entry.choice?.rationale ? ` — ${entry.choice.rationale}` : ""}`),
          (entry.choice?.alternatives ?? []).length ? h("ul", {}, entry.choice.alternatives.map((a) => h("li", {}, `over ${formatValue(a.value, entry.unit)}${a.note ? ` — ${a.note}` : ""}`))) : null,
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

  function restsOn(id, ev) {
    const leaves = [...(ev.leaves ?? [])].filter((l) => l !== id).sort((a, b) => RANK[levelOf(evaluation.byId.get(a)) ?? "weak"] - RANK[levelOf(evaluation.byId.get(b)) ?? "weak"] || (a < b ? -1 : 1))
    const feeds = [...(evaluation.readers.get(id) ?? [])].filter((r) => r !== id).sort()
    return [
      leaves.length ? h("p", {}, `${restsOnText(ev.confidence?.restsOn ?? countLevels(leaves))}: `, leaves.map((l, i) => [i ? ", " : "", glyph(levelOf(evaluation.byId.get(l))), idLink(l)])) : h("p", { class: "quiet" }, "a leaf: it rests on its own evidence"),
      h("p", {}, "feeds: ", feeds.length ? feeds.map((f, i) => [i ? ", " : "", idLink(f)]) : h("span", { class: "quiet" }, "nothing in the register")),
    ]
  }

  function usedIn(id) {
    if (!doc.scan) return h("p", { class: "quiet" }, "not yet scanned: assumptions_check scans the task folder")
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
        j.says ? [" — ", h("q", {}, j.says)] : null,
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
      let text = null
      if (source && /^automerge:/.test(source) && repo) {
        try {
          text = sourceText((await repo.find(source)).doc())
        } catch {}
      }
      const raw = { source, quote: String(data.get("quote") ?? "").trim() || null, stated: String(data.get("stated") ?? "").trim(), sourceKind: String(data.get("sourceKind")) }
      const checked = checkClaim(raw, { sourceText: text, unit: entry.unit ?? "" })
      if (checked.problem) return fail(checked.problem)
      const factor = Number(data.get("factor") || 1)
      if (!Number.isFinite(factor) || factor === 0) return fail("The factor is a non-zero number.")
      handle.change(
        (d) => {
          const e = d.entries[id]
          const claim = plain({ key: nextKey(e.claims, "c"), source, quote: raw.quote, stated: checked.claim.stated, factor, subject: String(data.get("subject") ?? "") || null, sourceKind: raw.sourceKind, origin: null, verified: checked.claim.verified, reading: checked.claim.reading, section: checked.claim.section, context: checked.claim.context, by, at })
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
    const target = event.target.closest?.("[data-open], [data-lens], [data-group], [data-crumb], [data-close], [data-form], [data-cancel], [data-doc], [data-history], [data-preview], tr[data-id], li[data-id]")
    if (!target || !root.contains(target)) return
    const d = target.dataset
    if (d.open) {
      event.preventDefault()
      openEntry(d.open)
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
    } else if (d.form) openForm(d.form)
    else if (d.cancel) {
      state.form = null
      state.error = null
      state.preview = null
      render()
    } else if (d.doc) root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: d.doc }, bubbles: true, composed: true }))
    else if (d.history) {
      state.history = { id: d.history, items: historyOf(d.history) }
      render()
    } else if (d.preview) preview(new FormData(target.closest("form")))
    else if (d.id) openEntry(d.id)
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
      Enter: () => state.cursor && openEntry(state.cursor),
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

  repair()
  render()
  handle.on("change", render)
  root.addEventListener("click", onClick)
  root.addEventListener("input", onInput)
  root.addEventListener("change", onInput)
  root.addEventListener("submit", onSubmit)
  root.addEventListener("keydown", onKey)
  return () => {
    handle.off("change", render)
    root.removeEventListener("click", onClick)
    root.removeEventListener("input", onInput)
    root.removeEventListener("change", onInput)
    root.removeEventListener("submit", onSubmit)
    root.removeEventListener("keydown", onKey)
    root.remove()
    style.remove()
  }
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
`
