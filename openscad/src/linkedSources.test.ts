import {describe, expect, it, vi} from "vitest"
import {importInput, linkedSource} from "./linkedSources"
import {resolveImports, dependencies} from "./scene/source"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import type {OpenscadDoc} from "./types"

const url = (id: string) => `automerge:${id}` as AutomergeUrl
const typed = (type: string, rest: object = {}) => ({"@patchwork": {type}, ...rest})

describe("linkedSource", () => {
	it("uses the datatype's asSource(doc, 'scad') when it returns a string", async () => {
		const asSource = vi.fn(() => "x = 1;")
		const load = vi.fn(async () => ({asSource}))
		const doc = typed("register", {rows: [1]})
		expect(await linkedSource(doc, load)).toEqual({scad: "x = 1;"})
		expect(load).toHaveBeenCalledWith("register")
		expect(asSource).toHaveBeenCalledWith(doc, "scad", {})
	})
	it("falls through when asSource returns null, or the datatype has none, or it is not found", async () => {
		const file = typed("file", {name: "a.scad", content: "y=2;"})
		expect(await linkedSource(file, async () => ({asSource: () => null}))).toEqual({scad: "y=2;", scadFile: "a.scad"})
		expect(await linkedSource(file, async () => ({getTitle: () => "t"}))).toMatchObject({scad: "y=2;"})
		expect(await linkedSource(file, async () => undefined)).toMatchObject({scad: "y=2;"})
		expect(await linkedSource(file, async () => Promise.reject(new Error("no registry")))).toMatchObject({scad: "y=2;"})
	})
	it("prefers the hook over a file doc's text", async () => {
		const file = typed("file", {name: "a.scad", content: "from text"})
		expect(await linkedSource(file, async () => ({asSource: () => "from hook"}))).toEqual({scad: "from hook"})
	})
	it("reads a text file doc; its file name only when it ends in .scad", async () => {
		expect(await linkedSource(typed("file", {name: "notes.txt", content: "z=1;"}), async () => undefined)).toEqual({scad: "z=1;"})
		expect(await linkedSource({name: "p.scad", content: "q=1;"}, async () => undefined)).toEqual({scad: "q=1;", scadFile: "p.scad"})
		expect(await linkedSource(typed("file", {name: "a.scad", content: {toString: () => "text-like"}}))).toMatchObject({scad: "text-like"})
	})
	it("explains why there is no source", async () => {
		const none = async () => undefined
		expect((await linkedSource(typed("file", {name: "a.bin", content: new Uint8Array(2)}), none)).noScad).toContain("binary")
		expect((await linkedSource(typed("datagrid", {rows: []}), none)).noScad).toMatch(/"datagrid" document has no OpenSCAD form/)
		expect((await linkedSource({rows: []}, none)).noScad).toContain("no type")
		expect((await linkedSource(undefined, none)).noScad).toContain("not available")
		const thrown = await linkedSource(typed("register"), async () => ({asSource: () => {throw new Error("boom")}}))
		expect(thrown).toEqual({noScad: expect.stringContaining("boom")})
	})
})

describe("the asking document", () => {
	const SELF = "automerge:self#abc"
	// a register that leaves out the results the asking document computes itself
	const register = {
		asSource: (_doc: unknown, _ext: string, options?: {for?: string}) =>
			options?.for?.split("#")[0] === "automerge:self" ? "width = 12;\n" : "width = 12;\nresult = 3;\n",
	}
	it("is passed to asSource as the third argument, `for`", async () => {
		const asSource = vi.fn(() => "x=1;")
		await linkedSource(typed("register"), async () => ({asSource}), SELF)
		expect(asSource).toHaveBeenCalledWith(expect.anything(), "scad", {for: SELF})
	})
	it("is passed through importInput", async () => {
		const asSource = vi.fn(() => "x=1;")
		await importInput({name: "reg"}, typed("register"), async () => ({asSource}), SELF)
		expect(asSource.mock.calls[0][2]).toEqual({for: SELF})
	})
	it("lets a register drop the asking document's own results", async () => {
		const load = async () => register
		expect((await linkedSource(typed("register"), load, SELF)).scad).toBe("width = 12;\n")
		expect((await linkedSource(typed("register"), load, "automerge:other")).scad).toContain("result = 3;")
		expect((await linkedSource(typed("register"), load)).scad).toContain("result = 3;")
	})
	it("passes an empty options object when the asker is unknown, and an old asSource still works", async () => {
		const asSource = vi.fn(() => "x=1;")
		await linkedSource(typed("register"), async () => ({asSource}))
		expect(asSource.mock.calls[0][2]).toEqual({})
		expect(await linkedSource(typed("register"), async () => ({asSource: (_d: unknown, _e: string) => "old;"}), SELF)).toEqual({scad: "old;"})
	})
	it("reaches the hook in the scene's resolveImports", async () => {
		const asSource = vi.fn(() => "x=1;")
		const doc: OpenscadDoc = {source: "", imports: [{name: "reg", docUrl: url("a")}]}
		await resolveImports(doc, {find: async () => ({doc: () => typed("register")})}, async () => ({asSource}), "automerge:self")
		expect(asSource.mock.calls[0][2]).toEqual({for: "automerge:self"})
	})
})

describe("importInput", () => {
	it("is JSON always, plus source when there is some, plus the label", async () => {
		const out = await importInput({name: "reg", label: "Register"}, typed("register", {w: 1}), async () => ({asSource: () => "a=1;"}))
		expect(out).toEqual({name: "reg", label: "Register", json: '{"w":1}', scad: "a=1;"})
	})
})

describe("the scene's resolveImports", () => {
	const doc: OpenscadDoc = {source: "include <reg.scad>", imports: [{name: "reg", docUrl: url("a")}, {name: "gone", docUrl: url("b")}]}
	const load = async () => ({asSource: () => "a=1;"})
	const find = async (u: AutomergeUrl) => {
		if (u === url("b")) throw new Error("unreachable")
		return {doc: () => typed("register", {w: 1})}
	}
	it("binds source like the editor does, and an unavailable import has none", async () => {
		const {imports, missing} = await resolveImports(doc, {find}, load)
		expect(imports[0]).toMatchObject({name: "reg", scad: "a=1;", json: '{"w":1}'})
		expect(imports[1].scad).toBeUndefined()
		expect(imports[1].noScad).toContain("not available")
		expect(missing).toEqual(["gone"])
	})
	it("lists every import as a dependency, so an edit inside an included doc rebuilds", () => {
		expect(dependencies(doc)).toEqual([url("a"), url("b")])
	})
})
