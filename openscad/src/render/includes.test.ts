import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {createRenderCache, renderKey, type RenderImportInput} from "./engine"
import {explainMissingIncludes, importFor, missingIncludes, sourceFiles, withBindings} from "./includes"
import {openscadArgs} from "./args"
import {ENGINE_DIR} from "./engineFiles"

const imp = (o: Partial<RenderImportInput> & {name: string}): RenderImportInput => ({json: "{}", ...o})

describe("sourceFiles", () => {
	it("writes a source import at /<name>.scad, and a file doc under its file name too", () => {
		expect(sourceFiles([imp({name: "register", scad: "a=1;"}), imp({name: "lib", scad: "b=2;", scadFile: "parts.scad"})])).toEqual([
			{path: "parts.scad", text: "b=2;"},
			{path: "register.scad", text: "a=1;"},
			{path: "lib.scad", text: "b=2;"},
		])
	})
	it("skips imports with no source, and keeps an empty source", () => {
		expect(sourceFiles([imp({name: "d", noScad: "no"}), imp({name: "e", scad: ""})])).toEqual([{path: "e.scad", text: ""}])
	})
	it("lets a name win over another import's file name", () => {
		expect(sourceFiles([imp({name: "a", scad: "1", scadFile: "b.scad"}), imp({name: "b", scad: "2"})]).find(f => f.path === "b.scad")?.text).toBe("2")
	})
})

describe("withBindings", () => {
	it("joins the bindings onto the first line, so no line moves", () => {
		const out = withBindings("// top\ncube(1);\n", [imp({name: "a"}), imp({name: "b"})])
		expect(out).toBe('a = import("imports/a.json"); b = import("imports/b.json"); // top\ncube(1);\n')
		expect(out.split("\n").length).toBe(3)
	})
	it("leaves a source with no imports alone", () => expect(withBindings("x", [])).toBe("x"))
})

describe("missing includes", () => {
	const logs = [
		"WARNING: Can't find include file 'assumptions.scad'. in file /input.scad, line 1",
		"WARNING: Can't open library 'lib/parts.scad'. in file /input.scad, line 2",
		"WARNING: Can't find include file 'assumptions.scad'. in file /input.scad, line 5",
	]
	it("reads include and use warnings", () => {
		expect(missingIncludes(logs)).toEqual([
			{kind: "include", path: "assumptions.scad"},
			{kind: "use", path: "lib/parts.scad"},
			{kind: "include", path: "assumptions.scad"},
		])
		expect(missingIncludes(["WARNING: something else"])).toEqual([])
	})
	it("matches an import by name or by file name, ignoring directories", () => {
		const a = imp({name: "assumptions"})
		const b = imp({name: "other", scadFile: "parts.scad"})
		expect(importFor("assumptions.scad", [a, b])).toBe(a)
		expect(importFor("lib/parts.scad", [a, b])).toBe(b)
		expect(importFor("nope.scad", [a, b])).toBeUndefined()
	})
	it("tells how to attach an unattached include, for people and for agents", () => {
		const msg = explainMissingIncludes(logs.slice(0, 1), [])!
		expect(msg).toContain("include <assumptions.scad> matches no attached document")
		expect(msg).toContain("drag the document onto the Imports bar")
		expect(msg).toContain("doc_edit")
		expect(msg).toContain('name: "assumptions"')
	})
	it("names the import and the reason when it is attached but has no source", () => {
		const msg = explainMissingIncludes(logs.slice(0, 1), [imp({name: "assumptions", label: "Assumptions", noScad: "a \"x\" document has no OpenSCAD form"})])!
		expect(msg).toContain('attached as "Assumptions" but has no OpenSCAD source')
		expect(msg).toContain("no OpenSCAD form")
	})
	it("is null when nothing is missing, and reports each include once", () => {
		expect(explainMissingIncludes(["fine"], [])).toBeNull()
		expect(explainMissingIncludes(logs, [])!.split("\n")).toHaveLength(2)
	})
})

