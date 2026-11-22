/**
 * The register, handed to the agent: six `agent:tool` executors.
 *
 * Their descriptions and schemas live in ../index.js as plain JSON (the agent
 * reads them before it loads anything); index.test.js keeps the two in step.
 *
 * What the tools decide rather than trust:
 *
 *   claims     a quote from a kept document is looked up there; every number
 *              in the stated value must be in the quote, and the quote's
 *              qualifier (≤, ±, typ) wins over a bare stated number.
 *   values     a claims entry's value comes from its pick; a formula's from
 *              the register's own arithmetic; nobody types them in.
 *   inputs     a model result names its inputs; the tool records their values.
 *   support    computed from the evidence. There is no accept: people add
 *              claims and judgements, and the agent answers judgements.
 *
 * Every write is one Automerge change whose message names the agent session
 * and the why, and the register writes its results back in the same change.
 */

import { AssumptionsDatatype } from "./datatype.js"
import { EXPORT_FORMATS, renderExport } from "./export.js"
import { parse } from "./formula.js"
import { checkClaim } from "./quote.js"
import {
  ASSUMPTIONS,
  BASES,
  KINDS,
  PICK_RULES,
  USES,
  claimValue,
  defaultKind,
  evaluate,
  formulaCycles,
  idProblem,
  materialize,
  nameClashes,
  peoplesMarks,
  pickValue,
} from "./register.js"
import { SOURCE_KINDS } from "./support.js"
import { checkText, detailText, figureLine, entryParts, readText, allProblems } from "./text.js"
import { observedUse, scanProblems } from "./uses.js"
import { constantsIn, driftIn, exportsIn, scanFolder, sourceText, usesOf } from "./where.js"
import { isText, parseValue, plainValue, sameValue } from "./values.js"

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

const headsOf = (handle) => (typeof handle.heads === "function" ? [...(handle.heads() ?? [])] : [])

function pinnedUrl(handle) {
  try {
    const heads = handle.heads?.()
    if (heads && typeof handle.view === "function") return handle.view(heads).url
  } catch {}
  return handle.url
}

const agentBy = (ctx) => ({ kind: "agent", session: ctx?.sessionUrl ?? null })

/** The change message: who (the agent, which session) and why. */
function message(ctx, why) {
  return `agent${ctx?.sessionUrl ? ` ${ctx.sessionUrl}` : ""}: ${why}`
}

const plain = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)))

/** Write `want`'s fields onto an Automerge object, touching only what differs. */
function assignFields(target, want) {
  for (const key of Object.keys(target)) if (!(key in want)) delete target[key]
  for (const [key, value] of Object.entries(want)) {
    if (value === undefined) continue
    if (JSON.stringify(target[key] ?? null) === JSON.stringify(value ?? null)) continue
    target[key] = value === null ? null : plain(value)
  }
}

/** Save a scan, rewriting only the documents whose record changed. */
function writeScan(d, scan) {
  if (!d.scan) {
    d.scan = plain(scan)
    return
  }
  for (const key of ["at", "time", "idsKey", "read", "reused", "truncated", "folder"]) {
    if (JSON.stringify(d.scan[key] ?? null) !== JSON.stringify(scan[key] ?? null)) d.scan[key] = plain(scan[key] ?? null)
  }
  if (!d.scan.docs) d.scan.docs = {}
  for (const url of Object.keys(d.scan.docs)) if (!(url in scan.docs)) delete d.scan.docs[url]
  for (const [url, record] of Object.entries(scan.docs)) {
    if (JSON.stringify(d.scan.docs[url] ?? null) !== JSON.stringify(record)) d.scan.docs[url] = plain(record)
  }
}

/** Re-evaluate and write every entry's results back. Inside a change. */
function settle(d, at) {
  const evaluation = evaluate(d)
  materialize(d, evaluation, { at })
  return evaluation
}

async function readSource(ctx, source, cache) {
  if (!/^automerge:/.test(String(source ?? ""))) return null
  if (cache.has(source)) return cache.get(source)
  let text = null
  try {
    const kept = (await ctx.repo.find(String(source))).doc()
    text = sourceText(kept)
  } catch {
    text = ""
  }
  cache.set(source, text)
  return text
}

