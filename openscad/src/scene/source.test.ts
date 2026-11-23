import {describe, expect, it, vi} from "vitest"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js"
import type {Mesh} from "three"
import {parseGLB} from "./glb.js"
import {zUpToYUpMeters} from "./axes"
import {createOpenscadSource, dependencies, fingerprint, modelToGLB, type PartSource} from "./source"
import type {SourceMap} from "../render/sourceMap"
import {importInput} from "../linkedSources"
import {createRenderCache} from "../render/engine"
import type {Model, RGBA} from "../render/model"
import type {OpenscadDoc} from "../types"
import type {AutomergeUrl} from "@automerge/automerge-repo"

/** The triangles of an axis-aligned box from `at` to `at` + size, 12 of them (OpenSCAD `cube(size)`). */
function boxPositions([sx, sy, sz]: [number, number, number], at = [0, 0, 0]): Float32Array {
	const v = (x: number, y: number, z: number) => [at[0] + x * sx, at[1] + y * sy, at[2] + z * sz]
	// quads as corner lists, counter-clockwise seen from outside
	const quads = [
		[v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], // -z
		[v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], // +z
		[v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // -y
		[v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)], // +y
		[v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], // -x
		[v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // +x
	]
	return Float32Array.from(quads.flatMap(([a, b, c, d]) => [a, b, c, a, c, d]).flat())
}

/** An uncoloured box, as the engine hands it over. */
function boxModel(size: [number, number, number], color: RGBA | null = null): Model {
	return {parts: [{color, positions: boxPositions(size)}], triangles: 12}
}

const emptyModel = (): Model => ({parts: [], triangles: 0})
const rendered = (model: Model, elapsedMillis = 1) => ({model, logs: [], elapsedMillis})

function load(bytes: Uint8Array): Promise<any> {
	const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	return new Promise((resolve, reject) => new GLTFLoader().parse(buf as ArrayBuffer, "", resolve, reject))
}

const url = (id: string) => `automerge:${id}` as AutomergeUrl

describe("axes", () => {
	it("turns Z-up millimetres into Y-up metres: (x, y, z) -> (x, z, -y)", () => {
		const out = zUpToYUpMeters(new Float32Array([10, 20, 30]), "mm")
		expect(out[0]).toBeCloseTo(0.01)
		expect(out[1]).toBeCloseTo(0.03)
		expect(out[2]).toBeCloseTo(-0.02)
		expect(zUpToYUpMeters(new Float32Array([1, 0, 0]), "in")[0]).toBeCloseTo(0.0254)
	})
})

describe("modelToGLB", () => {
	it("makes a GLB that three loads, Y-up metres, with normals pointing outward", async () => {
		const {glb, meta, triangles} = modelToGLB(boxModel([30, 10, 15]), "mm", "box")
		expect(triangles).toBe(12)
		// width (x) 30 mm, height (y, was z) 15 mm, depth (z, was -y) 10 mm
		expect(meta?.bounds?.min.map(n => +n.toFixed(4))).toEqual([0, 0, -0.01])
		expect(meta?.bounds?.max.map(n => +n.toFixed(4))).toEqual([0.03, 0.015, 0])

		const {json} = parseGLB(glb)
		expect(json.asset.version).toBe("2.0")
		expect(json.meshes[0].name).toBe("box")
		// uncoloured: no material, so the viewer's default applies
		expect(json.materials).toBeUndefined()

		const gltf = await load(glb)
		const mesh = gltf.scene.getObjectByName("box") as Mesh
		expect(mesh).toBeTruthy()
		const geo = mesh.geometry
		expect(geo.getAttribute("position").count).toBe(36)
		const normals = geo.getAttribute("normal")
		expect(normals.count).toBe(36)
		// every normal points away from the box centre (winding preserved by the axis turn)
		const pos = geo.getAttribute("position")
		const centre = [0.015, 0.0075, -0.005]
		for (let i = 0; i < pos.count; i++) {
			const out = [pos.getX(i) - centre[0], pos.getY(i) - centre[1], pos.getZ(i) - centre[2]]
			const dot = out[0] * normals.getX(i) + out[1] * normals.getY(i) + out[2] * normals.getZ(i)
			expect(dot).toBeGreaterThan(0)
		}
	})

	it("makes a primitive per colour, with a material each; alpha < 1 blends", () => {
		const model: Model = {
			triangles: 24,
			parts: [
				{color: [1, 0, 0, 1], positions: boxPositions([10, 10, 10])},
				{color: [0, 0, 1, 0.5], positions: boxPositions([10, 10, 10], [20, 0, 0])},
			],
		}
		const {glb, meta} = modelToGLB(model)
		const {json} = parseGLB(glb)
		const prims = json.meshes[0].primitives
		expect(prims).toHaveLength(2)
		const [red, blue] = prims.map((p: any) => json.materials[p.material])
		expect(red.pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 1])
		expect(red.alphaMode).toBeUndefined()
		expect(blue.pbrMetallicRoughness.baseColorFactor.slice(0, 3)).toEqual([0, 0, 1])
		expect(blue.pbrMetallicRoughness.baseColorFactor[3]).toBeCloseTo(0.5, 2)
		expect(blue.alphaMode).toBe("BLEND")
		// bounds cover every part
		expect(meta?.bounds?.max[0]).toBeCloseTo(0.03)
	})

	it("encodes an empty model as a valid, empty GLB", async () => {
		const {glb, triangles} = modelToGLB(emptyModel())
		expect(triangles).toBe(0)
		const gltf = await load(glb)
		expect(gltf.scene).toBeTruthy()
	})
})

