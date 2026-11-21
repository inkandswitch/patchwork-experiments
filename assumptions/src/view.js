/**
 * The register's view: every entry, grouped by the first segment of its id,
 * with its value, kind, status and source; results with what they were
 * computed from and whether they are stale; a variant picker; and "Find
 * uses", which walks the register's folder for every place an id appears and
 * every constant model code wrote down itself.
 *
 * A person edits here: click a row to change its value, unit, source, quote
 * or note. With a variant selected, an edit becomes that variant's override
 * and "Use base" removes it. Status follows what the entry carries
 * (model.js statusFor): an edit keeps 'verified' only when the value, source
 * and quote are all as they were, since the quote vouched for the old value.
 * Results are produced by models, so here only their note is editable.
 *
 * Options, for tests: `repo` (default window.repo), used only by Find uses.
 */

import {
  KINDS,
  formatValue,
  groupOf,
  idProblem,
  parseValue,
  plainValue,
  resolveAll,
  resolveEntry,
  sameValue,
  staleness,
  statusFor,
  variantNames,
} from "./model.js"
import { whereUsed } from "./where.js"

const STYLE_ID = "assumptions-view-style"
const CSS = `
.asm { --asm-fg: var(--color-text, #1d1d1f); --asm-muted: var(--color-text-muted, #6b6b70); --asm-line: var(--color-border, #e3e3e6);
  --asm-bg: var(--color-background, #fff); --asm-soft: var(--color-background-subtle, #f6f6f7);
  font: 13px/1.4 system-ui, sans-serif; color: var(--asm-fg); background: var(--asm-bg); height: 100%; overflow: auto; box-sizing: border-box; padding: 12px 16px 40px; }
.asm h1 { font-size: 16px; margin: 0 0 4px; }
.asm .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0 12px; }
.asm .bar .counts { color: var(--asm-muted); margin-right: auto; }
.asm input, .asm select, .asm textarea, .asm button { font: inherit; color: inherit; }
.asm input, .asm select, .asm textarea { border: 1px solid var(--asm-line); border-radius: 4px; padding: 3px 6px; background: var(--asm-bg); }
.asm button { border: 1px solid var(--asm-line); border-radius: 4px; padding: 3px 10px; background: var(--asm-soft); cursor: pointer; }
.asm table { border-collapse: collapse; width: 100%; }
.asm th { text-align: left; font-weight: 600; color: var(--asm-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding: 4px 6px; border-bottom: 1px solid var(--asm-line); }
.asm td { padding: 4px 6px; border-bottom: 1px solid var(--asm-line); vertical-align: top; }
.asm tr.entry { cursor: pointer; }
.asm tr.entry:hover td { background: var(--asm-soft); }
.asm tr.group td { font-weight: 600; padding-top: 14px; border-bottom: none; }
.asm code { font: 12px ui-monospace, Menlo, monospace; }
.asm .value { font-variant-numeric: tabular-nums; white-space: nowrap; }
.asm .over { box-shadow: inset 3px 0 0 #b07d10; }
.asm .badge { display: inline-block; border-radius: 9px; padding: 0 7px; font-size: 11px; white-space: nowrap; }
.asm .s-verified { background: #dff3e4; color: #1d6b34; } .asm .s-cited { background: #e3ecfb; color: #234f9c; }
.asm .s-estimated { background: #fbecd6; color: #8a5300; } .asm .s-chosen { background: #ece6f8; color: #5a3a9a; }
.asm .s-derived { background: #e8e8ea; color: #444; } .asm .stale { background: #fbe0de; color: #9c2a1f; }
.asm .muted { color: var(--asm-muted); }
.asm .src { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asm .edit td { background: var(--asm-soft); }
.asm .edit .grid { display: grid; grid-template-columns: max-content 1fr; gap: 6px 10px; align-items: center; max-width: 720px; }
.asm .edit .grid textarea { min-height: 40px; }
.asm .edit .actions { display: flex; gap: 8px; margin-top: 8px; }
.asm .problem { color: #9c2a1f; }
.asm .uses { margin: 4px 0 0; padding-left: 16px; color: var(--asm-muted); }
.asm .report { margin-top: 16px; border-top: 1px solid var(--asm-line); padding-top: 8px; }
.asm .report h2 { font-size: 13px; margin: 8px 0 4px; }
@media (prefers-color-scheme: dark) {
  .asm .s-verified { background: #1f3a27; color: #9fdcae; } .asm .s-cited { background: #1f2c45; color: #a9c3f2; }
  .asm .s-estimated { background: #43321a; color: #f0c98a; } .asm .s-chosen { background: #33284a; color: #c9b5f0; }
  .asm .s-derived { background: #333; color: #ccc; } .asm .stale { background: #4a221f; color: #f2a9a1; }
}
`

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.append(style)
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === "class") node.className = value
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value)
    else if (key in node && typeof value !== "string") node[key] = value
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child)
  return node
}

