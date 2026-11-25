import { describe, it, expect } from "vitest"
import { renderCallBody, renderInput, isLong, languageOf, codeBlock, INPUT_LAYOUTS } from "./bodies.js"
import { BUILTIN_TOOLS } from "../assembly/builtin.js"
import { written } from "../fixtures/calls.js"

/** A call as the loop writes it: it carries how it opens, as its tool says (kernel/tool.js presentCall). */
const body = (tool, input, result = null) => renderCallBody(written({ tool, input }), result)
const textOf = (node) => node.textContent

describe("the thing this file exists to fix", () => {
  const source = 'export default function Tool(handle, element) {\n  const root = document.createElement("div")\n  return () => root.remove()\n}'

  it("renders a written file with its newlines intact", () => {
    // The old body was JSON.stringify(input), which escapes every newline — so
    // 200 lines of source came out as one endless line of literal \n and you
    // could not read a word of it.
    const node = body("fs_write", { path: "tally/tool.js", content: source })
    const code = node.querySelector("pre code")

    expect(code.textContent).toBe(source)
    expect(code.textContent).toContain("\n")
    expect(textOf(node)).not.toContain("\\n")
  })

  it("labels each file when several are written at once", () => {
    const node = body("fs_write", {
      files: { "tally/index.js": "export const plugins = []", "tally/tool.js": source },
    })
    const labels = [...node.querySelectorAll(".agent-block-label")].map((l) => l.textContent)
    expect(labels).toContain("tally/index.js")
    expect(labels).toContain("tally/tool.js")
    expect(node.querySelectorAll("pre code")).toHaveLength(2)
  })

  it("marks the language from the file name, so it could be highlighted", () => {
    const node = body("fs_write", { path: "a/b.ts", content: "const x: number = 1" })
    expect(node.querySelector("pre code").dataset.language).toBe("ts")
    expect(languageOf("x.tsx")).toBe("tsx")
    expect(languageOf("engine.wasm")).toBeNull()
  })

  it("keeps the root out of the file blocks but still shows it", () => {
    const node = body("fs_write", { root: "automerge:r", path: "a.js", content: "x" })
    expect(node.querySelector(".agent-field-value").textContent).toBe("automerge:r")
  })
})

describe("an edit reads as the changes it makes", () => {
  it("shows one line per op", () => {
    const node = body("doc_edit", {
      ops: [
        { op: "set", path: ["title"], value: "Soup" },
        { op: "append", path: ["items"], value: "milk" },
        { op: "delete", path: ["draft"] },
        { op: "replace", path: ["body"], find: "teh cat", text: "the cat" },
        { op: "insert", path: ["body"], after: "the cat", text: " sat" },
        { op: "set", path: ["cells", 1, "source"], from: { url: "automerge:x", path: ["content"] } },
      ],
    })
    const rows = [...node.querySelectorAll(".agent-op")]
    expect(rows).toHaveLength(6)
    expect(rows[0].textContent).toBe("/titleSoup")
    expect(rows[1].textContent).toBe("/itemsappend milk")
    expect(rows[2].querySelector(".agent-op-delete").textContent).toBe("delete")
    expect(rows[3].textContent).toBe("/body“teh cat” → “the cat”")
    expect(rows[4].textContent).toBe("/body“sat” after “the cat”")
    expect(rows[5].textContent).toBe("/cells/1/sourcethe text at /content in another document")
  })

  it("pulls long text out into a block rather than squeezing it into a row", () => {
    const long = "a line\n".repeat(20)
    const node = body("doc_edit", { ops: [{ op: "append", path: ["body"], text: long }] })
    expect(node.querySelector("pre code").textContent).toBe(long)
    expect(node.querySelector(".agent-op-value").textContent.endsWith("…")).toBe(true)
  })

  it("falls back to the generic rendering for a malformed edit", () => {
    expect(() => body("doc_edit", { ops: "not a list" })).not.toThrow()
  })
})

describe("the generic rendering", () => {
  it("puts short scalars in rows and long strings in blocks", () => {
    const node = renderInput({ url: "automerge:abc", limit: 5, content: "x".repeat(200) })
    const holder = document.createElement("div")
    holder.append(...node)

    expect([...holder.querySelectorAll(".agent-field-label")].map((l) => l.textContent)).toEqual(["url", "limit"])
    expect(holder.querySelector("pre code").textContent).toHaveLength(200)
  })

  it("treats anything with a newline as long, however short", () => {
    expect(isLong("a\nb")).toBe(true)
    expect(isLong("short")).toBe(false)
    expect(isLong(5)).toBe(false)
  })

  it("expands a big object rather than cramming it into a row", () => {
    const holder = document.createElement("div")
    holder.append(...renderInput({ headers: { a: "1".repeat(100) } }))
    expect(holder.querySelector("pre code").textContent).toContain('"a"')
  })

  it("survives every builtin tool's input shape", () => {
    for (const tool of BUILTIN_TOOLS) {
      for (const input of [{}, { url: "automerge:a" }, { ops: null }, { files: "nope" }, { options: 3 }]) {
        expect(() => renderCallBody(written({ tool: tool.id, input }), null), tool.id).not.toThrow()
      }
    }
  })
})

