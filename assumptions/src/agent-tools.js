/**
 * The register, handed to the agent: five `agent:tool` executors.
 *
 * Their descriptions and schemas live in ../index.js as plain JSON (the agent
 * reads them before it loads anything); index.test.js keeps the two in step
 * by checking every input this file reads is declared there.
 *
 * What the tools decide rather than trust:
 *
 *   status    computed from what an entry carries (model.js statusFor). A
 *             quote from a kept document is looked up in that document, and
 *             a quote that is not there is refused, not recorded as cited.
 *   inputs    a result names the entries it was produced from; the tool
 *             records their values as they are at that moment. The agent
 *             never writes those values itself, so "stale" means what it says.
 */

import { AssumptionsDatatype } from "./datatype.js"
import {
  ASSUMPTIONS,
  EXPORT_FORMATS,
  KINDS,
  formatValue,
  idProblem,
  parseValue,
  plainValue,
  quoteIn,
  renderExport,
  resolveAll,
  resolveEntry,
  staleness,
  statusFor,
  variantNames,
} from "./model.js"
import { describeUses, partsOf, whereUsed } from "./where.js"

// ---------------------------------------------------------------- helpers

async function openRegister(ctx, url) {
  if (!url) throw new Error("Pass `register`: the automerge: URL of an assumptions document (assumptions_create makes one).")
  const handle = await ctx.repo.find(String(url).trim())
  const doc = handle.doc()
  if (doc?.["@patchwork"]?.type !== ASSUMPTIONS) throw new Error(`${url} is not an assumptions register.`)
  return handle
}

async function newDoc(ctx) {
  return typeof ctx.repo.create2 === "function" ? await ctx.repo.create2() : ctx.repo.create()
}

async function fileInFolder(ctx, folderUrl, { name, type, url }) {
  const folder = await ctx.repo.find(String(folderUrl).trim())
  if (!Array.isArray(folder.doc()?.docs)) throw new Error(`${folderUrl} is not a folder; the document was made but not filed (${url}).`)
  folder.change((d) => {
    d.docs.push({ name, type, url })
  })
}

/** Everything readable in a kept source: the parts any model reads, plus a capture's extracted text. */
function sourceText(doc) {
  const parts = partsOf({ ...doc, capture: null }).map((p) => p.text)
  for (const key of ["text", "content"]) if (typeof doc?.[key] === "string") parts.push(doc[key])
  return parts.join("\n")
}

function variantCheck(doc, variant) {
  if (variant && !doc.variants?.[variant]) return `No variant '${variant}'. Variants: ${variantNames(doc).join(", ") || "(none)"}.`
  return null
}

function line(entry, stale) {
  const bits = [`${entry.id} = ${formatValue(entry.value, entry.unit)}`]
  bits.push(`${entry.kind}/${entry.status}${entry.overridden ? " (variant)" : ""}`)
  if (entry.label) bits.push(entry.label)
  let text = bits.join(" · ")
  if (entry.source) text += `\n    source: ${entry.source}${entry.quote ? ` "${entry.quote}"` : ""}`
  if (entry.kind === "result") {
    const inputs = Object.keys(entry.inputs ?? {})
    text += `\n    from: ${inputs.join(", ") || "(no inputs recorded)"}${entry.by?.name ? ` by ${entry.by.name}${entry.by.url ? ` (${entry.by.url})` : ""}` : ""}`
  }
  if (stale) text += `\n    STALE: ${stale.map((s) => (s.reason === "changed" ? `${s.input} changed` : `${s.input} ${s.reason}`)).join(", ")}`
  if (entry.note) text += `\n    note: ${entry.note}`
  return text
}

// ---------------------------------------------------------------- create

export const create = {
  async execute(input, ctx) {
    if (!input.folder) throw new Error("Pass `folder`: the task folder this register serves. Where-used and the constant checks look there.")
    const title = String(input.title ?? "").trim() || "Assumptions"
    const handle = await newDoc(ctx)
    handle.change((d) => {
      AssumptionsDatatype.init(d)
      d.title = title
      d.scope = String(input.folder).trim()
    })
    await fileInFolder(ctx, input.folder, { name: title, type: ASSUMPTIONS, url: handle.url })
    return {
      text: `Created the assumptions register '${title}': ${handle.url}, filed in ${input.folder}. Add entries with assumptions_set; export it for models with assumptions_export.`,
      doc: { url: handle.url, name: title, kind: ASSUMPTIONS },
    }
  },
  summarize(input) {
    return `register · ${input?.title ?? "Assumptions"}`
  },
}

