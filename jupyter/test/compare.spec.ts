import * as Automerge from "@automerge/automerge"
import { beforeAll, describe, expect, test } from "vitest"
import { setAutomerge } from "../shared/automerge"
import type { NotebookDoc } from "../shared/schema"
import { commonAncestor } from "../native/src/compare/ancestor"
import { notebookDiff } from "../native/src/compare/notebook-diff"
import { lineDiff, versionDiff } from "../native/src/compare/versions"

type Doc = Automerge.Doc<NotebookDoc>
type Cell = { id: string; cell_type: string; source: string; outputs?: unknown[] }

beforeAll(() => setAutomerge(Automerge))

const code = (id: string, source: string, outputs: unknown[] = []): Cell => ({ id, cell_type: "code", source, outputs })
const notebook = (cells: Cell[]): Doc =>
  Automerge.from<NotebookDoc>({ cells: cells.map(cell => ({ metadata: {}, execution_count: null, ...cell })) } as any)
const edit = (doc: Doc, change: (doc: any) => void): Doc => Automerge.change(Automerge.clone(doc), change)
const index = (doc: any, id: string) => doc.cells.findIndex((cell: any) => cell.id === id)
const stream = (text: string) => ({ output_type: "stream", name: "stdout", text })

/** Two drafts forked from `cells`: main, and a draft made with `change`. */
function fork(cells: Cell[], change: (doc: any) => void) {
  const main = notebook(cells)
  const draft = edit(main, change)
  return { main, draft, diff: () => notebookDiff(draft, commonAncestor(draft, main)) }
}

describe("commonAncestor", () => {
  test("is the other draft's heads when this one has all of it", () => {
    const { main, draft } = fork([code("a", "1")], doc => doc.cells.push(code("b", "2")))
    expect(commonAncestor(draft, main)).toEqual(Automerge.getHeads(main))
  })

  test("is this draft's heads when the other has all of it", () => {
    const { main, draft } = fork([code("a", "1")], doc => doc.cells.push(code("b", "2")))
    expect(commonAncestor(main, draft)).toEqual(Automerge.getHeads(main))
  })

  test("is where the drafts parted when both went on", () => {
    const main = notebook([code("a", "1")])
    const parted = Automerge.getHeads(main)
    const draft = edit(main, doc => doc.cells.push(code("b", "2")))
    const later = edit(main, doc => doc.cells.push(code("c", "3")))
    expect(new Set(commonAncestor(draft, later))).toEqual(new Set(parted))
  })

  test("is empty for documents that share nothing", () => {
    expect(commonAncestor(notebook([code("a", "1")]), notebook([code("a", "1")]))).toEqual([])
  })
})

describe("notebookDiff since the drafts parted", () => {
  test("finds nothing when nothing changed", () => {
    expect(fork([code("a", "print(1)")], () => {}).diff()).toEqual({ cells: new Map(), deleted: [] })
  })

  test("marks inserted cells as added", () => {
    const { diff } = fork([code("a", "print(1)")], doc => doc.cells.push(code("b", "print(2)")))
    expect(diff()!.cells).toEqual(new Map([["b", { type: "added" }]]))
  })

  test("locates edits inside a cell", () => {
    const { diff } = fork([code("a", "hello world")], doc => {
      Automerge.splice(doc, ["cells", 0, "source"], 6, 5, "there")
    })
    expect(diff()!.cells.get("a")).toEqual({
      type: "changed",
      input: true,
      outputs: false,
      source: [
        { type: "added", from: 6, to: 11 },
        { type: "deleted", at: 11, text: "world" },
      ],
    })
  })

  test("doesn't count the other draft's changes as this one's", () => {
    const main = notebook([code("a", "x = 1"), code("b", "y = 2")])
    const draft = edit(main, doc => Automerge.splice(doc, ["cells", 0, "source"], 5, 0, "0"))
    const later = edit(main, doc => {
      Automerge.splice(doc, ["cells", 1, "source"], 5, 0, "0")
      doc.cells.push(code("c", "z = 3"))
    })
    const diff = notebookDiff(draft, commonAncestor(draft, later))!
    expect([...diff.cells.keys()]).toEqual(["a"])
    expect(diff.deleted).toEqual([])
  })

  test("does not count moving a cell as a change", () => {
    const { diff } = fork([code("a", "1"), code("b", "2")], doc => {
      const moved = JSON.parse(JSON.stringify(doc.cells[0]))
      doc.cells.deleteAt(0)
      doc.cells.push(moved)
    })
    expect(diff()!.cells.size).toBe(0)
  })

  test("flags changed outputs separately from the input", () => {
    const { diff } = fork([code("a", "print(1)")], doc => doc.cells[0].outputs.push(stream("1\n")))
    expect(diff()!.cells.get("a")).toMatchObject({ type: "changed", input: false, outputs: true })
  })

  test("places removed cells before the cell they were in front of, or at the end", () => {
    const { diff } = fork([code("a", "1"), code("b", "2"), code("c", "3")], doc => {
      doc.cells.deleteAt(index(doc, "c"))
      doc.cells.deleteAt(index(doc, "a"))
    })
    expect(diff()!.deleted.map(cell => [cell.id, cell.before])).toEqual([
      ["a", "b"],
      ["c", null],
    ])
  })

  test("counts every cell as added when the other draft doesn't have the notebook", () => {
    const doc = notebook([code("a", "1"), code("b", "2")])
    expect([...notebookDiff(doc, [])!.cells.values()]).toEqual([{ type: "added" }, { type: "added" }])
  })

  test("gives up on a baseline outside the history", () => {
    const other = notebook([code("a", "1")])
    expect(notebookDiff(notebook([code("a", "1")]), Automerge.getHeads(other))).toBeNull()
  })
})

