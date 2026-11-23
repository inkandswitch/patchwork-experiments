import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {buildSourceMap, chainOf, definitionOf, echoedPaths, labelAll, labelOf, labelSource, pathId, scan, tokenize, type SourceMap} from "./sourceMap"
import {parseOFF, type Model} from "./model"
import {openscadArgs} from "./args"
import {ENGINE_DIR} from "./engineFiles"

describe("tokenize", () => {
	it("drops comments, keeps strings whole, and reads include paths as one token", () => {
		const toks = tokenize('include <lib/a.scad> // cube(1)\n/* sphere(2) */ x = "cube(3)";')
		expect(toks.map(t => t.v)).toEqual(["include", "<lib/a.scad>", "x", "=", '"cube(3)"', ";"])
	})
	it("never throws on unterminated input", () => {
		expect(() => tokenize('cube(1); /* open')).not.toThrow()
		expect(() => tokenize('x = "open')).not.toThrow()
	})
})

describe("scan", () => {
	it("finds shapes and calls where a statement can be, with lines and columns", () => {
		const s = scan("module cell() {\n  cube(1);\n}\ntranslate([1, 0, 0]) cell();\n")
		expect(s.modules).toMatchObject([{name: "cell", line: 1, col: 7}])
		expect(s.sites).toMatchObject([
			{name: "cube", kind: "shape", line: 2, col: 2},
			{name: "cell", kind: "call", line: 4, col: 21},
		])
	})
	it("skips function calls in expressions, function definitions and control statements", () => {
		const s = scan(
			'data = import("x.json");\nfunction f(a) = cube(a);\nfor (i = [0 : 2]) if (i > 0) let(k = g(i)) sphere(i);\necho(h(1));\nr = let(a = 1) q(a);\n',
		)
		expect(s.sites.map(x => x.name)).toEqual(["sphere"])
	})
	it("does count a mesh import() as a statement", () => {
		expect(scan('import("part.stl");').sites).toMatchObject([{name: "import", kind: "shape"}])
	})
	it("leaves transforms and 2D shapes unlabelled, and finds color() calls", () => {
		const s = scan('color("red", 0.5) translate([1, 2, 3]) linear_extrude(2) circle(1);')
		expect(s.sites.map(x => x.name)).toEqual(["linear_extrude"])
		expect(s.colors).toHaveLength(1)
	})
	it("finds calls behind modifiers and after else", () => {
		const s = scan("if (a) #cube(1); else %sphere(1);")
		expect(s.sites.map(x => x.name)).toEqual(["cube", "sphere"])
	})
	it("spans a call from its name to its closing parenthesis", () => {
		const src = "  part(size = f(2), [1, 2]);"
		const [site] = scan(src).sites
		expect(src.slice(site.from, site.to)).toBe("part(size = f(2), [1, 2])")
	})
})

describe("labelSource", () => {
	const src = '// top\nmodule cell() color("royalblue") cube(1);\nfor (i = [0 : 1]) translate([i * 2, 0, 0]) cell();\n'
	it("moves nothing to another line", () => {
		const out = labelSource(src)
		expect(out.text.split("\n").length).toBe(src.split("\n").length)
		expect(out.text.split("\n").slice(1)[0]).toContain("module cell()")
	})
	it("removes the colours and labels the shapes and calls", () => {
		const out = labelSource(src)
		expect(out.text).not.toContain('color("royalblue")')
		expect(out.text).toContain("let() let($_sm = ")
		expect(out.sites.map(s => [s.id, s.name])).toEqual([
			[1, "cube"],
			[2, "cell"],
		])
	})
	it("numbers a library's sites after the document's", () => {
		const all = labelAll("use <lib.scad>\npart();", [{path: "lib.scad", text: "module part() cube(1);"}])
		expect(all.source.sites.map(s => s.id)).toEqual([1])
		expect(all.files[0].sites).toMatchObject([{id: 2, name: "cube", file: "lib.scad"}])
	})
})

describe("echoedPaths", () => {
	it("reads each distinct path once", () => {
		expect(echoedPaths(['ECHO: "SM|[3, 1]"', 'ECHO: "SM|[3, 1]"', "ECHO: x = 1", 'ECHO: "SM|[2]"'])).toEqual([[3, 1], [2]])
	})
})