describe("fingerprint", () => {
	const base: OpenscadDoc = {title: "A", source: "cube(10);", imports: []}

	it("ignores the title", () => {
		expect(fingerprint({...base, title: "B"})).toBe(fingerprint(base))
	})

	it("changes with the source and with the import bindings", () => {
		const fp = fingerprint(base)
		expect(fingerprint({...base, source: "cube(11);"})).not.toBe(fp)
		const withImport = {...base, imports: [{name: "data", docUrl: url("a")}]}
		expect(fingerprint(withImport)).not.toBe(fp)
		expect(fingerprint({...base, imports: [{name: "data", docUrl: url("b")}]})).not.toBe(fingerprint(withImport))
		expect(fingerprint({...base, imports: [{name: "other", docUrl: url("a")}]})).not.toBe(fingerprint(withImport))
		// labels are display-only
		expect(fingerprint({...base, imports: [{name: "data", docUrl: url("a"), label: "x"}]})).toBe(fingerprint(withImport))
	})

	it("tolerates a doc without source", () => {
		expect(typeof fingerprint({} as OpenscadDoc)).toBe("string")
	})
})

describe("dependencies", () => {
	it("lists each imported doc once", () => {
		const doc: OpenscadDoc = {
			source: "",
			imports: [
				{name: "a", docUrl: url("a")},
				{name: "b", docUrl: url("b")},
				{name: "a2", docUrl: url("a")},
			],
		}
		expect(dependencies(doc)).toEqual([url("a"), url("b")])
		expect(dependencies({} as OpenscadDoc)).toEqual([])
		expect(dependencies(undefined)).toEqual([])
	})

	it("skips bindings without a doc url", () => {
		const doc = {source: "", imports: [{name: "a", docUrl: ""}, {name: "b"}, {name: "c", docUrl: url("c")}]} as unknown as OpenscadDoc
		expect(dependencies(doc)).toEqual([url("c")])
	})

	it("build() asks each import's datatype for source on behalf of the doc's own url", async () => {
		const asSource = vi.fn((..._args: unknown[]) => "x=1;")
		const render = vi.fn(async (_s: string, _i?: unknown[]) => rendered(emptyModel()))
		const impl = createOpenscadSource(async () => render, async () => ({asSource}))
		const find = async (_u: AutomergeUrl) => ({doc: () => ({"@patchwork": {type: "register"}})})
		await impl.build({doc: {source: "", imports: [{name: "reg", docUrl: url("a")}]}, repo: {find}, url: "automerge:self"})
		expect(asSource.mock.calls[0]).toEqual([expect.anything(), "scad", {for: "automerge:self"}])
		// falls back to the handle's url
		await impl.build({doc: {source: "", imports: [{name: "reg", docUrl: url("a")}]}, repo: {find}, handle: {url: "automerge:viaHandle"}})
		expect(asSource.mock.calls[1][2]).toEqual({for: "automerge:viaHandle"})
		expect(render.mock.calls[0][1]).toMatchObject([{name: "reg", scad: "x=1;"}])
	})

	it("lists exactly the docs build() fetches", async () => {
		const render = vi.fn(async () => rendered(emptyModel()))
		const impl = createOpenscadSource(async () => render)
		const find = vi.fn(async (_u: AutomergeUrl) => ({doc: () => ({link: url("nested")})}))
		const doc: OpenscadDoc = {
			source: "",
			imports: [
				{name: "a", docUrl: url("a")},
				{name: "b", docUrl: url("b")},
			],
		}
		await impl.build({doc, repo: {find}})
		// not transitive: a url inside an imported doc is data, not fetched
		expect(new Set(find.mock.calls.map(c => c[0]))).toEqual(new Set(impl.dependencies(doc)))
	})

	it("is on the SourceImpl, alongside a fingerprint that ignores import contents", () => {
		const impl = createOpenscadSource(async () => async () => rendered(emptyModel(), 0))
		expect(impl.dependencies).toBe(dependencies)
		const doc: OpenscadDoc = {source: "cube(data.w);", imports: [{name: "data", docUrl: url("a")}]}
		// the fingerprint is a pure function of this doc; the host tracks url("a")'s heads itself
		expect(impl.fingerprint(doc)).toBe(fingerprint(structuredClone(doc)))
	})
})