// ---------------------------------------------------------------- create

export const create = {
  async execute(input, ctx) {
    if (!input.folder) throw new Error("Pass `folder`: the task folder this register serves. Where-used and the checks look there.")
    const title = String(input.title ?? "").trim() || "Assumptions"
    const handle = await newDoc(ctx)
    handle.change(
      (d) => {
        AssumptionsDatatype.init(d)
        d.title = title
        d.scope = String(input.folder).trim()
      },
      { message: message(ctx, `make the register '${title}'`) },
    )
    await fileInFolder(ctx, input.folder, { name: title, type: ASSUMPTIONS, url: handle.url })
    return {
      text: `Created the assumptions register '${title}': ${handle.url}, filed in ${input.folder}. Add entries with assumptions_set; check it with assumptions_check before you finish.`,
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
    const evaluation = evaluate(doc)
    const extra = scanProblems(doc, evaluation)
    const ids = Array.isArray(input.ids) && input.ids.length ? input.ids.map(String) : null
    return `${readText(doc, evaluation, extra, { ids, prefix: input.prefix || null, detail: Boolean(input.detail), page: Number(input.page ?? 1) || 1 })}\n\n(${handle.url})`
  },
  summarize(input, output) {
    const first = String(output ?? "").split("\n")[0]
    return `read register${input?.prefix ? ` · ${input.prefix}` : ""}${input?.ids?.length ? ` · ${input.ids.length} ids` : ""} · ${first.split(" · ").slice(1, 3).join(" · ")}`
  },
}

// ---------------------------------------------------------------- set

const BASIS_FIELDS = { claims: ["claims", "pick"], estimate: ["estimate"], unknown: ["unknown"], choice: ["choice"], formula: ["formula"], model: ["model"], check: ["check"] }

function nextKey(prefix, used) {
  let n = 1
  while (used.has(`${prefix}${n}`)) n++
  used.add(`${prefix}${n}`)
  return `${prefix}${n}`
}

/** Build one entry from the agent's input and what's there. Returns { entry, overrides } or { problem }. */
async function buildEntry(id, raw, existing, ctx, { at, sources }) {
  const given = BASES.filter((b) => raw[b] !== undefined && raw[b] !== null && raw[b] !== false)
  if (given.length > 1) return { problem: `${id}: give one basis, not ${given.join(" and ")}. A value comes from exactly one place.` }
  let basis = given[0] ?? existing?.basis ?? null
  // Shorthand: a bare `value` is a decision's choice.
  if (!basis && raw.value !== undefined && (raw.kind ?? existing?.kind) === "decision") {
    raw = { ...raw, choice: { value: raw.value, rationale: raw.note ?? null } }
    basis = "choice"
  }
  if (!basis && raw.value !== undefined) return { problem: `${id}: there is no free-standing \`value\`. Give it as a claim's \`stated\` (from the quote), an \`estimate\` with reasoning, or a \`formula\`; a decision's value is a \`choice\`.` }
  if (!basis) return { problem: `${id}: say where its value comes from: \`claims\` (with a quote), \`estimate\` (with reasoning), \`unknown\`, \`choice\`, \`formula\`, \`model\` or \`check\`.` }
  if (raw.value !== undefined && basis !== "choice" && basis !== "model") {
    return { problem: `${id}: there is no free-standing \`value\`. Give it as a claim's \`stated\` (from the quote), an \`estimate\` with reasoning, or a \`formula\`.` }
  }

  const entry = existing ? plain(existing) : {}
  if (existing && existing.basis !== basis) for (const field of BASIS_FIELDS[existing.basis] ?? []) delete entry[field]
  entry.basis = basis
  entry.kind = raw.kind ?? existing?.kind ?? defaultKind(basis)
  if (!KINDS.includes(entry.kind)) return { problem: `${id}: kind is one of ${KINDS.join(", ")}.` }
  for (const field of ["label", "unit", "note"]) if (raw[field] !== undefined) entry[field] = raw[field] === "" ? null : String(raw[field])
  const dropped = []

  switch (basis) {
    case "claims": {
      if (raw.claims === undefined && !(existing?.claims ?? []).length) return { problem: `${id}: give its \`claims\`: what each source says, with \`source\`, \`quote\` and \`stated\`.` }
      if (raw.claims !== undefined) {
        if (!Array.isArray(raw.claims) || !raw.claims.length) return { problem: `${id}: \`claims\` is a list of what sources say, each with \`source\`, \`quote\` and \`stated\`.` }
        const before = new Map((existing?.claims ?? []).map((c) => [c.key, c]))
        const keys = new Set(before.keys())
        const claims = []
        for (const [i, c] of raw.claims.entries()) {
          if (c?.key && before.has(c.key) && c.stated === undefined && c.quote === undefined) {
            claims.push(before.get(c.key))
            continue
          }
          if (c?.stated === undefined) return { problem: `${id}: claim ${i + 1} has no \`stated\`: the figure as the quote gives it, in the source's unit.` }
          if (c.sourceKind && !SOURCE_KINDS.includes(c.sourceKind)) return { problem: `${id}: claim ${i + 1}'s sourceKind is one of ${SOURCE_KINDS.join(", ")}.` }
          const text = await readSource(ctx, c.source, sources)
          const checked = checkClaim(c, { sourceText: text === "" ? null : text, unit: entry.unit ?? "" })
          if (checked.problem) return { problem: `${id}: claim ${i + 1}: ${checked.problem}` }
          const factor = c.factor == null ? 1 : Number(c.factor)
          if (!Number.isFinite(factor) || factor === 0) return { problem: `${id}: claim ${i + 1}'s factor is a non-zero number.` }
          claims.push({
            key: c.key && !before.has(c.key) ? (keys.add(c.key), String(c.key)) : nextKey("c", keys),
            source: c.source ?? null,
            quote: c.quote ?? null,
            stated: checked.claim.stated,
            statedUnit: c.statedUnit ?? null,
            factor,
            subject: c.subject ?? null,
            conditions: c.conditions ?? null,
            sourceKind: c.sourceKind ?? null,
            origin: c.origin ?? null,
            verified: checked.claim.verified,
            reading: checked.claim.reading,
            section: checked.claim.section,
            context: checked.claim.context,
            by: agentBy(ctx),
            at: [...at],
          })
        }
        for (const old of before.values()) if (old.by?.kind === "person" && !claims.some((c) => c.key === old.key)) dropped.push(old.key)
        entry.claims = claims
        if (raw.pick === undefined && entry.pick?.claim && !claims.some((c) => c.key === entry.pick.claim)) entry.pick = null
      }
      if (raw.pick !== undefined) {
        if (raw.pick === null) entry.pick = null
        else {
          const rule = raw.pick.rule ?? (raw.pick.claim !== undefined ? "one" : null)
          if (!PICK_RULES.includes(rule)) return { problem: `${id}: pick.rule is one of ${PICK_RULES.join(", ")}.` }
          let claim = null
          if (rule === "one") {
            const ref = raw.pick.claim
            const found = typeof ref === "number" ? entry.claims?.[ref] : (entry.claims ?? []).find((c) => c.key === ref)
            if (!found) return { problem: `${id}: pick.claim names a claim by its key (${(entry.claims ?? []).map((c) => c.key).join(", ") || "none"}) or its place in \`claims\`, counting from 0.` }
            claim = found.key
          }
          entry.pick = { rule, claim, reason: raw.pick.reason ?? null, considered: (entry.claims ?? []).map((c) => c.key), by: agentBy(ctx) }
        }
      }
      const picked = pickValue(entry)
      if (picked.problem && !entry.pick) return { problem: `${id}: ${picked.problem}. Choose with \`pick\` (one, lowest, highest or envelope) and a \`reason\`.` }
      const disagree = (entry.claims ?? []).some((c) => !sameValue(claimValue(c), claimValue(entry.claims[0])))
      if (disagree && entry.pick && !entry.pick.reason) return { problem: `${id}: its claims disagree, so the pick needs a \`reason\`.` }
      break
    }
    case "estimate": {
      const e = raw.estimate ?? existing?.estimate
      const parsed = parseValue(e?.value)
      if (parsed.problem) return { problem: `${id}: estimate.value: ${parsed.problem}` }
      if (!e?.reasoning) return { problem: `${id}: an estimate carries its reasoning (\`estimate.reasoning\`): how the number was arrived at.` }
      entry.estimate = { value: parsed.value, reasoning: String(e.reasoning) }
      break
    }
    case "unknown": {
      const u = raw.unknown === true ? {} : raw.unknown ?? existing?.unknown ?? {}
      let range = null
      if (u.range != null) {
        const parsed = parseValue(u.range)
        if (parsed.problem) return { problem: `${id}: unknown.range: ${parsed.problem}` }
        range = parsed.value
      }
      entry.unknown = { range, settle: u.settle ?? null }
      break
    }
    case "choice": {
      const c = raw.choice ?? existing?.choice
      const parsed = parseValue(c?.value)
      if (parsed.problem) return { problem: `${id}: choice.value: ${parsed.problem}` }
      const alternatives = []
      for (const a of c.alternatives ?? []) {
        const v = parseValue(a?.value ?? a)
        if (v.problem) return { problem: `${id}: an alternative: ${v.problem}` }
        alternatives.push({ value: v.value, note: a?.note ?? null })
      }
      entry.choice = { value: parsed.value, rationale: c.rationale ?? null, alternatives }
      break
    }
    case "formula": {
      const text = String(raw.formula ?? existing?.formula ?? "").trim()
      try {
        if (parse(text).kind !== "number") throw new SyntaxError("a formula is arithmetic, not a comparison")
      } catch (error) {
        return { problem: `${id}: formula: ${error.message}.` }
      }
      entry.formula = text
      break
    }
    case "model": {
      const m = raw.model ?? existing?.model
      const inputs = Array.isArray(m?.inputs) ? m.inputs.map(String) : Object.keys(m?.inputs ?? {})
      if (!inputs.length) return { problem: `${id}: a model result names the entries it was computed from in \`model.inputs\`, so the register can tell when it goes stale.` }
      const parsed = parseValue(raw.value ?? m?.value)
      if (parsed.problem) return { problem: `${id}: the model's output (\`value\`): ${parsed.problem}` }
      let url = m.url ?? null
      if (url && /^automerge:/.test(url) && !url.includes("#")) {
        try {
          url = pinnedUrl(await ctx.repo.find(url))
        } catch {}
      }
      const tolerance = m.tolerance == null ? 0 : Number(m.tolerance)
      if (!Number.isFinite(tolerance) || tolerance < 0) return { problem: `${id}: model.tolerance is a relative tolerance, 0 or more (0.02 = 2%).` }
      entry.model = { url, name: m.name ?? null, tolerance, inputs: Object.fromEntries(inputs.map((i) => [i, null])), value: parsed.value, at: [...at] }
      break
    }
    case "check": {
      const text = String(raw.check ?? existing?.check ?? "").trim()
      try {
        if (parse(text).kind !== "boolean") throw new SyntaxError("a check is a comparison, such as a <= b")
      } catch (error) {
        return { problem: `${id}: check: ${error.message}.` }
      }
      entry.check = text
      break
    }
  }
  if (raw.appliesIf !== undefined) {
    if (raw.appliesIf === null || raw.appliesIf === "") entry.appliesIf = null
    else {
      try {
        if (parse(raw.appliesIf).kind !== "boolean") throw new SyntaxError("`appliesIf` is a condition, such as boat_len_m >= 8")
      } catch (error) {
        return { problem: `${id}: appliesIf: ${error.message}.` }
      }
      entry.appliesIf = String(raw.appliesIf)
    }
  }
  if (raw.about !== undefined) entry.about = raw.about ? String(raw.about) : null
  if (raw.use !== undefined || raw.useNote !== undefined) {
    const intent = typeof raw.use === "object" && raw.use ? raw.use.intent : raw.use ?? entry.use?.intent ?? "model"
    const note = (typeof raw.use === "object" && raw.use ? raw.use.note : null) ?? raw.useNote ?? entry.use?.note ?? null
    if (!USES.includes(intent)) return { problem: `${id}: use is one of ${USES.join(", ")}.` }
    if (intent === "unused" && !note) return { problem: `${id}: an entry kept unused on purpose says why (\`useNote\`): an alternative, a cross-check…` }
    entry.use = { intent, note }
  }
  return { entry, dropped }
}

export const set = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const at = headsOf(handle)
    const list = Array.isArray(input.entries) ? input.entries : []
    const remove = Array.isArray(input.remove) ? input.remove.map(String) : []
    const answers = Array.isArray(input.answers) ? input.answers : []
    if (!list.length && !remove.length && !answers.length) return "Nothing to do: pass `entries`, `remove` or `answers`."

    const original = plain(doc.entries ?? {})
    const draft = plain(doc.entries ?? {})
    const problems = []
    const written = new Set()
    const sources = new Map()
    for (const raw of list) {
      const id = String(raw?.id ?? "").trim()
      const idIssue = idProblem(id)
      if (idIssue) {
        problems.push(idIssue)
        continue
      }
      const built = await buildEntry(id, raw, draft[id] ?? null, ctx, { at, sources })
      if (built.problem) {
        problems.push(built.problem)
        continue
      }
      if (built.dropped?.length && !input.why) {
        problems.push(`${id}: this drops a person's claim (${built.dropped.join(", ")}). Say why in \`why\`, or keep it by listing { key } in \`claims\`.`)
        continue
      }
      draft[id] = built.entry
      written.add(id)
    }
    const removed = []
    for (const id of remove) {
      if (!draft[id]) continue
      if (peoplesMarks(draft[id]).length && !input.why) {
        problems.push(`${id}: a person added evidence or judgement to it; removing it needs a \`why\`.`)
        continue
      }
      delete draft[id]
      removed.push(id)
    }

    // Whole-register rules, on the draft. Refusing one entry can break
    // another (a formula naming it), so repeat until nothing more is refused.
    const revert = (id, why) => {
      problems.push(why)
      written.delete(id)
      if (original[id]) draft[id] = plain(original[id])
      else delete draft[id]
    }
    for (let changed = true; changed; ) {
      changed = false
      for (const [name, owners] of nameClashes(draft)) {
        const mine = owners.find((o) => written.has(o))
        if (mine) {
          revert(mine, `${mine}: ${owners.filter((o) => o !== mine).join(", ")} would also export as ${name} (bounds export as id_min and id_max). Choose another id.`)
          changed = true
        }
      }
      const cycles = formulaCycles(draft)
      for (const id of [...written]) {
        const entry = draft[id]
        if (cycles.has(id)) {
          revert(id, `${id}: its formula would make a cycle (${[...cycles].join(" → ")}). Only model results may close a loop.`)
          changed = true
          continue
        }
        const names = entry.basis === "formula" ? parse(entry.formula).ids : entry.basis === "check" ? parse(entry.check).ids : entry.basis === "model" ? Object.keys(entry.model.inputs) : []
        const appliesNames = entry.appliesIf ? parse(entry.appliesIf).ids : []
        const missing = [...names, ...appliesNames].filter((name) => !draft[name])
        if (missing.length) {
          revert(id, `${id}: names ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in the register. Add ${missing.length === 1 ? "it" : "them"} first: every number a model uses belongs here.`)
          changed = true
          continue
        }
        const notValues = names.filter((name) => draft[name]?.basis === "check" || (draft[name]?.basis === "choice" && isText(draft[name]?.choice?.value)))
        if (entry.basis !== "model" && notValues.length) {
          revert(id, `${id}: ${notValues.join(", ")} ${notValues.length === 1 ? "is" : "are"} not a number it can compute with.`)
          changed = true
          continue
        }
        if (entry.about && draft[entry.about]?.basis !== "choice") {
          revert(id, `${id}: \`about\` names ${entry.about}, which ${draft[entry.about] ? "is not a decision" : "isn't in the register"}.`)
          changed = true
        }
      }
    }

    // Model results record their inputs as they are now.
    const models = [...written].filter((id) => draft[id].basis === "model")
    if (models.length) {
      const evaluation = evaluate({ entries: draft })
      for (const id of models) {
        for (const input of Object.keys(draft[id].model.inputs)) draft[id].model.inputs[input] = plainValue(evaluation.byId.get(input)?.value ?? null)
      }
    }

    const answered = []
    for (const a of answers) {
      const entry = draft[a?.id]
      const j = entry?.judgements?.find((x) => x.key === a.judgement)
      if (!j) {
        problems.push(`answers: no judgement '${a?.judgement}' on ${a?.id}. assumptions_read lists them under JUDGEMENTS TO ANSWER.`)
        continue
      }
      if (!a.says) {
        problems.push(`answers: say what you did or why the value stands (\`says\`).`)
        continue
      }
      answered.push({ id: a.id, key: j.key, answer: { says: String(a.says), by: agentBy(ctx), at: [...at] } })
    }

    if (!written.size && !removed.length && !answered.length) return `Nothing written.\n${problems.map((p) => `  ${p}`).join("\n")}`

    const why = input.why ? String(input.why) : `set ${[...written].join(", ") || "nothing"}${removed.length ? `; remove ${removed.join(", ")}` : ""}${answered.length ? `; answer ${answered.length} judgement${answered.length === 1 ? "" : "s"}` : ""}`
    handle.change(
      (d) => {
        if (!d.entries) d.entries = {}
        for (const id of written) {
          if (!d.entries[id]) d.entries[id] = {}
          assignFields(d.entries[id], { ...draft[id], value: d.entries[id].value ?? null })
        }
        for (const id of removed) delete d.entries[id]
        for (const { id, key, answer } of answered) {
          const j = d.entries[id]?.judgements?.find((x) => x.key === key)
          if (j) j.answer = answer
        }
        settle(d, at)
      },
      { message: message(ctx, why) },
    )

    const after = handle.doc()
    const evaluation = evaluate(after)
    const extra = scanProblems(after, evaluation)
    const all = allProblems(evaluation, extra)
    const out = [`Wrote ${written.size} entr${written.size === 1 ? "y" : "ies"}${removed.length ? `, removed ${removed.length}` : ""}${answered.length ? `, answered ${answered.length} judgement${answered.length === 1 ? "" : "s"}` : ""}.`]
    for (const id of written) out.push(`  ${figureLine(entryParts(id, after.entries[id], evaluation, { scan: after.scan, problems: all }))}`)
    if (problems.length) out.push("", "Not written:", ...problems.map((p) => `  ${p}`))
    const touched = all.filter((p) => written.has(p.id) || [...written].some((id) => evaluation.byId.get(p.id)?.leaves?.has(id)))
    if (touched.length) out.push("", "Now:", ...touched.slice(0, 10).map((p) => `  ${p.kind.padEnd(8)} ${p.text}`))
    return out.join("\n")
  },
  summarize(input) {
    const n = (input?.entries ?? []).length
    return `set ${n} entr${n === 1 ? "y" : "ies"}${input?.answers?.length ? ` · ${input.answers.length} answers` : ""}`
  },
}