// The real engine, as the worker runs it: the model as written, then the labelled copy.
async function engine() {
	const dir = new URL(`../../vendor/${ENGINE_DIR}/`, import.meta.url)
	const mod = await import(/* @vite-ignore */ new URL("openscad.js", dir).href)
	const wasm = await WebAssembly.compile(readFileSync(new URL("openscad.wasm", dir)))
	return async (files: Record<string, string>): Promise<{model: Model; logs: string[]}> => {
		const logs: string[] = []
		const e = await mod.default({
			noInitialRun: true,
			print: (t: string) => logs.push(t),
			printErr: (t: string) => logs.push(t),
			instantiateWasm(i: WebAssembly.Imports, done: (a: WebAssembly.Instance, b: WebAssembly.Module) => void) {
				WebAssembly.instantiate(wasm, i).then(r => done(r, wasm))
				return {}
			},
		})
		for (const [path, text] of Object.entries(files)) e.FS.writeFile(`/${path}`, text)
		e.callMain(openscadArgs({input: "/input.scad", output: "/m.off"}))
		return {model: parseOFF(e.FS.readFile("/m.off", {encoding: "utf8"})), logs}
	}
}

async function mapped(source: string, libs: Record<string, string> = {}): Promise<{real: Model; map: SourceMap}> {
	const run = await engine()
	const real = await run({"input.scad": source, ...libs})
	const all = labelAll(source, Object.entries(libs).map(([path, text]) => ({path, text})))
	const labelled = await run({"input.scad": all.source.text, ...Object.fromEntries(all.files.map(f => [f.path, f.text]))})
	return {real: real.model, map: buildSourceMap(real.model.parts.map(p => p.positions), labelled.model, labelled.logs, [all.source, ...all.files])}
}

/** For each record: its label, its chain as name@line, and how many triangles it claims. */
function summary(map: SourceMap) {
	const counts = new Map<number, number>()
	for (const ids of map.faces) for (const r of ids) counts.set(r, (counts.get(r) ?? 0) + 1)
	return map.records.map((_, r) => ({
		label: labelOf(map, r),
		chain: chainOf(map, r).map(s => `${s.name}@${s.line}`).join(" > "),
		triangles: counts.get(r) ?? 0,
	}))
}

describe("in the engine", () => {
	it("gives the engine's ids for a path, so faces resolve to records", async () => {
		const {map} = await mapped("cube(1);")
		expect(map.records).toEqual([{path: [1]}])
		expect(pathId([1])).toBeGreaterThan(0)
		expect(map.unmapped).toBe(0)
		expect([...map.faces[0]].every(r => r === 0)).toBe(true)
	})

	it("names every face of a small pack: cells, barriers, a lidded translucent shell, in a loop of modules", async () => {
		const pack = [
			"module cell() color(\"royalblue\") cube([10, 20, 30]);",
			"module barrier() color(\"darkorange\") cube([1, 20, 30]);",
			"module shell() {",
			"  color(\"dimgray\", 0.35) difference() { cube([40, 30, 40]); translate([2, 2, 2]) cube([36, 26, 40]); }",
			"  color(\"gray\", 0.25) translate([0, 0, 38]) cube([40, 30, 2]);",
			"}",
			"module block() {",
			"  for (i = [0 : 2]) translate([4 + i * 11, 5, 4]) { cell(); if (i < 2) translate([10, 0, 0]) barrier(); }",
			"  shell();",
			"}",
			"for (k = [0 : 1]) translate([k * 50, 0, 0]) block();",
		].join("\n")
		const {real, map} = await mapped(pack)
		expect(map.unmapped).toBe(0)
		expect(map.faces.map(f => f.length)).toEqual(real.parts.map(p => p.positions.length / 9))
		const rows = summary(map)
		expect(rows.map(r => r.label).sort()).toEqual(["barrier", "cell", "shell", "shell", "shell"])
		expect(rows.find(r => r.label === "cell")?.chain).toBe("block@11 > cell@8 > cube@1")
		// the cut faces inside the shell are the cutter's
		expect(rows.map(r => r.chain)).toContain("block@11 > shell@9 > cube@4")
		expect(definitionOf(map, "cell")).toMatchObject({line: 1})
		expect(rows.every(r => r.triangles > 0)).toBe(true)
	})

	it("follows children() and a library's modules", async () => {
		const {map} = await mapped("use <lib.scad>\nmodule around() translate([5, 0, 0]) children();\naround() part();\n", {
			"lib.scad": "module part() sphere(2, $fn = 8);\n",
		})
		expect(map.unmapped).toBe(0)
		expect(summary(map).map(r => r.chain)).toEqual(["around@3 > part@3 > sphere@1"])
		expect(chainOf(map, 0).at(-1)).toMatchObject({file: "lib.scad"})
	})

	it("labels hull() as one shape", async () => {
		const {map} = await mapped("hull() { cube(1); translate([3, 0, 0]) sphere(1, $fn = 8); }")
		expect(map.unmapped).toBe(0)
		expect(summary(map).filter(r => r.triangles > 0).map(r => r.chain)).toEqual(["hull@1"])
	})
})