describe("the SourceImpl", () => {
	function setup(model = boxModel([20, 20, 20])) {
		const render = vi.fn(async (_source: string, _imports?: {name: string; json: string}[]) => ({
			...rendered(model, 1200),
			logs: ["WARNING: something"],
		}))
		const impl = createOpenscadSource(async () => render)
		return {render, impl}
	}

	it("builds from the doc source and resolves imports through the repo", async () => {
		const {render, impl} = setup()
		const repo = {
			find: vi.fn(async (u: AutomergeUrl) => {
				if (u === url("gone")) throw new Error("unavailable")
				return {doc: () => ({"@patchwork": {type: "x"}, width: 3})}
			}),
		}
		const doc: OpenscadDoc = {
			title: "Part",
			source: "cube(data.width);",
			imports: [
				{name: "data", docUrl: url("a")},
				{name: "lost", docUrl: url("gone")},
			],
		}
		const result = await impl.build({doc, params: {unit: "mm"}, repo})
		expect(render).toHaveBeenCalledTimes(1)
		expect(render.mock.calls[0][0]).toBe("cube(data.width);")
		expect(render.mock.calls[0][1]).toMatchObject([
			{name: "data", json: '{"width":3}'},
			{name: "lost", json: "{}"},
		])
		expect(result.kind).toBe("glb")
		expect(result.meta?.notes).toContain("12 triangles")
		expect(result.meta?.notes).toContain("1 warning")
		expect(result.meta?.notes).toContain("unavailable: lost")
		expect(result.meta?.bounds?.max.map(n => +n.toFixed(4))).toEqual([0.02, 0.02, 0])
	})

	it("does not read the title: the mesh name is fixed", async () => {
		const {impl} = setup()
		const a = await impl.build({doc: {title: "Box", source: "cube(20);"}})
		const b = await impl.build({doc: {title: "Lid", source: "cube(20);"}})
		expect(parseGLB(a.glb).json.meshes[0].name).toBe("OpenSCAD")
		expect(b.glb).toEqual(a.glb)
	})

	it("keeps no cache of its own: every build asks the renderer", async () => {
		const {render, impl} = setup()
		const doc: OpenscadDoc = {source: "cube(20);"}
		await impl.build({doc, params: {unit: "mm"}})
		await impl.build({doc, params: {unit: "cm"}})
		expect(render).toHaveBeenCalledTimes(2)
	})

	it("through the engine's shared cache, re-encodes a unit change without running OpenSCAD again", async () => {
		const {render} = setup()
		const shared = createRenderCache(render)
		const impl = createOpenscadSource(async () => shared)
		const doc: OpenscadDoc = {source: "cube(20);"}
		const mm = await impl.build({doc, params: {unit: "mm"}})
		expect(mm.meta?.notes).toContain("rendered in 1.2 s")
		const cm = await impl.build({doc, params: {unit: "cm"}})
		expect(render).toHaveBeenCalledTimes(1)
		expect(cm.meta?.bounds?.max[0]).toBeCloseTo(0.2)
		expect(cm.meta?.notes).not.toContain("rendered in")
		await impl.build({doc: {source: "cube(21);"}, params: {unit: "cm"}})
		expect(render).toHaveBeenCalledTimes(2)
	})

	it("reuses a render the editor already did, and joins one it is still doing", async () => {
		const {render} = setup()
		const shared = createRenderCache(render)
		const impl = createOpenscadSource(async () => shared)
		const repo = {find: async () => ({doc: () => ({w: 3})})}
		const doc: OpenscadDoc = {source: "cube(data.w);", imports: [{name: "data", docUrl: url("a")}]}
		// the editor builds its import inputs the same way (importInput)
		const editor = importInput({name: "data"}, {w: 3}).then(input => shared("cube(data.w);", [input]))
		const [, built] = await Promise.all([editor, impl.build({doc, repo})])
		expect(render).toHaveBeenCalledTimes(1)
		expect(built.kind).toBe("glb")
		await impl.build({doc, repo, params: {unit: "in"}})
		expect(render).toHaveBeenCalledTimes(1)
	})

	it("falls back to millimetres for an unknown unit", async () => {
		const {impl} = setup()
		const result = await impl.build({doc: {source: "cube(20);"}, params: {unit: "parsec" as any}})
		expect(result.meta?.bounds?.max[0]).toBeCloseTo(0.02)
	})

	it("lets engine errors through so the scene records them", async () => {
		const impl = createOpenscadSource(async () => async () => {
			throw new Error("Parser error in line 1")
		})
		await expect(impl.build({doc: {source: "cube("}})).rejects.toThrow("Parser error")
	})
})

