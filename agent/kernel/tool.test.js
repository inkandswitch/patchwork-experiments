/**
 * How a call reads in the log is the tool's to say, and is worked out once,
 * when the call is written (presentCall).
 */

import { describe, it, expect } from "vitest"
import { presentCall, pluginTool } from "./tool.js"

describe("how a call reads in the log", () => {
  const input = { url: "automerge:abc", path: ["title"] }

  // What the tool says → what the call carries.
  it.each([
    ["nothing", undefined, null],
    ["a verb and a detail, as words", { verb: "browse", detail: "everything" }, { verb: "browse", detail: "everything" }],
    ["a verb alone", { verb: "browse" }, { verb: "browse", detail: "" }],
    ["a detail that is nothing for this input", { verb: "read", detail: () => null }, { verb: "read", detail: "" }],
    ["functions of the input", { verb: (i) => (i.path ? "read part" : "read"), detail: (i) => `/${i.path.join("/")}` }, { verb: "read part", detail: "/title" }],
    ["a detail that knows the subject", { verb: "read", detail: (i, subject) => (i.url === subject ? "this document" : "another") }, { verb: "read", detail: "this document" }],
    ["no verb", { detail: "x" }, null],
    ["a detail that fails on this input", { verb: "read", detail: (i) => i.missing.field }, null],
  ])("%s", (_name, present, shown) => {
    expect(presentCall({ id: "a_tool", present }, input, "automerge:abc")).toEqual(shown)
  })

  it("keeps a detail short", () => {
    const shown = presentCall({ id: "a_tool", present: { verb: "write", detail: "x".repeat(200) } }, {})
    expect(shown.detail).toHaveLength(64)
    expect(shown.detail.endsWith("…")).toBe(true)
  })

  it("is nothing for no tool at all, and takes an input that is missing", () => {
    expect(presentCall(null, {})).toBeNull()
    expect(presentCall({ id: "a_tool", present: { verb: "list", detail: (i) => i.path ?? "/" } }, undefined)).toEqual({ verb: "list", detail: "/" })
  })

  it("a package's tool says it from its own module, beside execute, once its code is loaded", async () => {
    const impl = { execute: () => "ok", present: { verb: "capture", detail: (i) => i.url } }
    const tool = pluginTool({ id: "web_capture" }, async () => ({ module: impl }))
    expect(presentCall(tool, { url: "https://site.test/" })).toBeNull()
    await tool.current()
    expect(presentCall(tool, { url: "https://site.test/" })).toEqual({ verb: "capture", detail: "https://site.test/" })
  })
})