// ---------------------------------------------------------------- check

async function scanAndSave(handle, ctx, folderUrl) {
  const doc = handle.doc()
  const at = headsOf(handle)
  const scan = folderUrl ? await scanFolder(ctx.repo, { entries: doc.entries ?? {}, registerUrl: handle.url, folderUrl, previous: doc.scan ?? null, at }) : null
  handle.change(
    (d) => {
      if (scan) writeScan(d, scan)
      const evaluation = settle(d, at)
      // A reference entry a model now reads: the mark is outdated, so correct it quietly.
      for (const [id, entry] of Object.entries(d.entries ?? {})) {
        if (entry.use?.intent === "reference" && observedUse(id, entry, evaluation.readers, d.scan) === "model") entry.use.intent = "model"
      }
    },
    { message: message(ctx, scan ? `check: scanned ${scan.read} document${scan.read === 1 ? "" : "s"}, reused ${scan.reused}` : "check") },
  )
  return scan
}

export const check = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const folderUrl = input.folder || handle.doc().scope
    await scanAndSave(handle, ctx, folderUrl)
    const doc = handle.doc()
    const evaluation = evaluate(doc)
    const extra = scanProblems(doc, evaluation)
    const text = checkText(doc, evaluation, extra, {
      constants: constantsIn(doc.scan, doc.entries),
      drift: driftIn(doc.scan, doc.entries),
      exports: exportsIn(doc.scan),
      pinned: pinnedUrl(handle),
      heads: headsOf(handle),
    })
    return folderUrl ? text : `${text}\n\nThis register has no scope folder, so nothing was scanned; pass \`folder\`.`
  },
  summarize(input, output) {
    return `check register · ${String(output ?? "").split("\n")[0].split(" · ").slice(2, 4).join(" · ")}`
  },
}

