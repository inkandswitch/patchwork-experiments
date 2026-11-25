import { describe, it, expect } from "vitest"
import * as A from "@automerge/automerge"
import { isImmutable, isBytes, textOf, textForm, isLines, contentText, decodeUtf8, decodeIfText, searchText, valueAt } from "./values.js"

const imm = (text) => new A.ImmutableString(text)
const enc = (text) => new TextEncoder().encode(text)

/**
 * Every kind of value a document holds, and what each reading of it gives.
 * The columns are textOf, textForm, isLines, contentText and searchText.
 */
const CASES = [
  ["a string", "a\nb", "a\nb", { form: "string", text: "a\nb" }, false, "a\nb", "a\nb"],
  ["an ImmutableString", imm("a\nb"), "a\nb", { form: "immutable", text: "a\nb" }, false, "a\nb", "a\nb"],
  ["UTF-8 bytes", enc("hé"), null, null, false, "hé", ""],
  ["bytes that are not UTF-8", new Uint8Array([0xc3]), null, null, false, "�", ""],
  ["bytes with a NUL", enc("a\u0000b"), null, null, false, "a\u0000b", ""],
  ["a number", 3, null, null, false, "", "3"],
  ["a boolean", true, null, null, false, "", "true"],
  ["null", null, null, null, false, "", "null"],
  ["undefined", undefined, null, null, false, "", ""],
  ["a list of lines", ["a\n", "b"], null, { form: "lines", text: "a\nb" }, true, "", '["a\\n","b"]'],
  ["lines, one an ImmutableString", [imm("a\n"), "b"], null, { form: "lines", text: "a\nb" }, true, "", '["a\\n","b"]'],
  ["a list of strings that are not lines", ["x", "y"], null, { form: "lines", text: "xy" }, false, "", '["x","y"]'],
  ["a list of one string", ["a"], null, { form: "lines", text: "a" }, false, "", '["a"]'],
  ["an empty list", [], null, { form: "lines", text: "" }, false, "", "[]"],
  ["a list with a number in it", ["a", 1], null, null, false, "", '["a",1]'],
  ["a map", { a: 1 }, null, null, false, "", '{"a":1}'],
  ["a counter", new A.Counter(4), null, null, false, "", "4"],
  ["a date", new Date(0), null, null, false, "", '"1970-01-01T00:00:00.000Z"'],
]

describe("the text a value holds", () => {
  it.each(CASES)("%s", (_, value, text, form, lines, content, search) => {
    expect(textOf(value)).toEqual(text)
    expect(textForm(value)).toEqual(form)
    expect(isLines(value)).toBe(lines)
    expect(contentText(value)).toBe(content)
    expect(searchText(value)).toBe(search)
  })

  it("decodes bytes as UTF-8 only when they are, and as text only without a NUL", () => {
    expect([decodeUtf8(enc("ångström 3.2 V")), decodeIfText(enc("ångström 3.2 V"))]).toEqual(["ångström 3.2 V", "ångström 3.2 V"])
    expect([decodeUtf8(new Uint8Array([0xc3])), decodeIfText(new Uint8Array([0xc3]))]).toEqual([null, null])
    expect([decodeUtf8(enc("a\u0000b")), decodeIfText(enc("a\u0000b"))]).toEqual(["a\u0000b", null])
    expect([decodeUtf8("text"), decodeIfText("text")]).toEqual([null, null])
  })

  it("knows an ImmutableString by automerge's symbol, and bytes by any view", () => {
    expect([imm("x"), "x", { val: "x" }, null].map(isImmutable)).toEqual([true, false, false, false])
    expect([new Uint8Array(2), new DataView(new ArrayBuffer(2)), [1, 2], "ab", null].map(isBytes)).toEqual([true, true, false, false, false])
  })

  it("reads text out of a real document the same way", () => {
    const doc = A.from({ s: "a\nb", i: imm("a\nb"), l: ["a\n", "b"], c: new Uint8Array([104, 105]) })
    expect([textOf(doc.s), textOf(doc.i), textForm(doc.l), isLines(doc.l), contentText(doc.c)]).toEqual(["a\nb", "a\nb", { form: "lines", text: "a\nb" }, true, "hi"])
  })
})

describe("valueAt", () => {
  const ROOT = { list: ["x", { k: "v" }], map: { 0: "zero", n: null }, text: "abc", imm: imm("abc"), bytes: new Uint8Array([1, 2]) }

  it.each([
    ["the root, for no path", [], ROOT],
    ["a list item by index", ["list", 0], "x"],
    ["a list item by a string of digits", ["list", "1", "k"], "v"],
    ["past the end of a list", ["list", 2], undefined],
    ["a negative index", ["list", -1], undefined],
    ["a fractional index", ["list", 1.5], undefined],
    ["a list's own property", ["list", "length"], undefined],
    ["a map key given as a number", ["map", 0], "zero"],
    ["a null value", ["map", "n"], null],
    ["a step into null", ["map", "n", "x"], undefined],
    ["a map's inherited property", ["map", "toString"], undefined],
    ["a step into text", ["text", 0], undefined],
    ["a step into an ImmutableString", ["imm", "val"], undefined],
    ["a step into bytes", ["bytes", 0], undefined],
    ["a missing key", ["missing", "x"], undefined],
  ])("%s", (_, path, expected) => {
    expect(valueAt(ROOT, path)).toBe(expected)
  })

  it("walks a real document", () => {
    const doc = A.from({ cells: [{ source: ["a\n", "b"] }] })
    expect(valueAt(doc, ["cells", "0", "source", 1])).toBe("b")
    expect(valueAt(doc, ["cells", 1])).toBe(undefined)
  })
})
