import { describe, it, expect } from "vitest"
import { renderCallBody, renderInput, isLong, languageOf, codeBlock } from "./ui/bodies.js"
import { BUILTIN_TOOLS } from "./tools/index.js"

const body = (tool, input, result = null) => renderCallBody({ tool, input }, result)
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
        expect(() => renderCallBody({ tool: tool.id, input }, null), tool.id).not.toThrow()
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
