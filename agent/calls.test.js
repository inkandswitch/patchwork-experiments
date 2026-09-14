import { describe, it, expect } from "vitest"
import { describeCall, PRESENTATION, describeOps, shortDoc, pathLabel, hostOf, baseName } from "./ui/calls.js"
import { BUILTIN_TOOLS } from "./tools/index.js"

const call = (tool, input = {}, status = "done") => ({ tool, input, status })
const show = (tool, input, result = null, subject = null) =>
  describeCall(call(tool, input), result, { subject })

describe("every tool has a presentation", () => {
  it("covers the whole built-in toolset", () => {
    // The point of the test: adding a tool without a presentation entry means a
    // line in the log that reads `view_interact  #btn-3`, which is a dump of the
    // arguments rather than a description of what happened.
    const missing = BUILTIN_TOOLS.map((t) => t.id).filter((id) => !PRESENTATION[id])
    expect(missing).toEqual([])
  })

  it("has no entries for tools that no longer exist", () => {
    const ids = new Set(BUILTIN_TOOLS.map((t) => t.id))
    expect(Object.keys(PRESENTATION).filter((id) => !ids.has(id))).toEqual([])
  })

  it("gives every tool a verb that is not just its id", () => {
    for (const tool of BUILTIN_TOOLS) {
      const { verb } = show(tool.id, {})
      expect(verb, tool.id).toBeTruthy()
      // http_request's verb is the HTTP method, which is right, so allow it.
      if (tool.id !== "http_request") expect(verb, tool.id).not.toBe(tool.id)
    }
  })

  it("never renders a bare automerge url, for any tool", () => {
    const url = "automerge:2qMVfMqBCLg7JkLaaxr6oPmr2umh"
    for (const tool of BUILTIN_TOOLS) {
      const { detail } = show(tool.id, { url, root: url, docUrl: url })
      expect(detail, tool.id).not.toContain("PDTNBQcoJiMQPEnKFRW8hyW787z")
    }
  })

  it("survives an input that makes no sense", () => {
    for (const tool of BUILTIN_TOOLS) {
      for (const input of [{}, { ops: "not an array" }, { path: 5 }, { files: null }, { options: 3 }]) {
        expect(() => show(tool.id, input), tool.id).not.toThrow()
      }
    }
  })

  it("falls back rather than breaking for a tool it has never heard of", () => {
    const { verb, detail } = show("some_plugin_tool", { name: "thing" })
    expect(verb).toBe("some_plugin_tool")
    expect(detail).toBe("thing")
  })
})

describe("what each kind of call reads like", () => {
  it("describes an edit by the fields it changed", () => {
    expect(
      show("doc_edit", {
        ops: [
          { path: [], range: "title", value: "Soup" },
          { path: ["items"], range: [2, 2], value: "milk" },
        ],
      }).detail
    ).toBe("title, /items[2…2]")
  })

  it("counts the edits it does not have room for", () => {
    const ops = ["a", "b", "c", "d", "e"].map((k) => ({ path: [], range: k }))
    expect(describeOps(ops)).toBe("a, b, c +2 more")
    expect(describeOps([])).toBe("no changes")
  })

  it("shows the path inside a document, not the document", () => {
    expect(show("doc_read", { url: "automerge:abc123", path: ["body"] }).detail).toBe("/body")
    expect(show("doc_read", { url: "automerge:abc123", shapeOnly: true }).detail).toBe("shape")
  })

  it("names the site for a web call, not the whole url", () => {
    expect(show("web_fetch", { url: "https://docs.python.org/3/library/os.html" }).detail).toBe("docs.python.org")
    expect(show("web_search", { query: "automerge crdt" }).detail).toBe("“automerge crdt”")
  })

  it("uses the http method as the verb, and names the credential", () => {
    const { verb, detail } = show("http_request", { url: "https://api.test/v1/x", method: "post", useSecret: "github" })
    expect(verb).toBe("POST")
    expect(detail).toBe("api.test as github")
  })

  it("names files, not paths, when writing several", () => {
    expect(show("fs_write", { files: [{ path: "src/a.ts" }, { path: "src/b.ts" }, { path: "src/c.ts" }] }).detail).toBe(
      "a.ts, b.ts +1"
    )
    expect(show("fs_write", { path: "src/index.ts" }).detail).toBe("index.ts")
  })

  it("uses the action as the verb when driving a view", () => {
    const { verb, detail } = show("view_interact", { action: "click", selector: "#roll" })
    expect(verb).toBe("click")
    expect(detail).toBe("#roll")

    expect(show("view_interact", { action: "type", selector: "input", value: "hello" }).detail).toBe("input = hello")
  })

  it("shows the question for an ask", () => {
    expect(show("ask_user", { question: "Which layout?" }).detail).toBe("Which layout?")
  })

  it("truncates a detail rather than letting it push the line around", () => {
    const { detail } = show("web_search", { query: "x".repeat(200) })
    expect(detail.length).toBeLessThanOrEqual(64)
    expect(detail.endsWith("…")).toBe(true)
  })
})

