import {describe, expect, it, vi} from "vitest"
import {GLTFLoader} from "three/examples/jsm/loaders/GLTFLoader.js"
import type {Mesh} from "three"
import {parseGLB} from "./glb.js"
import {parseSTL, zUpToYUpMeters} from "./stl"
import {createOpenscadSource, dependencies, fingerprint, stlToGLB} from "./source"
import {createRenderCache} from "../render/engine"
import type {OpenscadDoc} from "../types"
import type {AutomergeUrl} from "@automerge/automerge-repo"

/** A binary STL of an axis-aligned box from [0,0,0] to size, 12 triangles (OpenSCAD `cube(size)`). */
function boxSTL([sx, sy, sz]: [number, number, number]): Uint8Array {
	const v = (x: number, y: number, z: number) => [x * sx, y * sy, z * sz]
	// quads as corner lists, counter-clockwise seen from outside
	const quads = [
		[v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], // -z
		[v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)], // +z
		[v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], // -y
		[v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)], // +y
		[v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], // -x
		[v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)], // +x
	]
	const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
	const bytes = new Uint8Array(84 + tris.length * 50)
	const dv = new DataView(bytes.buffer)
	dv.setUint32(80, tris.length, true)
	tris.forEach((tri, t) => {
		tri.flat().forEach((value, k) => dv.setFloat32(84 + t * 50 + 12 + k * 4, value, true))
	})
	return bytes
}

function load(bytes: Uint8Array): Promise<any> {
	const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
	return new Promise((resolve, reject) => new GLTFLoader().parse(buf as ArrayBuffer, "", resolve, reject))
}

const url = (id: string) => `automerge:${id}` as AutomergeUrl

describe("STL parsing and axes", () => {
	it("reads binary STL", () => {
		const stl = parseSTL(boxSTL([30, 10, 15]))
		expect(stl.format).toBe("binary")
		expect(stl.triangles).toBe(12)
	})

	it("reads ASCII STL", () => {
		const text = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`
		const stl = parseSTL(new TextEncoder().encode(text))
		expect(stl.format).toBe("ascii")
		expect(Array.from(stl.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
	})

	it("turns Z-up millimetres into Y-up metres: (x, y, z) -> (x, z, -y)", () => {
		const out = zUpToYUpMeters(new Float32Array([10, 20, 30]), "mm")
		expect(out[0]).toBeCloseTo(0.01)
		expect(out[1]).toBeCloseTo(0.03)
		expect(out[2]).toBeCloseTo(-0.02)
		expect(zUpToYUpMeters(new Float32Array([1, 0, 0]), "in")[0]).toBeCloseTo(0.0254)
	})
})

describe("stlToGLB", () => {
	it("makes a GLB that three loads, Y-up metres, with normals pointing outward", async () => {
		const {glb, meta, triangles} = stlToGLB(boxSTL([30, 10, 15]), "mm", "box")
		expect(triangles).toBe(12)
		// width (x) 30 mm, height (y, was z) 15 mm, depth (z, was -y) 10 mm
		expect(meta?.bounds?.min.map(n => +n.toFixed(4))).toEqual([0, 0, -0.01])
		expect(meta?.bounds?.max.map(n => +n.toFixed(4))).toEqual([0.03, 0.015, 0])

		const {json} = parseGLB(glb)
		expect(json.asset.version).toBe("2.0")
		expect(json.meshes[0].name).toBe("box")

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

	it("encodes an empty STL as a valid, empty GLB", async () => {
		const empty = new Uint8Array(84)
		const {glb, triangles} = stlToGLB(empty)
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

	it("lists exactly the docs build() fetches", async () => {
		const render = vi.fn(async () => ({stl: new Uint8Array(84), logs: [], elapsedMillis: 1}))
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
		const impl = createOpenscadSource(async () => async () => ({stl: new Uint8Array(84), logs: [], elapsedMillis: 0}))
		expect(impl.dependencies).toBe(dependencies)
		const doc: OpenscadDoc = {source: "cube(data.w);", imports: [{name: "data", docUrl: url("a")}]}
		// the fingerprint is a pure function of this doc; the host tracks url("a")'s heads itself
		expect(impl.fingerprint(doc)).toBe(fingerprint(structuredClone(doc)))
	})
})

describe("the SourceImpl", () => {
	function setup(stl = boxSTL([20, 20, 20])) {
		const render = vi.fn(async (_source: string, _imports?: {name: string; json: string}[]) => ({
			stl,
			logs: ["WARNING: something"],
			elapsedMillis: 1200,
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
		expect(render.mock.calls[0][1]).toEqual([
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
		// the editor binds imports the same way: docToJsonString of the doc
		const editor = shared("cube(data.w);", [{name: "data", json: '{"w":3}'}])
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