describe("versionDiff", () => {
  test("finds nothing between equal versions", () => {
    const { main } = fork([code("a", "1")], () => {})
    expect(versionDiff(main, main)).toEqual({ cells: new Map(), theirs: [] })
  })

  test("marks cells only this version has", () => {
    const { main, draft } = fork([code("a", "1")], doc => doc.cells.push(code("b", "2")))
    expect(versionDiff(draft, main).cells).toEqual(new Map([["b", { type: "ours" }]]))
  })

  test("places the other version's cells where they'd be, outputs and all", () => {
    const { main, draft } = fork([code("a", "1"), code("b", "2", [stream("2\n")]), code("c", "3")], doc => {
      doc.cells.deleteAt(index(doc, "b"))
    })
    const { theirs } = versionDiff(draft, main)
    expect(theirs).toEqual([{ id: "b", cellType: "code", source: "2", outputs: [stream("2\n")], before: "c" }])
  })

  test("gives the other version's source, type and outputs where they differ", () => {
    const { main, draft } = fork([code("a", "print(1)", [stream("1\n")])], doc => {
      Automerge.splice(doc, ["cells", 0, "source"], 6, 1, "2")
      doc.cells[0].outputs = []
    })
    expect(versionDiff(draft, main).cells.get("a")).toEqual({
      type: "differs",
      source: "print(1)",
      cellType: null,
      outputs: [stream("1\n")],
    })
  })

  test("doesn't count outputs that show the same, or metadata", () => {
    const result = (count: number) => ({ output_type: "execute_result", execution_count: count, data: { "text/plain": "42" }, metadata: {} })
    const { main, draft } = fork([code("a", "6 * 7", [stream("a"), stream("b\n"), result(1)])], doc => {
      doc.cells[0].outputs = [stream("ab\n"), result(2)]
      doc.cells[0].metadata.scrolled = true
    })
    expect(versionDiff(draft, main).cells.size).toBe(0)
    expect(notebookDiff(draft, commonAncestor(draft, main))!.cells.size).toBe(0)
  })

  test("does not count moving a cell as a difference", () => {
    const { main, draft } = fork([code("a", "1"), code("b", "2")], doc => {
      const moved = JSON.parse(JSON.stringify(doc.cells[0]))
      doc.cells.deleteAt(0)
      doc.cells.push(moved)
    })
    expect(versionDiff(draft, main)).toEqual({ cells: new Map(), theirs: [] })
  })
})

describe("lineDiff", () => {
  test("finds nothing between equal lines", () => {
    expect(lineDiff(["a", "b"], ["a", "b"])).toEqual([])
  })

  test("finds a changed line between unchanged ones", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "x", "c"])).toEqual([{ fromA: 1, toA: 2, fromB: 1, toB: 2 }])
  })

  test("finds lines only one side has", () => {
    expect(lineDiff(["a", "c"], ["a", "b", "c"])).toEqual([{ fromA: 1, toA: 1, fromB: 1, toB: 2 }])
    expect(lineDiff(["a", "b", "c"], ["c"])).toEqual([{ fromA: 0, toA: 2, fromB: 0, toB: 0 }])
  })

  test("keeps lines both have in the middle of changes", () => {
    expect(lineDiff(["x", "keep", "y"], ["p", "keep", "q"])).toEqual([
      { fromA: 0, toA: 1, fromB: 0, toB: 1 },
      { fromA: 2, toA: 3, fromB: 2, toB: 3 },
    ])
  })
})