describe("the note at the end of the line", () => {
  it("says what state the call is in before it has a result", () => {
    expect(describeCall(call("doc_read", {}, "running"), null).note).toBe("running…")
    expect(describeCall(call("doc_edit", {}, "pending"), null).note).toBe("needs approval")
    expect(describeCall(call("doc_edit", {}, "denied"), null).note).toBe("declined")
    expect(describeCall(call("ask_user", {}, "asking"), null).note).toBe("waiting for you")
  })

  it("prefers the tool's own summary to the first line of its output", () => {
    expect(show("doc_read", {}, { output: "{\n  x\n}", summary: "read document · 62 B" }).note).toBe(
      "read document · 62 B"
    )
  })

  it("puts the error first when a call failed", () => {
    expect(show("web_fetch", { url: "https://x.test/" }, { isError: true, output: "Error: 403 Forbidden\nmore" }).note).toBe(
      "403 Forbidden"
    )
  })
})

describe("the small pieces", () => {
  it("shortens document urls, and knows which one is the subject", () => {
    expect(shortDoc("automerge:abc123def", "automerge:abc123def")).toBe("this document")
    expect(shortDoc("automerge:abc123def", "automerge:other")).toBe("doc abc123")
    expect(shortDoc("not a url")).toBe("not a url")
  })

  it("renders paths, hosts and file names", () => {
    expect(pathLabel(["items", 0, "text"])).toBe("/items/0/text")
    expect(pathLabel([])).toBeNull()
    expect(hostOf("https://a.test/b/c")).toBe("a.test")
    expect(hostOf("nonsense")).toBe("nonsense")
    expect(baseName("src/deep/file.ts")).toBe("file.ts")
  })
})

describe("a row says what happened, not what was asked twice", () => {
  // The verb and detail already carry the question. A summary that repeats them
  // gives you `click button:last-child · click button:last-child · ok`.
  const noisy = (tool, input, output) => {
    const { verb, detail, note } = describeCall({ tool, input, status: "done" }, { output, summary: summaryOf(tool, input, output) })
    return { verb, detail, note }
  }

  function summaryOf(toolId, input, output) {
    const tool = BUILTIN_TOOLS.find((t) => t.id === toolId)
    return tool?.summarize?.(input, output) ?? null
  }

  it("does not repeat the selector in an interaction", () => {
    const row = noisy("view_interact", { action: "click", selector: "button:last-child" }, "Interacted with 'x' — document changed: {}\nRendering updated: \"1\"")
    expect(row.verb).toBe("click")
    expect(row.detail).toBe("button:last-child")
    expect(row.note).toBe("changed, screen followed")
    expect(row.note).not.toContain("button:last-child")
  })

  it("says a click did nothing, which is the thing worth knowing", () => {
    const row = noisy("view_interact", { action: "click", selector: "#go" }, "Interacted with '#go' — the document did NOT change.")
    expect(row.note).toBe("no change")
  })

  it("describes a mount by what rendered, not by its random id", () => {
    const row = noisy("view_mount", { toolId: "tally" }, "Mounted without throwing.\n12 elements, 2 button(s), 1 input(s).\n\nmountId: mount_ab12cd")
    expect(row.note).toBe("12 elements, 2 buttons")
    expect(row.note).not.toContain("mount_")
  })

  it("says plainly when a mount failed", () => {
    expect(noisy("view_mount", { toolId: "tally" }, "PROBLEM mounting threw: boom").note).toBe("could not mount")
  })
})