describe("results", () => {
  it("shows tool output as text, not as JSON", () => {
    const node = body("doc_read", { url: "automerge:a" }, { output: "line one\nline two" })
    expect(node.querySelector(".agent-code-output").textContent).toBe("line one\nline two")
  })

  it("renders a fetched page as prose, since that is what it is", () => {
    const node = body("web_fetch", { url: "https://x.test/" }, { output: "# Title\n\n- one\n- two" })
    expect(node.querySelector("h1").textContent).toBe("Title")
    expect(node.querySelectorAll("li")).toHaveLength(2)
  })

  it("keeps an error monospace even for a tool whose output is normally prose", () => {
    // Errors carry stacks and file positions; alignment matters more than prose.
    const node = body("web_fetch", { url: "https://x.test/" }, { isError: true, output: "Error: 403\n  at x" })
    expect(node.querySelector("h1")).toBeNull()
    expect(node.querySelector(".agent-output-error")).toBeTruthy()
  })

  it("shows nothing for a result with no output", () => {
    const node = body("doc_read", { url: "automerge:a" }, { output: "" })
    expect(textOf(node)).not.toContain("result")
  })

  it("renders a question's options as a list", () => {
    const node = body("ask_user", {
      question: "Which?",
      context: "both work",
      options: ["Grid", { label: "List", detail: "one per row" }],
    })
    expect(node.textContent).toContain("both work")
    expect([...node.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["Grid", "List — one per row"])
  })
})

describe("a call opens as its tool says, whoever's tool it is", () => {
  // The view has no table of tools: the call carries it (`shown`).
  const call = (shown, input) => ({ tool: "some_package_tool", input, shown: { verb: "do", detail: "", ...shown } })

  it("an input layout is asked for by name, and lays out any tool's input of that shape", () => {
    expect(Object.keys(INPUT_LAYOUTS)).toEqual(["files", "edits", "question"])
    const files = renderCallBody(call({ body: "files" }, { path: "a/b.js", content: "one\ntwo" }), null)
    expect(files.querySelector(".agent-block-label + pre code").textContent).toBe("one\ntwo")
    expect(files.querySelector("pre code").dataset.language).toBe("js")
    const edits = renderCallBody(call({ body: "edits" }, { ops: [{ op: "delete", path: ["a"] }] }), null)
    expect(edits.querySelector(".agent-op-delete")).toBeTruthy()
    const question = renderCallBody(call({ body: "question" }, { options: ["A", "B"] }), null)
    expect([...question.querySelectorAll("li")].map((l) => l.textContent)).toEqual(["A", "B"])
  })

  it.each([[{}], [{ body: "hologram" }], [null]])("a call that names no layout, or one this view lacks, is a field list: %j", (shown) => {
    const node = renderCallBody({ tool: "some_package_tool", input: { path: "a/b.js", content: "one\ntwo" }, shown }, null)
    expect([...node.querySelectorAll(".agent-field-label")].map((l) => l.textContent)).toEqual(["path"])
    expect([...node.querySelectorAll(".agent-block-label")].map((l) => l.textContent)).toEqual(["call", "content"])
  })

  it("a result is prose, text in a language, or a monospace report, as the call says", () => {
    const out = (shown, result = { output: "# Title\n\nbody" }) => renderCallBody(call(shown, {}), result).querySelector(".agent-output")
    expect(out({ format: "markdown" }).querySelector("pre")).toBeNull()
    expect(out({ format: "markdown" }).textContent).toContain("Title")
    expect(out({ format: "js" }).querySelector("pre code").dataset.language).toBe("js")
    expect(out({}).querySelector("pre code").dataset.language).toBeUndefined()
    // An error is always monospace: it carries stacks and positions.
    expect(out({ format: "markdown" }, { output: "Error: no", isError: true }).querySelector("pre")).toBeTruthy()
  })

  it("the built-in tools say theirs", () => {
    const said = (tool, input) => { const { body, format } = written({ tool, input }).shown; return { body, format } }
    expect(said("fs_write", { path: "a.js", content: "" })).toEqual({ body: "files", format: undefined })
    expect(said("doc_edit", { ops: [] })).toEqual({ body: "edits", format: undefined })
    expect(said("ask_user", { question: "?" })).toEqual({ body: "question", format: undefined })
    expect(said("fs_read", { path: "a/tool.ts" })).toEqual({ body: undefined, format: "ts" })
    expect(said("fs_read", { path: "a/engine.wasm" })).toEqual({ body: undefined, format: undefined })
    expect(said("plugin_source", { id: "p", file: "index.js" })).toEqual({ body: undefined, format: "js" })
    for (const tool of ["web_fetch", "source_read", "skill_read"]) expect(said(tool, { url: "https://a.test", source: "automerge:x", name: "n" }), tool).toEqual({ body: undefined, format: "markdown" })
  })
})

describe("it is still never markup", () => {
  it("does not parse HTML in a file it renders", () => {
    const node = body("fs_write", { path: "x.html", content: "<script>alert(1)</script>" })
    expect(node.querySelector("script")).toBeNull()
    expect(node.querySelector("pre code").textContent).toBe("<script>alert(1)</script>")
  })

  it("does not parse HTML in tool output", () => {
    const node = body("dom_snapshot", {}, { output: "<img src=x onerror=alert(1)>" })
    expect(node.querySelector("img")).toBeNull()
  })

  it("builds a code block from text alone", () => {
    const node = codeBlock("<b>not bold</b>")
    expect(node.querySelector("b")).toBeNull()
    expect(node.textContent).toBe("<b>not bold</b>")
  })
})