function valueText(value) {
  if (value == null) return ""
  if (typeof value === "object") return `${value.min}..${value.max}${value.nominal != null ? ` (${value.nominal})` : ""}`
  return String(value)
}

export function AssumptionsView(handle, element, { repo = globalThis.window?.repo ?? null } = {}) {
  ensureStyles()
  const state = { variant: null, open: null, adding: false, filter: "", report: null, scanning: false, problem: null }
  const root = el("div", { class: "asm" })
  element.append(root)

  const write = (fn) => handle.change(fn)

  function target(d) {
    if (!state.variant) return d.entries
    if (!d.variants[state.variant]) d.variants[state.variant] = { note: "", entries: {} }
    return d.variants[state.variant].entries
  }

  async function findUses() {
    const doc = handle.doc()
    if (!repo || !doc.scope) return
    state.scanning = true
    render()
    try {
      state.report = await whereUsed(repo, { register: doc, registerUrl: handle.url, folderUrl: doc.scope, variant: state.variant })
    } catch (err) {
      state.problem = `Find uses failed: ${err?.message ?? err}`
    }
    state.scanning = false
    render()
  }

  function editor(entry, colspan) {
    const isResult = entry?.kind === "result"
    const fields = {
      id: el("input", { value: entry?.id ?? "", disabled: Boolean(entry), placeholder: "group_name_unit" }),
      value: el("input", { value: valueText(entry?.value), disabled: isResult, placeholder: "3.2  or  0.4..1.4 (0.9)  or text" }),
      unit: el("input", { value: entry?.unit ?? "", disabled: isResult }),
      label: el("input", { value: entry?.label ?? "" }),
      kind: el("select", { disabled: isResult }, ...KINDS.filter((k) => k !== "result" || isResult).map((k) => el("option", { value: k, selected: (entry?.kind ?? "fact") === k }, k))),
      source: el("input", { value: entry?.source ?? "", disabled: isResult, placeholder: "automerge:… or https://…" }),
      quote: el("textarea", { disabled: isResult }, entry?.quote ?? ""),
      note: el("textarea", {}, entry?.note ?? ""),
    }
    const problem = el("div", { class: "problem" })
    const save = () => {
      const id = fields.id.value.trim()
      const issue = entry ? null : idProblem(id) ?? (handle.doc().entries?.[id] ? `'${id}' already exists.` : null)
      if (issue) return void (problem.textContent = issue)
      const parsed = isResult ? { value: entry.value } : parseValue(fields.value.value)
      if (parsed.problem) return void (problem.textContent = parsed.problem)
      const kind = isResult ? "result" : fields.kind.value
      const source = fields.source.value.trim() || null
      const quote = fields.quote.value.trim() || null
      const keepsVerified = entry?.status === "verified" && sameValue(entry.value, parsed.value) && entry.source === source && entry.quote === quote
      write((d) => {
        const into = target(d)
        const base = d.entries[id]
        const next = {
          label: fields.label.value.trim() || null,
          unit: isResult ? entry.unit ?? null : fields.unit.value.trim() || null,
          value: plainValue(parsed.value),
          kind,
          status: statusFor({ kind, source, quote }, { quoteFound: keepsVerified }),
          source: isResult ? null : source,
          quote: isResult ? null : quote,
          note: fields.note.value.trim() || null,
          inputs: isResult ? { ...(entry.inputs ?? {}) } : null,
          by: isResult && entry.by ? { name: entry.by.name ?? null, url: entry.by.url ?? null } : null,
          at: new Date().toISOString(),
        }
        if (!state.variant && base) Object.assign(base, next)
        else into[id] = next
      })
      state.open = null
      state.adding = false
      render()
    }
    const actions = el("div", { class: "actions" }, el("button", { onclick: save }, "Save"), el("button", { onclick: () => ((state.open = null), (state.adding = false), render()) }, "Cancel"))
    if (entry && state.variant && entry.overridden) {
      actions.append(el("button", { onclick: () => (write((d) => delete d.variants[state.variant].entries[entry.id]), (state.open = null), render()) }, "Use base"))
    }
    if (entry && !state.variant) {
      actions.append(el("button", { onclick: () => (confirm(`Delete ${entry.id}?`) && write((d) => delete d.entries[entry.id]), (state.open = null), render()) }, "Delete"))
    }
    const row = (label, input) => [el("label", {}, label), input]
    const grid = el(
      "div",
      { class: "grid" },
      row("id", fields.id),
      row("value", fields.value),
      row("unit", fields.unit),
      row("label", fields.label),
      row("kind", fields.kind),
      row("source", fields.source),
      row("quote", fields.quote),
      row("note", fields.note)
    )
    if (isResult) {
      grid.append(el("label", {}, "from"), el("div", { class: "muted" }, Object.entries(entry.inputs ?? {}).map(([k, v]) => `${k} = ${formatValue(v)}`).join(", ") || "—"))
      if (entry.by?.name) grid.append(el("label", {}, "by"), el("div", { class: "muted" }, entry.by.name, entry.by.url ? ` (${entry.by.url})` : ""))
    }
    return el("tr", { class: "edit" }, el("td", { colspan }, grid, problem, actions))
  }

  function render() {
    const doc = handle.doc()
    if (!doc) return
    if (state.variant && !doc.variants?.[state.variant]) state.variant = null
    const entries = resolveAll(doc, state.variant)
    const stale = staleness(doc, state.variant)
    const counts = {}
    for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1
    const filter = state.filter.toLowerCase()
    const shown = filter ? entries.filter((e) => `${e.id} ${e.label ?? ""} ${e.note ?? ""}`.toLowerCase().includes(filter)) : entries

    const variantSelect = el(
      "select",
      { onchange: (ev) => ((state.variant = ev.target.value || null), (state.report = null), render()) },
      el("option", { value: "", selected: !state.variant }, "Base"),
      ...variantNames(doc).map((v) => el("option", { value: v, selected: state.variant === v }, v))
    )
    const newVariant = el("button", {
      onclick: () => {
        const name = prompt("Variant name (e.g. 'cold day')")?.trim()
        if (!name) return
        const note = prompt("What does it represent?")?.trim() ?? ""
        write((d) => {
          if (!d.variants) d.variants = {}
          if (!d.variants[name]) d.variants[name] = { note, entries: {} }
        })
        state.variant = name
        render()
      },
    }, "New variant")
    const search = el("input", { value: state.filter, placeholder: "Filter", oninput: (ev) => ((state.filter = ev.target.value), renderTable()) })

    const header = [
      el("h1", {}, doc.title || "Assumptions"),
      el("div", { class: "muted" }, doc.scope ? `Serves ${doc.scope}` : "No scope folder"),
      state.variant && doc.variants[state.variant]?.note ? el("div", { class: "muted" }, `Variant: ${doc.variants[state.variant].note}`) : null,
      el(
        "div",
        { class: "bar" },
        el("span", { class: "counts" }, `${entries.length} entries · ${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(" · ")}${stale.size ? ` · ${stale.size} stale` : ""}`),
        search,
        variantSelect,
        newVariant,
        el("button", { onclick: () => ((state.adding = true), (state.open = null), render()) }, "Add entry"),
        el("button", { onclick: findUses, disabled: !repo || !doc.scope || state.scanning }, state.scanning ? "Searching…" : "Find uses")
      ),
      state.problem ? el("div", { class: "problem" }, state.problem) : null,
    ]

    const table = el("table")
    const renderTable = () => {
      const q = state.filter.toLowerCase()
      const rows = q ? entries.filter((e) => `${e.id} ${e.label ?? ""} ${e.note ?? ""}`.toLowerCase().includes(q)) : shown
      table.replaceChildren(
        el("thead", {}, el("tr", {}, ...["id", "", "value", "kind", "status", "source", state.report ? "uses" : null].filter((h) => h != null).map((h) => el("th", {}, h))))
      )
      const body = el("tbody")
      const cols = state.report ? 7 : 6
      if (state.adding) body.append(editor(null, cols))
      let group = null
      for (const entry of rows) {
        if (groupOf(entry.id) !== group) {
          group = groupOf(entry.id)
          body.append(el("tr", { class: "group" }, el("td", { colspan: cols }, group)))
        }
        const uses = state.report?.uses.get(entry.id) ?? []
        const reasons = stale.get(entry.id)
        body.append(
          el(
            "tr",
            { class: `entry${entry.overridden ? " over" : ""}`, onclick: () => ((state.open = state.open === entry.id ? null : entry.id), (state.adding = false), render()) },
            el("td", {}, el("code", {}, entry.id)),
            el("td", { class: "muted" }, entry.label ?? ""),
            el("td", { class: "value" }, formatValue(entry.value, entry.unit)),
            el("td", { class: "muted" }, entry.kind),
            el(
              "td",
              {},
              el("span", { class: `badge s-${entry.status}` }, entry.status),
              reasons ? el("span", { class: "badge stale", title: reasons.map((r) => `${r.input} ${r.reason}`).join(", ") }, " stale") : null
            ),
            el("td", { class: "src muted", title: entry.quote ? `“${entry.quote}”` : entry.source ?? "" }, entry.kind === "result" ? `from ${Object.keys(entry.inputs ?? {}).join(", ")}` : entry.source ?? entry.note ?? ""),
            state.report ? el("td", { class: uses.length ? "" : "muted" }, String(uses.length)) : null
          )
        )
        if (state.open === entry.id) {
          body.append(editor(resolveEntry(doc, entry.id, state.variant), cols))
          if (uses.length) {
            body.append(el("tr", {}, el("td", { colspan: cols }, el("ul", { class: "uses" }, ...uses.map((u) => el("li", {}, `${u.doc}${u.part ? ` ${u.part}` : ""}:${u.line}  `, el("code", {}, u.text)))))))
          }
        }
      }
      table.append(body)
    }
    renderTable()

    const report = state.report
      ? el(
          "div",
          { class: "report" },
          el("div", { class: "muted" }, `${report.scanned} documents searched${report.truncated ? " (stopped early)" : ""}.`),
          report.unbound.length
            ? [
                el("h2", {}, `Constants in model code, not from the register (${report.unbound.length})`),
                el("ul", { class: "uses" }, ...report.unbound.map((u) => el("li", {}, `${u.doc}${u.part ? ` ${u.part}` : ""}:${u.line}  `, el("code", {}, u.text)))),
              ]
            : null,
          report.drift.length
            ? [
                el("h2", {}, "Copies that disagree with the register"),
                el("ul", { class: "uses" }, ...report.drift.map((d) => el("li", {}, `${d.doc}${d.part ? ` ${d.part}` : ""}:${d.line}  ${d.name} = ${d.written}, register ${d.register}`))),
              ]
            : null,
          report.unused.length ? [el("h2", {}, "Not used anywhere"), el("div", { class: "muted" }, report.unused.join(", "))] : null,
          report.exports.length ? [el("h2", {}, "Exports"), el("div", { class: "muted" }, report.exports.map((e) => e.doc).join(", "))] : null
        )
      : null

    root.replaceChildren(...header.filter(Boolean), table, ...(report ? [report] : []))
  }

  // A change from elsewhere while a person is typing in the editor would
  // rebuild it under their cursor; it waits for Save or Cancel, which render.
  const onChange = () => {
    if (state.open || state.adding) return
    render()
  }
  handle.on("change", onChange)
  render()
  return () => {
    handle.off("change", onChange)
    root.remove()
  }
}
