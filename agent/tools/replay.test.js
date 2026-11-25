/**
 * The Nootka Princess run's doc_edit calls that failed, or that only worked
 * through a workaround, replayed in today's shape on equivalent documents.
 *
 * fixtures/doc-edit-replay.json holds the calls in the shape the run's
 * sessions recorded them (old shape: path + range/find + value) with what
 * each returned. It is a stand-in for the recording: every call, path, range
 * and length is the run's, and so are the tools' answers, but each text is
 * filler of the same length and the documents named do not exist. What is
 * replayed is the shape of each call, which is what went wrong. Each test
 * translates them by the rules below and shows that the translated call does
 * what the old one was for, first time.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import * as A from "@automerge/automerge"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { docEdit } from "./docs.js"
import { fsWrite } from "./folders.js"

await initSubduction()

const RUN = JSON.parse(readFileSync(`${process.cwd()}/fixtures/doc-edit-replay.json`, "utf8"))
const PLACEHOLDER = /@@\w+@@/g

const plainOf = (value) => JSON.parse(JSON.stringify(value))

function world() {
  const repo = new Repo({ network: [] })
  return { repo, ctx: { repo, splice: A.splice } }
}

/** The old ops' meaning, on plain JSON: what the run's calls did when they worked. */
function applyOld(doc, ops) {
  for (const { path = [], range, find, value } of plainOf(ops)) {
    const parent = path.slice(0, -1).reduce((node, key) => node[key], doc)
    const key = path.at(-1)
    const target = path.reduce((node, k) => node[k], doc)
    if (find != null) {
      const at = target.indexOf(find)
      if (at < 0 || target.indexOf(find, at + 1) >= 0) throw new Error(`old find failed: ${find}`)
      parent[key] = target.slice(0, at) + (value ?? "") + target.slice(at + find.length)
    } else if (Array.isArray(range)) {
      const [from, to = from] = range
      if (typeof target === "string") parent[key] = target.slice(0, from) + (value ?? "") + target.slice(to)
      else target.splice(from, to - from, ...(Array.isArray(value) ? value : [value]))
    } else if (range != null) {
      target[range] = value
    } else {
      parent[key] = value
    }
  }
  return doc
}

/** The old shape in the new one, for a document that holds `doc`. */
function translate(doc, ops) {
  const out = []
  for (const { path = [], range, find, value } of ops) {
    const target = path.reduce((node, k) => node?.[k], doc)
    if (find != null) {
      // A placeholder at the end of the text was a way to append in pieces.
      if (/^@@\w+@@$/.test(find)) out.push({ op: "append", path, text: String(value).replace(PLACEHOLDER, "") })
      else out.push({ op: "replace", path, find, text: value ?? "" })
    } else if (Array.isArray(range)) {
      const [from, to = from] = range
      if (typeof target === "string") {
        if (from >= target.length - 1 && to >= from) out.push({ op: "append", path, text: value })
        else if (from === 0 && to >= target.length) out.push({ op: "set", path, text: value })
        else throw new Error("no translation for a mid-text range")
      } else {
        for (let i = from; i < to; i++) out.push({ op: "delete", path: [...path, from] })
        const items = Array.isArray(value) ? value : [value]
        items.forEach((item, i) => out.push({ op: "insert", path: [...path, from + i], value: stripPlaceholders(item) }))
      }
    } else if (range != null) {
      out.push(value == null ? { op: "delete", path: [...path, range] } : { op: "set", path: [...path, range], value })
    } else {
      out.push({ op: "set", path, value })
    }
  }
  return out
}

/** Placeholders were scaffolding for the workaround; the new shape needs none. */
function stripPlaceholders(value) {
  if (typeof value === "string") return value.replace(PLACEHOLDER, "")
  if (Array.isArray(value)) return value.map(stripPlaceholders)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPlaceholders(v)]))
  return value
}