describe("cache key", () => {
	const base = [imp({name: "reg", scad: "a=1;"})]
	it("changes when an included source, its file name or its reason changes", () => {
		const k = renderKey("include <reg.scad>", base)
		expect(renderKey("include <reg.scad>", [imp({name: "reg", scad: "a=2;"})])).not.toBe(k)
		expect(renderKey("include <reg.scad>", [imp({name: "reg", scad: "a=1;", scadFile: "r.scad"})])).not.toBe(k)
		expect(renderKey("include <reg.scad>", [imp({name: "reg", noScad: "why"})])).not.toBe(k)
		expect(renderKey("include <reg.scad>", structuredClone(base))).toBe(k)
	})
	it("makes the cache render again after an included doc changes", async () => {
		let runs = 0
		const cached = createRenderCache(async () => (runs++, {model: {parts: [], triangles: 0}, logs: [], elapsedMillis: 1}))
		await cached("s", base)
		await cached("s", structuredClone(base))
		expect(runs).toBe(1)
		await cached("s", [imp({name: "reg", scad: "a=2;"})])
		expect(runs).toBe(2)
	})
})

// The real engine: what the worker does with these helpers.
describe("in the engine", () => {
	async function run(source: string, imports: RenderImportInput[]) {
		const dir = new URL(`../../vendor/${ENGINE_DIR}/`, import.meta.url)
		const mod = await import(/* @vite-ignore */ new URL("openscad.js", dir).href)
		const wasm = await WebAssembly.compile(readFileSync(new URL("openscad.wasm", dir)))
		const logs: string[] = []
		const engine = await mod.default({
			noInitialRun: true,
			print: (t: string) => logs.push(t),
			printErr: (t: string) => logs.push(t),
			instantiateWasm(i: WebAssembly.Imports, done: (a: WebAssembly.Instance, b: WebAssembly.Module) => void) {
				WebAssembly.instantiate(wasm, i).then(r => done(r, wasm))
				return {}
			},
		})
		engine.FS.mkdir("/imports")
		for (const i of imports) engine.FS.writeFile(`/imports/${i.name}.json`, i.json)
		for (const f of sourceFiles(imports)) engine.FS.writeFile(`/${f.path}`, f.text)
		engine.FS.writeFile("/input.scad", withBindings(source, imports))
		engine.callMain(openscadArgs({input: "/input.scad", output: "/m.off"}))
		return logs
	}
	const register = imp({name: "register", json: '{"w":7}', scad: "width = 12;\nmodule m() cube(width);\n"})

	it("include brings in variables, use brings in modules, and the JSON binding stays", async () => {
		const inc = await run("include <register.scad>\ncube(width);\necho(j = register.w);", [register])
		expect(inc.join("\n")).toContain('ECHO: j = 7')
		expect(missingIncludes(inc)).toEqual([])
		expect(inc.join("\n")).not.toContain("Ignoring unknown variable")
		const use = await run("use <register.scad>\nm();", [register])
		expect(missingIncludes(use)).toEqual([])
		expect(use.join("\n")).toContain("Facets:         6")
	})
	it("finds a file doc by its file name", async () => {
		const logs = await run("include <parts.scad>\ncube(width);", [imp({name: "doc", scad: "width=3;", scadFile: "parts.scad"})])
		expect(missingIncludes(logs)).toEqual([])
	})
	it("reports an unattached include", async () => {
		const logs = await run("include <nope.scad>\ncube(1);", [register])
		expect(explainMissingIncludes(logs, [register])).toContain("include <nope.scad> matches no attached document")
	})
	it("keeps line numbers exact with imports attached", async () => {
		const logs = await run("// one\n// two\ncube(undefinedName);", [register])
		expect(logs.join("\n")).toMatch(/Ignoring unknown variable "undefinedName" in file \/input\.scad, line 3/)
	})
})