describe("cleanError", () => {
	it("drops the engine's localization banner", async () => {
		const {cleanError} = await import("./source")
		const e = cleanError(new Error("Could not initialize localization (application path is '/').\nERROR: Parser error: syntax error in file /input.scad, line 33\nCan't parse file '/input.scad'!\n"))
		expect(e.message).toBe("ERROR: Parser error: syntax error in file /input.scad, line 33\nCan't parse file '/input.scad'!")
	})
})

describe("a node per part", () => {
	// two colours; three triangles: a cell's (red), a cell's (blue), and one no part claims (red)
	const tri = (z: number) => [0, 0, z, 1, 0, z, 0, 1, z]
	const model: Model = {
		parts: [
			{color: [1, 0, 0, 1], positions: Float32Array.from([...tri(0), ...tri(1)])},
			{color: [0, 0, 1, 1], positions: Float32Array.from(tri(2))},
		],
		triangles: 3,
	}
	const map: SourceMap = {
		sites: [
			{id: 1, file: "", name: "cell", kind: "call", from: 30, to: 36, line: 3, col: 0},
			{id: 2, file: "", name: "cube", kind: "shape", from: 14, to: 21, line: 1, col: 14},
		],
		modules: [{name: "cell", file: "", from: 7, to: 11, line: 1, col: 7}],
		records: [{path: [1, 2]}],
		faces: [Int32Array.from([0, -1]), Int32Array.from([0])],
		unmapped: 1,
	}
	it("names each part's node by its label and says its source", () => {
		const {json} = parseGLB(modelToGLB(model, "mm", "OpenSCAD", map).glb)
		expect(json.nodes.map((n: {name: string}) => n.name)).toEqual(["OpenSCAD", "cell"])
		const cell = json.nodes.find((n: {name: string}) => n.name === "cell")
		expect(cell.extras.source as PartSource).toEqual({label: "cell", chain: ["cell:3", "cube:1"], at: {line: 1, col: 14, from: 14, to: 21}})
		// the cell keeps both its colours, a primitive each
		expect(json.meshes[cell.mesh].primitives).toHaveLength(2)
	})
	it("is a single mesh without a map, as before", () => {
		const {json} = parseGLB(modelToGLB(model, "mm").glb)
		expect(json.meshes).toHaveLength(1)
	})
})