describe("the Nootka run's failed doc_edit calls, replayed in the new shape", () => {
  it("an append that missed the end by one character: append needs no offset", async () => {
    const [failed, retried] = RUN.offsetAppend
    expect(failed.output).toMatch(/range \[38, 38\] is outside \/content, which has 37 characters/)
    expect(retried.input.ops[0].range).toEqual([37, 37])

    const { repo, ctx } = world()
    const title = "# Nootka Princess — hull measurements"
    expect(title).toHaveLength(37)
    const handle = repo.create({ "@patchwork": { type: "markdown" }, content: title })
    const [ops] = [translate(handle.doc(), failed.input.ops)]
    expect(ops).toEqual([{ op: "append", path: ["content"], text: failed.input.ops[0].value }])
    await docEdit.execute({ url: handle.url, ops }, ctx)
    expect(handle.doc().content).toBe(title + failed.input.ops[0].value)
  })

  it("a whole cell rewritten with range [0, 1000000]: set text needs no length", async () => {
    const [failed, retried] = RUN.wholeRange
    expect(failed.output).toMatch(/range \[0, 1000000\] is outside \/cells\/7\/source, which has 3380 characters/)
    expect(retried.input.ops[2].range).toEqual([0, 3380])

    const [first, second] = failed.input.ops
    const cells = Array.from({ length: 8 }, () => ({ cell_type: "code", source: "" }))
    cells[5].source = `${first.find}\n    ...\n${second.find}\n`
    cells[7].source = "x".repeat(3380)
    const { repo, ctx } = world()
    const handle = repo.create({ cells })
    const ops = translate(handle.doc(), failed.input.ops)
    expect(ops.map((op) => op.op)).toEqual(["replace", "replace", "set"])
    await docEdit.execute({ url: handle.url, ops }, ctx)
    expect(plainOf(handle.doc())).toEqual(applyOld(plainOf({ cells }), retried.input.ops))
  })

  it("an OpenSCAD model by url: fs_write says to edit its source with doc_edit, and that edit lands", async () => {
    const [write, noUrl, retried] = RUN.notAFile
    expect(write.output).toMatch(/is not a file document/)
    expect(noUrl.output).toMatch(/No document specified/)

    const { repo, ctx } = world()
    const model = repo.create({ "@patchwork": { type: "openscad" }, title: "CAD — Motor, mount & shaft coupling", source: "// placeholder: the step writes the model here\n" })
    await expect(fsWrite.execute({ url: model.url, content: write.input.content }, ctx)).rejects.toThrow(
      /is not a file document \(it is a 'openscad' document\)\. Edit it with doc_edit, by path\. Its text is in \['source'\]\./
    )
    // In a step session there is no subject, so the url is the document's.
    await expect(docEdit.execute({ ops: [] }, ctx)).rejects.toThrow(/not attached to a document, so say which one: pass `url`/)
    const ops = translate(model.doc(), noUrl.input.ops)
    expect(ops).toEqual([{ op: "set", path: ["source"], value: noUrl.input.ops[0].value }])
    await docEdit.execute({ url: model.url, ops }, ctx)
    expect(model.doc().source).toBe(noUrl.input.ops[0].value)
    expect(retried.input.url).toBe("automerge:tteg8dbYzAMhpuD7AkG8c8gxzLY")
  })

  it("a scene's packages and objects: the same edit, given the url", async () => {
    const [failed, retried] = RUN.noUrl
    const { repo, ctx } = world()
    const scene = repo.create({ packages: [], objects: {}, order: [], view: { start: {} } })
    const ops = translate(scene.doc(), retried.input.ops)
    await docEdit.execute({ url: scene.url, ops }, ctx)
    expect(plainOf(scene.doc())).toEqual(applyOld({ packages: [], objects: {}, order: [], view: { start: {} } }, retried.input.ops))
    expect(failed.input.ops.length).toBeLessThan(retried.input.ops.length)
  })

  for (const [session, calls] of Object.entries(RUN.placeholders)) {
    it(`${session}: a long text written in pieces, with no placeholders and no find`, async () => {
      // The run seeded a cell with a marker, then replaced the marker with
      // each chunk plus a new marker. Now each chunk is an append.
      const original = { cells: [{ cell_type: "markdown", source: "" }] }
      const expected = calls.reduce((doc, call) => applyOld(doc, call.input.ops), plainOf(original))

      const { repo, ctx } = world()
      const handle = repo.create(plainOf(original))
      const sizes = []
      for (const call of calls) {
        const ops = translate(handle.doc(), call.input.ops)
        for (const op of ops) if (op.op === "append") sizes.push(op.text.length)
        await docEdit.execute({ url: handle.url, ops }, ctx)
      }
      expect(plainOf(handle.doc())).toEqual(stripPlaceholders(expected))
      expect(JSON.stringify(handle.doc())).not.toMatch(PLACEHOLDER)
      expect(Math.max(...sizes)).toBeLessThan(7000)
    })
  }

  it("VQLkUG: the register export pasted in four chunks is one `from` op", async () => {
    // The four chunks together were the export file, verbatim, after its header line.
    const calls = RUN.placeholders.VQLkUG
    const chunks = calls.slice(1, 5).map((call) => call.input.ops[0].value.replace(PLACEHOLDER, ""))
    const exported = chunks.join("")

    const { repo, ctx } = world()
    const file = repo.create({ "@patchwork": { type: "file" }, name: "assumptions.py", content: exported })
    const notebook = repo.create({ cells: [{ cell_type: "code", source: "" }] })
    const out = await docEdit.execute({ url: notebook.url, ops: [{ op: "set", path: ["cells", 0, "source"], from: { url: file.url, path: ["content"] } }] }, ctx)
    expect(notebook.doc().cells[0].source).toBe(exported)
    expect(exported.length).toBeGreaterThan(20000)
    expect(out.length).toBeLessThan(2000) // the result is a diff of its ends, not the text again
  })
})