// ---------------------------------------------------------------- read

export const read = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const variant = input.variant || null
    const problem = variantCheck(doc, variant)
    if (problem) return problem
    const stale = staleness(doc, variant)
    let entries = resolveAll(doc, variant)
    if (Array.isArray(input.ids) && input.ids.length) {
      const wanted = new Set(input.ids)
      const missing = input.ids.filter((id) => !entries.some((e) => e.id === id))
      entries = entries.filter((e) => wanted.has(e.id))
      if (missing.length && !entries.length) return `No entries ${missing.join(", ")} in '${doc.title}'.`
    }
    if (input.prefix) entries = entries.filter((e) => e.id.startsWith(input.prefix))

    const counts = {}
    for (const e of resolveAll(doc, variant)) counts[e.status] = (counts[e.status] ?? 0) + 1
    const head = [
      `${doc.title} (${handle.url})${variant ? `, variant "${variant}"` : ""} · scope ${doc.scope ?? "(none)"}`,
      `${Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ") || "empty"}${stale.size ? ` · ${stale.size} stale result${stale.size === 1 ? "" : "s"}` : ""}`,
      `Variants: ${variantNames(doc).map((v) => `${v}${doc.variants[v]?.note ? ` (${doc.variants[v].note})` : ""}`).join(", ") || "(none)"}`,
      "",
    ]
    return head.concat(entries.map((e) => line(e, stale.get(e.id)))).join("\n")
  },
  summarize(input, output) {
    const n = String(output ?? "").split("\n").filter((l) => / = /.test(l) && !l.startsWith(" ")).length
    return `read register · ${n} entries`
  },
}

// ---------------------------------------------------------------- set

export const set = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const variant = input.variant ? String(input.variant).trim() : null
    const list = Array.isArray(input.entries) ? input.entries : []
    const remove = Array.isArray(input.remove) ? input.remove : []
    if (!list.length && !remove.length) return "Nothing to do: pass `entries` (and/or `remove`)."

    const problems = []
    const writes = []
    for (const raw of list) {
      const id = String(raw?.id ?? "").trim()
      const idIssue = idProblem(id)
      if (idIssue) {
        problems.push(idIssue)
        continue
      }
      const existing = resolveEntry(doc, id, variant)
      const parsed = raw.value === undefined && existing ? { value: existing.value } : parseValue(raw.value)
      if (parsed.problem) {
        problems.push(`${id}: ${parsed.problem}`)
        continue
      }
      const inputs = Array.isArray(raw.inputs) ? raw.inputs.map(String) : null
      const kind = raw.kind ?? (inputs ? "result" : existing?.kind ?? "fact")
      if (!KINDS.includes(kind)) {
        problems.push(`${id}: kind is one of ${KINDS.join(", ")}.`)
        continue
      }
      if (kind === "result" && !inputs?.length) {
        problems.push(`${id}: a result names the entries it was computed from in \`inputs\`, so the register can tell when it goes stale.`)
        continue
      }
      // Snapshot the inputs as they are now, in this variant — never as the caller says they were.
      let snapshot = null
      if (inputs) {
        snapshot = {}
        const absent = []
        for (const inputId of inputs) {
          const now = resolveEntry(doc, inputId, variant) ?? writes.find((w) => w.id === inputId)?.entry
          if (!now) absent.push(inputId)
          else snapshot[inputId] = plainValue(now.value)
        }
        if (absent.length) {
          problems.push(`${id}: inputs not in the register: ${absent.join(", ")}. Add them first — every number a model uses belongs here.`)
          continue
        }
      }
      const pick = (key) => (raw[key] !== undefined ? (raw[key] === "" ? null : raw[key]) : existing?.[key] ?? null)
      const source = pick("source")
      const quote = pick("quote")
      let quoteFound = false
      if (source && quote && kind !== "result" && /^automerge:/.test(String(source))) {
        try {
          const kept = (await ctx.repo.find(String(source))).doc()
          quoteFound = quoteIn(sourceText(kept), quote)
        } catch {
          quoteFound = false
        }
        if (!quoteFound) {
          problems.push(`${id}: the quote is not in ${source}. Quote it verbatim (a dozen words, as the source has them), or leave the quote out and the entry is 'cited'.`)
          continue
        }
      }
      const entry = {
        label: pick("label"),
        unit: pick("unit"),
        value: plainValue(parsed.value),
        kind,
        status: statusFor({ kind, source, quote }, { quoteFound }),
        source: kind === "result" ? null : source,
        quote: kind === "result" ? null : quote,
        note: pick("note"),
        inputs: snapshot,
        by: kind === "result" ? (raw.by ? { name: raw.by.name ?? null, url: raw.by.url ?? null } : existing?.by ?? null) : null,
        at: new Date().toISOString(),
      }
      writes.push({ id, entry })
    }

    if (problems.length && !writes.length && !remove.length) return `Nothing written.\n${problems.join("\n")}`

    handle.change((d) => {
      if (!d.entries) d.entries = {}
      if (!d.variants) d.variants = {}
      let target = d.entries
      if (variant) {
        if (!d.variants[variant]) d.variants[variant] = { note: input.variantNote ?? "", entries: {} }
        else if (input.variantNote) d.variants[variant].note = input.variantNote
        target = d.variants[variant].entries
      }
      for (const { id, entry } of writes) target[id] = entry
      for (const id of remove) delete target[id]
    })

    const after = handle.doc()
    const stale = staleness(after, variant)
    const out = [`Wrote ${writes.length} entr${writes.length === 1 ? "y" : "ies"}${variant ? ` in variant "${variant}"` : ""}${remove.length ? `, removed ${remove.length}` : ""}.`]
    for (const { id, entry } of writes) out.push(`  ${id} = ${formatValue(entry.value, entry.unit)} · ${entry.kind}/${entry.status}`)
    if (problems.length) out.push("", "Not written:", ...problems.map((p) => `  ${p}`))
    if (stale.size) out.push("", `Stale results now: ${[...stale.keys()].join(", ")}. Re-run the models that produce them and set them again.`)
    return out.join("\n")
  },
  summarize(input) {
    const n = (input?.entries ?? []).length
    return `set ${n} entr${n === 1 ? "y" : "ies"}${input?.variant ? ` · ${input.variant}` : ""}`
  },
}

