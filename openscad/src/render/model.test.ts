import {describe, expect, it} from "vitest"
import {strFromU8, unzipSync} from "fflate"
import {allPositions, parseOFF, to3MF, to3MFModelXML, toBinarySTL, toHexColor, type Model} from "./model"

/**
 * A tetrahedron laid out the way openscad-wasm 0.0.4 writes OFF
 * (probes/formats-probe.html): counts on the header line, a trailing space
 * after each vertex, 0..255 colours, alpha only when it isn't 255, and the
 * default face colour 249 215 44 on faces without color().
 */
const TETRA = `OFF 4 4 0
0 0 0
10 0 0
0 10 0
0 0 10
3 0 2 1 255 0 0
3 0 1 3 0 0 255 127
3 0 3 2 249 215 44
3 1 2 3 255 0 0
`

const xyz = (m: Model, part: number) => Array.from(m.parts[part].positions)

describe("parseOFF", () => {
	it("groups faces by colour, in order of first appearance", () => {
		const m = parseOFF(TETRA)
		expect(m.triangles).toBe(4)
		expect(m.parts.map(p => p.color)).toEqual([[1, 0, 0, 1], [0, 0, 1, 127 / 255], null])
		expect(xyz(m, 0)).toEqual([0, 0, 0, 0, 10, 0, 10, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10])
		expect(xyz(m, 2)).toEqual([0, 0, 0, 0, 0, 10, 0, 10, 0])
	})

	it("reads OpenSCAD's default face colour as no colour, but not a translucent one", () => {
		const m = parseOFF("OFF\n3 2 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 249 215 44\n3 0 2 1 249 215 44 128\n")
		expect(m.parts.map(p => p.color)).toEqual([null, [249 / 255, 215 / 255, 44 / 255, 128 / 255]])
	})

	it("reads faces without colours as uncoloured, and 0..1 float colours", () => {
		const m = parseOFF("OFF\n# a comment\n3 2 0\n\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n3 0 2 1 0.0 1.0 0.0\n")
		expect(m.parts.map(p => p.color)).toEqual([null, [0, 1, 0, 1]])
	})

	it("fans faces with more than three corners", () => {
		const m = parseOFF("OFF 4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3 10 20 30\n")
		expect(m.triangles).toBe(2)
		expect(xyz(m, 0)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0])
	})

	it("reads an empty model as no parts", () => {
		expect(parseOFF("OFF 0 0 0\n")).toEqual({parts: [], triangles: 0})
	})

	it("throws on what isn't OFF, a missing vertex, or a short file", () => {
		expect(() => parseOFF("solid x")).toThrow("OFF header")
		expect(() => parseOFF("OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 3\n")).toThrow("missing vertex")
		expect(() => parseOFF("OFF 3 1 0\n0 0 0\n1 0 0\n")).toThrow("ends early")
	})
})

describe("toHexColor", () => {
	it("writes #RRGGBB, adding AA only when translucent", () => {
		expect(toHexColor([1, 0, 0, 1])).toBe("#FF0000")
		expect(toHexColor([0, 0, 1, 127 / 255])).toBe("#0000FF7F")
	})
})

describe("to3MF", () => {
	const attrs = (tag: string, xml: string) =>
		[...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)/>`, "g"))].map(m => Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]])))

	it("writes one closed mesh: vertices shared across colours, a pid/p1 on every triangle", () => {
		const xml = to3MFModelXML(parseOFF(TETRA), "Tetra <1>")
		const vertices = attrs("vertex", xml)
		expect(vertices).toHaveLength(4)
		expect(attrs("base", xml).map(b => b.displaycolor)).toEqual(["#FF0000", "#0000FF7F", "#F9D72C"])
		const tris = attrs("triangle", xml)
		expect(tris).toHaveLength(4)
		expect(tris.map(t => [t.pid, t.p1])).toEqual([["1", "0"], ["1", "0"], ["1", "1"], ["1", "2"]])
		// every edge is used by exactly two triangles: still a closed solid
		const edges = new Map<string, number>()
		for (const t of tris) {
			const v = [t.v1, t.v2, t.v3]
			for (let i = 0; i < 3; i++) {
				const key = [v[i], v[(i + 1) % 3]].sort().join("-")
				edges.set(key, (edges.get(key) ?? 0) + 1)
			}
		}
		expect([...edges.values()]).toEqual([2, 2, 2, 2, 2, 2])
		expect(xml).toContain(`<object id="2" type="model" name="Tetra &#60;1&#62;" pid="1" pindex="0">`)
		expect(xml).toContain(`<item objectid="2"/>`)
	})

	it("writes no materials for a model without colours", () => {
		const xml = to3MFModelXML(parseOFF("OFF 3 1 0\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2 249 215 44\n"))
		expect(xml).not.toContain("basematerials")
		expect(xml).not.toContain("pid=")
		expect(attrs("triangle", xml)).toHaveLength(1)
	})

	it("writes coordinates that read back as the same float32", () => {
		const m: Model = {triangles: 1, parts: [{color: null, positions: Float32Array.from([0.1, 1 / 3, -2.5, 1e-7, 123456.7, 0, 0, 0, 1])}]}
		const read = attrs("vertex", to3MFModelXML(m)).flatMap(v => [v.x, v.y, v.z].map(Number))
		expect(Float32Array.from(read)).toEqual(m.parts[0].positions)
	})

	it("packages the model with content types and the root relationship", () => {
		const files = unzipSync(to3MF(parseOFF(TETRA)))
		expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model", "[Content_Types].xml", "_rels/.rels"])
		expect(strFromU8(files["_rels/.rels"])).toContain(`Target="/3D/3dmodel.model"`)
		expect(strFromU8(files["[Content_Types].xml"])).toContain("3dmanufacturing-3dmodel+xml")
		expect(strFromU8(files["3D/3dmodel.model"])).toContain("<basematerials")
	})
})

describe("toBinarySTL", () => {
	it("writes every part's triangles with facet normals, colours dropped", () => {
		const m: Model = {
			triangles: 2,
			parts: [
				{color: [1, 0, 0, 1], positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])},
				{color: null, positions: new Float32Array([0, 0, 5, 0, 1, 5, 1, 0, 5])},
			],
		}
		const bytes = toBinarySTL(m)
		expect(bytes.byteLength).toBe(84 + 2 * 50)
		const dv = new DataView(bytes.buffer)
		expect(dv.getUint32(80, true)).toBe(2)
		const normal = (t: number) => [0, 1, 2].map(k => dv.getFloat32(84 + t * 50 + k * 4, true))
		expect(normal(0)).toEqual([0, 0, 1])
		expect(normal(1)).toEqual([0, 0, -1])
		expect(dv.getFloat32(84 + 50 + 12 + 8, true)).toBe(5)
		expect(allPositions(m)).toHaveLength(18)
	})
})