describe("the agent's notes on doc_edit, answered", () => {
  it("'set ml with path [...,\"ingredients\",i] range \"ml\" — NOT path ending in \"ml\"': the path ending in ml is the call", async () => {
    const { repo, ctx } = world()
    const recipe = repo.create({ ingredients: [{ name: "gin", ml: 45 }, { name: "lime", ml: 20 }] })
    await docEdit.execute({ url: recipe.url, ops: [{ op: "set", path: ["ingredients", 1, "ml"], value: 25 }] }, ctx)
    expect(recipe.doc().ingredients[1].ml).toBe(25)
  })

  it("'appending at the end with a range offset can land mid-text if the length changed': append lands at the end", async () => {
    const { repo, ctx } = world()
    const doc = repo.create({ content: "line one\n" })
    // Someone else adds to the text after the agent read it.
    doc.change((d) => { A.splice(d, ["content"], 9, 0, "line two\n") })
    await docEdit.execute({ url: doc.url, ops: [{ op: "append", path: ["content"], text: "line three\n" }] }, ctx)
    expect(doc.doc().content).toBe("line one\nline two\nline three\n")
  })

  it("'Workflow plans and sessions cannot be edited with doc_edit': the refusal says what to use", async () => {
    const { repo, ctx } = world()
    const plan = repo.create({ "@patchwork": { type: "agent-workflow" }, steps: [] })
    const refusing = { ...ctx, repo: { find: async (url) => ({ ...(await repo.find(url)), doc: () => plan.doc(), change() { throw new Error("Sessions and workflow plans are written only by the agent runtime; no tool may change one.") } }) } }
    await expect(docEdit.execute({ url: plan.url, ops: [{ op: "set", path: ["steps", 0], value: {} }] }, refusing)).rejects.toThrow(
      /written only by the agent runtime.*workflow_add_steps for more steps, workflow_edit_steps for a step that has not started/
    )
  })
})