// ---------------------------------------------------------------- where

export const where = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const folderUrl = input.folder || doc.scope
    if (!folderUrl) return "This register has no scope folder; pass `folder`."
    const report = await whereUsed(ctx.repo, { register: doc, registerUrl: handle.url, folderUrl, variant: input.variant || null })
    return describeUses(report, { id: input.id || null })
  },
  summarize(input, output) {
    const unbound = String(output ?? "").match(/not read from the register \((\d+)\)/)
    return `where used${input?.id ? ` · ${input.id}` : ""}${unbound ? ` · ${unbound[1]} unbound constants` : ""}`
  },
}

// ---------------------------------------------------------------- export

export const exportTool = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const format = input.format ?? "json"
    const spec = EXPORT_FORMATS[format]
    if (!spec) return `format is one of ${Object.keys(EXPORT_FORMATS).join(", ")}.`
    const variant = input.variant || null
    const problem = variantCheck(doc, variant)
    if (problem) return problem
    const content = renderExport(doc, { format, variant, registerUrl: handle.url })
    const name = input.name || `${doc.title || "assumptions"}${variant ? ` (${variant})` : ""}.${spec.extension}`

    // Into an existing export, or the one of that name in the folder, or a new one.
    let target = input.into ? await ctx.repo.find(String(input.into).trim()) : null
    const folderUrl = input.folder || doc.scope
    if (!target && folderUrl) {
      const folder = (await ctx.repo.find(String(folderUrl).trim())).doc()
      const same = (folder?.docs ?? []).find((d) => d.name === name)
      if (same) target = await ctx.repo.find(same.url)
    }
    let made = false
    if (!target) {
      if (!folderUrl) return "Pass `folder` or `into`: there is nowhere to put the export."
      target = await newDoc(ctx)
      made = true
    }
    target.change((d) => {
      if (made) d["@patchwork"] = { type: "file" }
      d.name = name
      d.extension = spec.extension
      d.mimeType = spec.mimeType
      d.content = content
      d.generatedFrom = { register: handle.url, variant, heads: handle.heads?.() ?? null }
    })
    if (made) await fileInFolder(ctx, folderUrl, { name, type: "file", url: target.url })
    const count = resolveAll(doc, variant).length
    return {
      text: `${made ? "Exported" : "Updated"} '${name}' (${target.url}) from ${count} entries${variant ? `, variant "${variant}"` : ""}. Models read their numbers from it by entry id; export again after the register changes.`,
      doc: { url: target.url, name, kind: "file" },
    }
  },
  summarize(input) {
    return `export register · ${input?.format ?? "json"}${input?.variant ? ` · ${input.variant}` : ""}`
  },
}