// ---------------------------------------------------------------- where

export const where = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const folderUrl = input.folder || handle.doc().scope
    if (!folderUrl) return "This register has no scope folder; pass `folder`."
    await scanAndSave(handle, ctx, folderUrl)
    const doc = handle.doc()
    const evaluation = evaluate(doc)
    const place = (u) => `${u.doc || "(doc)"}${u.part ? ` ${u.part}` : ""}:${u.line}`
    if (input.id) {
      const id = String(input.id)
      if (!doc.entries[id]) return `No entry '${id}'.`
      const lines = [`${id}: ${observedUse(id, doc.entries[id], evaluation.readers, doc.scan) ?? "not scanned"}`]
      const inRegister = [...(evaluation.readers.get(id) ?? [])].filter((r) => r !== id)
      lines.push(`  register: ${inRegister.length ? inRegister.join(", ") : "nothing reads it"}`)
      for (const use of ["model", "prose"]) {
        const hits = usesOf(doc.scan, id).filter((u) => u.use === use)
        lines.push(`  ${use}: ${hits.length || "none"}`)
        for (const u of hits.slice(0, 50)) lines.push(`    ${place(u)}  ${u.text}`)
      }
      return lines.join("\n")
    }
    const extra = scanProblems(doc, evaluation)
    return [
      detailHeader(doc),
      ...extra.filter((p) => p.kind === "UNUSED?").map((p) => `  UNUSED?  ${p.text}`),
      ...extra.filter((p) => p.kind === "PROSE").map((p) => `  PROSE    ${p.text}`),
      ...constantsIn(doc.scan, doc.entries).slice(0, 40).map((c) => `  CONSTANT ${place(c)}  ${c.name} = ${c.value}${c.comment ? `  # ${c.comment}` : ""}`),
      ...driftIn(doc.scan, doc.entries).map((d) => `  DRIFT    ${place(d)}  ${d.name} = ${d.value}, register says ${d.register}`),
    ].join("\n")
  },
  summarize(input) {
    return `where used${input?.id ? ` · ${input.id}` : ""}`
  },
}

