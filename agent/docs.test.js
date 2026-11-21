import { describe, it, expect } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { docRead } from "./tools/docs.js"

describe("reading a long string in ranges", () => {
  const body = Array.from({ length: 30000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")

  function pageRepo() {
    const doc = { name: "Page.md", content: body, "@patchwork": { type: "file" } }
    return { async find() { return { url: "automerge:page", doc: () => doc } } }
  }
  const ctx = () => ({ repo: pageRepo(), subject: "automerge:page" })

  it("summarizes the string when no range is asked for, and says how to read on", async () => {
    const out = await docRead.execute({ url: "automerge:page", path: ["content"] }, ctx())
    expect(out).toMatch(/… \[\+28000 more chars: read on with doc_read \{url:\\"automerge:page\\", path:\[\\"content\\"\], offset:2000\}\]"$/)
    expect(out.length).toBeLessThan(3000)
  })

  it("returns the slice asked for, and says where it is", async () => {
    const out = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: 8000, limit: 100 },
      ctx()
    )
    expect(out).toContain("characters 8000–8100 of 30000")
    expect(out).toContain("21900 remaining (read on with offset: 8100)")
    expect(out.endsWith(body.slice(8000, 8100))).toBe(true)
  })

  it("says when it has reached the end", async () => {
    const out = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: 29900 },
      ctx()
    )
    expect(out).toContain("characters 29900–30000 of 30000, to the end")
    expect(out).not.toContain("remaining")
  })

  it("clamps a range that runs off either end", async () => {
    const past = await docRead.execute({ url: "automerge:page", path: ["content"], offset: 99999 }, ctx())
    expect(past).toContain("characters 30000–30000 of 30000, to the end")

    const negative = await docRead.execute(
      { url: "automerge:page", path: ["content"], offset: -50, limit: 10 },
      ctx()
    )
    expect(negative).toContain("characters 0–10 of 30000")
  })

  it("pages through the whole string without gaps or overlaps", async () => {
    let offset = 0
    let assembled = ""
    while (offset < body.length) {
      const out = await docRead.execute(
        { url: "automerge:page", path: ["content"], offset, limit: 9000 },
        ctx()
      )
      assembled += out.slice(out.indexOf("\n\n") + 2)
      const next = out.match(/offset: (\d+)/)
      if (!next) break
      offset = Number(next[1])
    }
    expect(assembled).toBe(body)
  })
})

describe("reading text written once", () => {
  // A kept source's content and a tool result are ImmutableStrings: not a
  // string to `typeof`, but read in ranges exactly like one.
  const body = "0123456789".repeat(100)
  const repo = { async find() { return { url: "automerge:kept", doc: () => ({ content: new ImmutableString(body) }) } } }

  it("pages an ImmutableString like a string", async () => {
    const out = await docRead.execute({ url: "automerge:kept", path: ["content"], offset: 10, limit: 5 }, { repo })
    expect(out).toBe("automerge:kept /content — characters 10–15 of 1000, 985 remaining (read on with offset: 15)\n\n01234")
  })
})

describe("doc_read with find", () => {
  // A notebook, as the jupyter tool keeps one: some strings plain, some ImmutableString.
  const notebook = {
    title: "Hull",
    cells: [
      { id: "c1", cell_type: "code", source: "import numpy as np\nR = drag(6.0)", outputs: [] },
      {
        id: "c2",
        cell_type: "code",
        source: "print(table)",
        outputs: [{ output_type: new ImmutableString("stream"), text: new ImmutableString(" kn   R N\n 5.0   93.1\n 6.0  161.0\n 7.0  218.0") }],
      },
      { id: "c3", cell_type: "code", source: "x = 1", outputs: [{ output_type: "error", ename: "ValueError", evalue: "bad shape" }], raw: new Uint8Array([54, 46, 48]) },
    ],
  }
  const ctx = () => ({ repo: { find: async () => ({ doc: () => notebook }) }, subject: "automerge:nb" })

  it("lists each string that mentions it — ImmutableStrings too, bytes never — with its path, offset and context", async () => {
    const out = await docRead.execute({ url: "automerge:nb", find: "6.0" }, ctx())
    expect(out.split("\n")).toEqual([
      'automerge:nb / — 2 matches for "6.0" in 2 strings. Read around one with doc_read {url:"automerge:nb", path:["cells",0,"source"], offset:0}.',
      '["cells",0,"source"] @28 · import numpy as np R = drag(6.0)',
      '["cells",1,"outputs",0,"text"] @23 · kn R N 5.0 93.1 6.0 161.0 7.0 218.0',
    ])
  })

  it("searches only under the path given, case-insensitively", async () => {
    const out = await docRead.execute({ url: "automerge:nb", path: ["cells", 2], find: "VALUEERROR" }, ctx())
    expect(out).toMatch(/^automerge:nb \/cells\/2 — 1 match for "VALUEERROR" in 1 string\./)
    expect(out).toContain('["cells",2,"outputs",0,"ename"] @0 · ValueError')
  })

  it("says when nothing matches", async () => {
    expect(await docRead.execute({ url: "automerge:nb", find: "nowhere" }, ctx())).toBe('automerge:nb / — no match for "nowhere".')
    expect(docRead.summarize({ find: "nowhere" }, 'automerge:nb / — no match for "nowhere".')).toBe('found "nowhere" in document · 0')
    expect(docRead.summarize({ find: "6.0", path: ["cells"] }, "automerge:nb /cells — 2 matches for …")).toBe('found "6.0" in /cells · 2')
  })

  it("keeps at most 20 matches, and counts them all", async () => {
    const many = { text: "x ".repeat(50) }
    const out = await docRead.execute({ url: "automerge:m", find: "x" }, { repo: { find: async () => ({ doc: () => many }) } })
    expect(out.split("\n")[0]).toMatch(/50 matches for "x" in 1 string, first 20 shown\./)
    expect(out.split("\n")).toHaveLength(21)
  })
})

describe("showing a document", () => {
  it("shows text written once as text, not as {val}", async () => {
    const doc = { kernel: new ImmutableString("Python (Pyodide)"), cells: [{ output_type: new ImmutableString("stream") }] }
    const out = await docRead.execute({ url: "automerge:nb" }, { repo: { find: async () => ({ doc: () => doc }) } })
    expect(JSON.parse(out)).toEqual({ kernel: "Python (Pyodide)", cells: [{ output_type: "stream" }] })
  })

  it("says how to read the rest of a long string inside a document, by its own path", async () => {
    const doc = { cells: [{ outputs: [{ text: new ImmutableString("y".repeat(2500)) }] }] }
    const out = await docRead.execute({ url: "automerge:nb", path: ["cells"] }, { repo: { find: async () => ({ doc: () => doc }) } })
    // The preview is JSON, so the hint's quotes arrive escaped.
    expect(out).toContain(String.raw`… [+500 more chars: read on with doc_read {url:\"automerge:nb\", path:[\"cells\",0,\"outputs\",0,\"text\"], offset:2000}]`)
  })
})
