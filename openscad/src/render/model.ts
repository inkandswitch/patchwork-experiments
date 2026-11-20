// A rendered OpenSCAD model: triangles grouped by colour.
//
// The engine exports OFF, which carries a colour per face; this module reads
// it, and writes the 3MF and STL downloads. OpenSCAD can write 3MF itself, but
// it paints uncoloured parts its default yellow, and this writer leaves a
// model without color() unpainted (see to3MFModelXML).
// Pure: no three, no DOM, safe in a worker or node.

import {strToU8, zipSync} from "fflate"

/** sRGB, each channel 0..1 */
export type RGBA = [number, number, number, number]

export type ModelPart = {
	/** null for triangles the model gives no colour */
	color: RGBA | null
	/** xyz per vertex, three vertices per triangle, in OpenSCAD's own units and axes (Z-up) */
	positions: Float32Array
}

export type Model = {
	/** one per distinct colour, in order of first appearance */
	parts: ModelPart[]
	triangles: number
}

/**
 * The colour OpenSCAD gives faces without a color() (the default "Cornfield"
 * scheme's face colour). Faces of exactly this opaque colour read as
 * uncoloured, so a part without color() keeps the viewer's default look, and
 * isn't painted yellow in a slicer. (A color("#f9d72c") reads as none too.)
 */
export const OPENSCAD_DEFAULT_RGB = [249, 215, 44] as const

/**
 * Parse OFF as OpenSCAD writes it: an `OFF` header (counts on the same line
 * or the next), vertices, then faces as `n i1 … in [r g b [a]]`. Colours are
 * 0..255 integers, or 0..1 floats if written with a decimal point. Faces
 * with more than three corners are fanned (the Manifold backend writes
 * triangles only, and its polygons are convex anyway).
 */
export function parseOFF(text: string): Model {
	const lines = text.split("\n")
	let li = 0
	/** the next line with content, as tokens (comments and blank lines skipped) */
	function next(): string[] {
		while (li < lines.length) {
			const line = lines[li++].replace(/#.*/, "").trim()
			if (line) return line.split(/\s+/)
		}
		throw new Error("OFF: file ends early")
	}

	let head = next()
	if (!/^C?N?OFF$/.test(head[0])) throw new Error(`OFF: expected an OFF header, got "${head[0]}"`)
	head = head.length > 1 ? head.slice(1) : next()
	const nv = Number(head[0])
	const nf = Number(head[1])
	if (!Number.isInteger(nv) || !Number.isInteger(nf) || nv < 0 || nf < 0) throw new Error("OFF: unreadable vertex/face counts")

	const v = new Float64Array(nv * 3)
	for (let i = 0; i < nv; i++) {
		const t = next()
		for (let k = 0; k < 3; k++) v[i * 3 + k] = Number(t[k])
	}
	if (v.some(n => !Number.isFinite(n))) throw new Error("OFF: unreadable vertex coordinate")

	const parts = new Map<string, {color: RGBA | null; positions: number[]}>()
	let triangles = 0
	for (let f = 0; f < nf; f++) {
		const t = next()
		const n = Number(t[0])
		if (!Number.isInteger(n) || n < 3 || t.length < 1 + n) throw new Error(`OFF: face ${f} is unreadable`)
		const corners = t.slice(1, 1 + n).map(Number)
		if (corners.some(c => !Number.isInteger(c) || c < 0 || c >= nv)) throw new Error(`OFF: face ${f} names a missing vertex`)
		const color = faceColor(t.slice(1 + n))
		const key = color ? color.join(",") : "none"
		let part = parts.get(key)
		if (!part) parts.set(key, (part = {color, positions: []}))
		for (let k = 1; k + 1 < n; k++) {
			for (const c of [corners[0], corners[k], corners[k + 1]]) part.positions.push(v[c * 3], v[c * 3 + 1], v[c * 3 + 2])
			triangles++
		}
	}
	return {parts: [...parts.values()].map(p => ({color: p.color, positions: Float32Array.from(p.positions)})), triangles}
}

function faceColor(tokens: string[]): RGBA | null {
	if (tokens.length < 3) return null
	const floats = tokens.some(t => t.includes("."))
	const c = tokens.slice(0, 4).map(t => (floats ? Number(t) * 255 : Number(t)))
	if (c.some(n => !Number.isFinite(n))) return null
	const [r, g, b, a = 255] = c.map(n => Math.min(255, Math.max(0, Math.round(n))))
	if (a === 255 && r === OPENSCAD_DEFAULT_RGB[0] && g === OPENSCAD_DEFAULT_RGB[1] && b === OPENSCAD_DEFAULT_RGB[2]) return null
	return [r / 255, g / 255, b / 255, a / 255]
}

/** Every triangle of the model, as one triangle soup (colours dropped), parts in order. */
export function allPositions(model: Model): Float32Array {
	if (model.parts.length === 1) return model.parts[0].positions
	const out = new Float32Array(model.triangles * 9)
	let offset = 0
	for (const part of model.parts) {
		out.set(part.positions, offset)
		offset += part.positions.length
	}
	return out
}

/** Binary STL of the model (colours dropped), for the editor's STL download. */
export function toBinarySTL(model: Model): Uint8Array {
	const p = allPositions(model)
	const count = p.length / 9
	const bytes = new Uint8Array(84 + count * 50)
	const dv = new DataView(bytes.buffer)
	new TextEncoder().encodeInto("OpenSCAD model", bytes)
	dv.setUint32(80, count, true)
	for (let t = 0; t < count; t++) {
		const o = t * 9
		const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2]
		const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2]
		let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
		const len = Math.hypot(nx, ny, nz) || 1
		nx /= len, ny /= len, nz /= len
		const base = 84 + t * 50
		dv.setFloat32(base, nx, true)
		dv.setFloat32(base + 4, ny, true)
		dv.setFloat32(base + 8, nz, true)
		for (let k = 0; k < 9; k++) dv.setFloat32(base + 12 + k * 4, p[o + k], true)
	}
	return bytes
}