function detailHeader(doc) {
  const s = doc.scan
  return `${Object.keys(s?.docs ?? {}).length} documents in the scan (${s?.read ?? 0} read now, ${s?.reused ?? 0} unchanged)${s?.truncated ? "; stopped early: too many documents" : ""}.`
}

// ---------------------------------------------------------------- export

export const exportTool = {
  async execute(input, ctx) {
    const handle = await openRegister(ctx, input.register)
    const doc = handle.doc()
    const format = input.format ?? "json"
    const spec = EXPORT_FORMATS[format]
    if (!spec) return `format is one of ${Object.keys(EXPORT_FORMATS).join(", ")}.`
    const evaluation = evaluate(doc)
    const entries = Object.fromEntries(
      Object.entries(doc.entries ?? {}).map(([id, entry]) => {
        const ev = evaluation.byId.get(id)
        return [id, { ...plain(entry), value: ev?.value ?? null, support: ev?.support ?? null, confidence: ev?.confidence ?? null }]
      }),
    )
    const content = renderExport(entries, { format, title: doc.title, registerUrl: handle.url })
    const name = input.name || `${doc.title || "assumptions"}.${spec.extension}`

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
    target.change(
      (d) => {
        if (made) d["@patchwork"] = { type: "file" }
        d.name = name
        d.extension = spec.extension
        d.mimeType = spec.mimeType
        d.content = content
        d.generatedFrom = { register: handle.url, heads: headsOf(handle) }
      },
      { message: message(ctx, `export the register as ${format}`) },
    )
    if (made) await fileInFolder(ctx, folderUrl, { name, type: "file", url: target.url })
    return {
      text: `${made ? "Exported" : "Updated"} '${name}' (${target.url}) from ${Object.keys(entries).length} entries. Models read their numbers from it by entry id; export again after the register changes.`,
      doc: { url: target.url, name, kind: "file" },
    }
  },
  summarize(input) {
    return `export register · ${input?.format ?? "json"}`
  },
}

export { detailText }
