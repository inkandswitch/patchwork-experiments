import { describe, it, expect } from "vitest"
import { ImmutableString } from "@automerge/automerge"
import { docRead, docEdit, matchLine } from "./tools/docs.js"
import { docWatch } from "./tools/watch.js"

describe("reading a long string in ranges", () => {
  const body = Array.from({ length: 30000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("")

  function pageRepo() {
    const doc = { name: "Page.md", content: body, "@patchwork": { type: "file" } }
    return { async find() { return { url: "automerge:page", doc: () => doc } } }
  }
  const ctx = () => ({ repo: pageRepo(), subject: "automerge:page" })

  it("shows the text itself when no range is asked for, up to 8000 characters, and says how to read on", async () => {
    const out = await docRead.execute({ url: "automerge:page", path: ["content"] }, ctx())
    expect(out).toBe(`automerge:page /content — characters 0–8000 of 30000, 22000 remaining (read on with offset: 8000)\n\n${body.slice(0, 8000)}`)
  })

  it("does not escape text, so what is quoted from it is what is there", async () => {
    const doc = { note: 'say "hi"\n\tthen go' }
    const out = await docRead.execute({ url: "automerge:n", path: ["note"] }, { repo: { find: async () => ({ doc: () => doc }) } })
    expect(out).toBe('automerge:n /note — characters 0–17 of 17, to the end\n\nsay "hi"\n\tthen go')
  })

  it("shows a notebook cell's list of lines as the text it joins into", async () => {
    const doc = { cells: [{ source: ["a = 1\n", "b = 2\n", "print(a)"] }], tags: ["x", "y"] }
    const repo = { find: async () => ({ doc: () => doc }) }
    expect(await docRead.execute({ url: "automerge:nb", path: ["cells", 0, "source"] }, { repo })).toBe(
      "automerge:nb /cells/0/source — a list of 3 lines, joined: characters 0–20 of 20, to the end\n\na = 1\nb = 2\nprint(a)"
    )
    // A list of words is not text: it stays a list.
    expect(JSON.parse(await docRead.execute({ url: "automerge:nb", path: ["tags"] }, { repo }))).toEqual(["x", "y"])
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
    expect(out).toBe("automerge:kept /content — an ImmutableString, characters 10–15 of 1000, 985 remaining (read on with offset: 15)\n\n01234")
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

  it("lists each string that mentions it — ImmutableStrings too, bytes never — with its path, line and the line as written", async () => {
    const out = await docRead.execute({ url: "automerge:nb", find: "6.0" }, ctx())
    expect(out.split("\n")).toEqual([
      'automerge:nb / — 2 matches for "6.0" in 2 strings. Each is its string\'s path, line and @offset, then the line as written. Read around one with doc_read {url:"automerge:nb", path:["cells",0,"source"], offset:0}.',
      '["cells",0,"source"] line 2 @28: R = drag(6.0)',
      '["cells",1,"outputs",0,"text"] line 3 @23:  6.0  161.0',
    ])
  })

  it("searches only under the path given, case-insensitively", async () => {
    const out = await docRead.execute({ url: "automerge:nb", path: ["cells", 2], find: "VALUEERROR" }, ctx())
    expect(out).toMatch(/^automerge:nb \/cells\/2 — 1 match for "VALUEERROR" in 1 string\./)
    expect(out).toContain('["cells",2,"outputs",0,"ename"] line 1 @0: ValueError')
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

describe("the line a match is on", () => {
  it("is the whole line, numbered, when it is short", () => {
    const text = "one\ntwo three\nfour"
    expect(matchLine(text, text.indexOf("three"), 5)).toEqual({ number: 2, line: "two three" })
    expect(matchLine(text, 0, 3)).toEqual({ number: 1, line: "one" })
    expect(matchLine(text, text.indexOf("four"), 4)).toEqual({ number: 3, line: "four" })
  })

  it("is a window around the match when the line is long", () => {
    const text = `${"a".repeat(500)}NEEDLE${"b".repeat(500)}`
    const { number, line } = matchLine(text, 500, 6)
    expect(number).toBe(1)
    expect(line).toBe(`…${"a".repeat(120)}NEEDLE${"b".repeat(174)}…`)
  })
})

describe("a call with no url, in a session attached to no document", () => {
  const session = (doc) => ({ url: "automerge:s", doc: () => doc })
  const repo = { find: async () => ({ doc: () => ({}) }) }

  it("a workflow step is told to pass url, since it has no document of its own", async () => {
    const ctx = { repo, subject: null, session: session({ workflow: { planUrl: "automerge:p", stepId: "a" } }) }
    await expect(docRead.execute({}, ctx)).rejects.toThrow("Pass `url` (the document's automerge: URL) on every call: this step has no document of its own.")
    await expect(docEdit.execute({ ops: [] }, ctx)).rejects.toThrow(/this step has no document of its own/)
    const watching = { ...ctx, watches: { change() {}, doc: () => ({}) }, events: {} }
    await expect(docWatch.execute({ path: ["status"] }, watching)).rejects.toThrow(/this step has no document of its own/)
  })

  it("any other session is told it is attached to none", async () => {
    const ctx = { repo, subject: null, session: session({}) }
    await expect(docRead.execute({}, ctx)).rejects.toThrow(/This session is not attached to a document, so say which one: pass `url`/)
    await expect(docRead.execute({}, { repo, subject: null })).rejects.toThrow(/not attached to a document/)
  })
})