const hex2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255).toString(16).padStart(2, "0").toUpperCase()
/** RGBA -> 3MF's "#RRGGBB" or "#RRGGBBAA" */
export function toHexColor([r, g, b, a]: RGBA): string {
	return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a) : ""}`
}

/** shortest text that reads back as the same float32 */
function f32(n: number): string {
	for (let digits = 6; digits < 9; digits++) {
		const s = String(+n.toPrecision(digits))
		if (Math.fround(+s) === n) return s
	}
	return String(n)
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`

/**
 * The 3MF model XML: one watertight mesh object (vertices shared across
 * colours, so a slicer sees one closed solid), colours as core-spec
 * `basematerials` with a `displaycolor` each, and a pid/p1 on every
 * triangle. A model with no colours at all has no materials. In a model with
 * some, uncoloured triangles get OpenSCAD's default colour, as OpenSCAD's own
 * 3MF export does, because the spec gives triangles of an object with a pid
 * no way to have no colour.
 */
export function to3MFModelXML(model: Model, name = "OpenSCAD model"): string {
	const coloured = model.parts.some(p => p.color)
	const palette: RGBA[] = []
	const paletteIndex = new Map<string, number>()
	const indexOf = (color: RGBA | null) => {
		const c = color ?? ([...OPENSCAD_DEFAULT_RGB.map(n => n / 255), 1] as RGBA)
		const key = toHexColor(c)
		let i = paletteIndex.get(key)
		if (i === undefined) {
			paletteIndex.set(key, (i = palette.length))
			palette.push(c)
		}
		return i
	}

	const vertexIndex = new Map<string, number>()
	const vertices: string[] = []
	const triangles: string[] = []
	for (const part of model.parts) {
		const p = part.positions
		const prop = coloured ? ` pid="1" p1="${indexOf(part.color)}"` : ""
		for (let t = 0; t < p.length; t += 9) {
			const corner = [0, 3, 6].map(o => {
				const xyz = [f32(p[t + o]), f32(p[t + o + 1]), f32(p[t + o + 2])]
				const key = xyz.join(" ")
				let i = vertexIndex.get(key)
				if (i === undefined) {
					vertexIndex.set(key, (i = vertices.length))
					vertices.push(`<vertex x="${xyz[0]}" y="${xyz[1]}" z="${xyz[2]}"/>`)
				}
				return i
			})
			triangles.push(`<triangle v1="${corner[0]}" v2="${corner[1]}" v3="${corner[2]}"${prop}/>`)
		}
	}

	const esc = (s: string) => s.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)
	const materials = coloured
		? `  <basematerials id="1">\n${palette.map((c, i) => `   <base name="color ${i}" displaycolor="${toHexColor(c)}"/>`).join("\n")}\n  </basematerials>\n`
		: ""
	const objectProp = coloured ? ` pid="1" pindex="0"` : ""
	return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">Patchwork OpenSCAD</metadata>
 <resources>
${materials}  <object id="2" type="model" name="${esc(name)}"${objectProp}>
   <mesh>
    <vertices>
${vertices.join("\n")}
    </vertices>
    <triangles>
${triangles.join("\n")}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="2"/>
 </build>
</model>
`
}

/** A .3mf package of the model, colours included, for the editor's 3MF download. */
export function to3MF(model: Model, name?: string): Uint8Array {
	return zipSync({
		"[Content_Types].xml": strToU8(CONTENT_TYPES),
		"_rels/.rels": strToU8(RELS),
		"3D/3dmodel.model": [strToU8(to3MFModelXML(model, name)), {level: 6}],
	}, {level: 0})
}
