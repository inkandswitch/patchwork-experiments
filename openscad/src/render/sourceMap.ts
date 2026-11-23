// Which source made which triangle.
//
// OpenSCAD's render merges everything into one mesh and keeps only a colour
// per face, so the tool renders twice: the source as written (what you see,
// download and print), then a *labelled* copy in which every shape's colour is
// an id for the chain of module calls that placed it. The second render's
// faces are matched to the first's, so each triangle of the real model knows
// its source.
//
// The labelled copy (labelSource):
// - every user module call gets `let($_sm = <path + this call>)` in front, so
//   the call path rides down the dynamic scope ($ variables follow children()
//   too);
// - every shape (cube, cylinder, extrusions, hull, import, …) gets the same,
//   plus `echo("SM|", path)` and `color(<id of the path>)`;
// - every color() becomes an empty `let()`: the outermost colour wins in
//   OpenSCAD, so a user's colour would paint over the ids.
// Nothing else changes, and nothing moves to another line (the helper
// functions go on the first line, before the source), so geometry and line
// numbers are the original's. Colours carry 24 bits through the Manifold
// render exactly; the path behind an id comes from the echoes.
//
// Pure: no DOM, no three; runs in the worker and in node tests.

import {OPENSCAD_DEFAULT_RGB, type Model} from "./model"

/** A module call in a source: a shape (a leaf of the geometry) or a call of a user's module. */
export type SourceSite = {
	/** ≥ 1, unique across every file of one render */
	id: number
	/** "" for the document's own source; otherwise the path a linked library is written at (e.g. "lib.scad") */
	file: string
	/** the module called: "cube", "cell", … */
	name: string
	kind: "shape" | "call"
	/** offsets in that file: the call's name through its closing parenthesis */
	from: number
	to: number
	/** 1-based */
	line: number
	/** 0-based, in UTF-16 code units */
	col: number
}

/** A `module name(…)` definition. */
export type ModuleDef = {
	name: string
	file: string
	/** offsets of the name */
	from: number
	to: number
	line: number
	col: number
}

/** One distinct chain of calls that placed geometry: site ids, outermost first, the shape last. */
export type SourceRecord = {path: number[]}

export type SourceMap = {
	sites: SourceSite[]
	modules: ModuleDef[]
	records: SourceRecord[]
	/** per part of the model it maps (same order), per triangle: an index into `records`, or -1 */
	faces: Int32Array[]
	/** triangles no record claimed (an untagged builtin, or a face the two renders split differently) */
	unmapped: number
}

// ─── scanning ───────────────────────────────────────────────────────────────

type Tok = {t: "id" | "num" | "str" | "p" | "path"; v: string; from: number; to: number}

const NUMBER = /[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/y
const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/y
const TWO_CHAR = new Set(["==", "!=", "<=", ">=", "&&", "||"])

/** OpenSCAD tokens, comments and whitespace dropped. Never throws: an unterminated string or comment runs to the end. */
export function tokenize(src: string): Tok[] {
	const out: Tok[] = []
	let i = 0
	const n = src.length
	while (i < n) {
		const c = src[i]
		if (c === " " || c === "\t" || c === "\n" || c === "\r") {
			i++
			continue
		}
		if (c === "/" && src[i + 1] === "/") {
			const end = src.indexOf("\n", i)
			i = end === -1 ? n : end
			continue
		}
		if (c === "/" && src[i + 1] === "*") {
			const end = src.indexOf("*/", i + 2)
			i = end === -1 ? n : end + 2
			continue
		}
		if (c === '"') {
			let j = i + 1
			while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1
			out.push({t: "str", v: src.slice(i, Math.min(j + 1, n)), from: i, to: Math.min(j + 1, n)})
			i = j + 1
			continue
		}
		// include <…> / use <…>: the path is one token, slashes and all
		if (c === "<") {
			const prev = out[out.length - 1]
			if (prev?.t === "id" && (prev.v === "include" || prev.v === "use")) {
				const end = src.indexOf(">", i)
				const to = end === -1 ? n : end + 1
				out.push({t: "path", v: src.slice(i, to), from: i, to})
				i = to
				continue
			}
		}
		IDENT.lastIndex = i
		const id = IDENT.exec(src)
		if (id) {
			out.push({t: "id", v: id[0], from: i, to: i + id[0].length})
			i += id[0].length
			continue
		}
		NUMBER.lastIndex = i
		const num = NUMBER.exec(src)
		if (num) {
			out.push({t: "num", v: num[0], from: i, to: i + num[0].length})
			i += num[0].length
			continue
		}
		const two = src.slice(i, i + 2)
		if (TWO_CHAR.has(two)) {
			out.push({t: "p", v: two, from: i, to: i + 2})
			i += 2
			continue
		}
		out.push({t: "p", v: c, from: i, to: i + 1})
		i++
	}
	return out
}

/** Statements that look like calls but are the language's own: never labelled. */
const CONTROL = new Set(["for", "intersection_for", "if", "else", "let", "each", "echo", "assert", "module", "function", "include", "use"])

/**
 * Builtins that make 3D geometry of their own: the leaves that get an id.
 * (2D shapes are left alone: they reach 3D through an extrusion, which is.)
 * hull, minkowski and roof make new surfaces, so their output is theirs.
 */
export const SHAPES = new Set(["cube", "sphere", "cylinder", "polyhedron", "linear_extrude", "rotate_extrude", "import", "surface", "hull", "minkowski", "roof"])

/** Builtins that only move, combine or select what they're given: no label of their own. */
const PASSTHROUGH = new Set([
	"translate", "rotate", "scale", "mirror", "multmatrix", "resize", "offset", "projection",
	"union", "difference", "intersection", "group", "render", "children", "color",
	"square", "circle", "polygon", "text",
])

export type Scan = {
	/** sites without ids or file, in source order */
	sites: Omit<SourceSite, "id" | "file">[]
	modules: Omit<ModuleDef, "file">[]
	/** color(…) calls: the whole call, name through ")" */
	colors: {from: number; to: number}[]
}

/**
 * Find the module calls, color() calls and module definitions of a source.
 *
 * A call is a statement: an identifier followed by "(" outside any
 * parentheses or brackets, and not in an expression (an assignment or a
 * function body runs from its "=" to its ";"). That is where OpenSCAD's
 * grammar allows a module instantiation and nowhere else, so a function call
 * — `import("x.json")` in an assignment, say — is never mistaken for one.
 */
export function scan(src: string): Scan {
	const toks = tokenize(src)
	const lineStarts = [0]
	for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1)
	const where = (offset: number) => {
		let lo = 0
		let hi = lineStarts.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if (lineStarts[mid] <= offset) lo = mid
			else hi = mid - 1
		}
		return {line: lo + 1, col: offset - lineStarts[lo]}
	}
	const closeOf = (k: number): number => {
		// k is a "(" token; the index of its ")" (or the last token)
		let depth = 0
		for (let j = k; j < toks.length; j++) {
			if (toks[j].v === "(") depth++
			else if (toks[j].v === ")" && --depth === 0) return j
		}
		return toks.length - 1
	}

	const out: Scan = {sites: [], modules: [], colors: []}
	let depth = 0
	let expr = false
	for (let k = 0; k < toks.length; k++) {
		const tok = toks[k]
		if (tok.t === "p") {
			if (tok.v === "(" || tok.v === "[") depth++
			else if (tok.v === ")" || tok.v === "]") depth = Math.max(0, depth - 1)
			else if (depth === 0 && tok.v === "=") expr = true
			else if (depth === 0 && tok.v === ";") expr = false
			continue
		}
		if (tok.t !== "id" || depth !== 0 || expr || toks[k + 1]?.v !== "(") continue
		const prev = toks[k - 1]
		if (prev?.t === "id" && prev.v === "module") {
			out.modules.push({name: tok.v, from: tok.from, to: tok.to, ...where(tok.from)})
			continue
		}
		if (prev?.t === "id" && prev.v === "function") continue
		if (CONTROL.has(tok.v)) continue
		const close = toks[closeOf(k + 1)]
		if (tok.v === "color") {
			out.colors.push({from: tok.from, to: close.to})
			continue
		}
		if (PASSTHROUGH.has(tok.v)) continue
		out.sites.push({name: tok.v, kind: SHAPES.has(tok.v) ? "shape" : "call", from: tok.from, to: close.to, ...where(tok.from)})
	}
	return out
}

// ─── the labelled copy ──────────────────────────────────────────────────────

/** The id colour for a call path, mirrored by `_sm_id` in the labelled source. Never 0, never OpenSCAD's default colour. */
export function pathId(path: readonly number[]): number {
	let h = 7
	for (const s of path) h = (h * 131 + s) % 16777213
	const i = 1 + (h % 16777200)
	return i === DEFAULT_ID ? i + 1 : i
}

const DEFAULT_ID = (OPENSCAD_DEFAULT_RGB[0] << 16) | (OPENSCAD_DEFAULT_RGB[1] << 8) | OPENSCAD_DEFAULT_RGB[2]

/** The helpers every labelled file needs, on one line (they go before the source's first line). */
const PRELUDE =
	`function _sm_h(p, k, h) = k >= len(p) ? h : _sm_h(p, k + 1, (h * 131 + p[k]) % 16777213); ` +
	`function _sm_id(p) = let(i = 1 + _sm_h(p, 0, 7) % 16777200) i == ${DEFAULT_ID} ? i + 1 : i; ` +
	`function _sm_rgb(p) = let(i = _sm_id(p)) [floor(i / 65536) / 255, floor(i / 256) % 256 / 255, i % 256 / 255]; `

const extend = (id: number) => `(is_undef($_sm) ? [${id}] : concat($_sm, [${id}]))`

export type Labelled = {text: string; sites: SourceSite[]; modules: ModuleDef[]}

/**
 * The labelled copy of one file. Site ids start at `firstId`, so the files of
 * one render (the document and its linked libraries) never share one.
 */
export function labelSource(src: string, file = "", firstId = 1): Labelled {
	const found = scan(src)
	const sites: SourceSite[] = found.sites.map((s, i) => ({...s, id: firstId + i, file}))
	const edits: {at: number; end: number; text: string}[] = []
	for (const c of found.colors) edits.push({at: c.from, end: c.to, text: "let()"})
	for (const s of sites) {
		const text =
			s.kind === "shape"
				? `let($_sm = ${extend(s.id)}, _sm_e = echo(str("SM|", $_sm))) color(_sm_rgb($_sm)) `
				: `let($_sm = ${extend(s.id)}) `
		edits.push({at: s.from, end: s.from, text})
	}
	edits.sort((a, b) => a.at - b.at)
	let text = ""
	let i = 0
	for (const e of edits) {
		if (e.at < i) continue // inside a color() already replaced
		text += src.slice(i, e.at) + e.text
		i = e.end
	}
	text += src.slice(i)
	return {text: PRELUDE + text, sites, modules: found.modules.map(m => ({...m, file}))}
}

/**
 * Label a render's every file: the document's source and the linked
 * libraries written next to it (render/includes.ts sourceFiles), with site
 * ids unique across them.
 */
export function labelAll(source: string, files: readonly {path: string; text: string}[]): {source: Labelled; files: (Labelled & {path: string})[]} {
	const main = labelSource(source, "", 1)
	let next = 1 + main.sites.length
	const libs = files.map(f => {
		const l = labelSource(f.text, f.path, next)
		next += l.sites.length
		return {...l, path: f.path}
	})
	return {source: main, files: libs}
}

// ─── reading the labelled render ────────────────────────────────────────────

/** The distinct call paths the labelled render echoed, in first-seen order. */
export function echoedPaths(logs: readonly string[]): number[][] {
	const seen = new Set<string>()
	const out: number[][] = []
	for (const line of logs) {
		const m = /^ECHO: "SM\|\[([0-9, ]*)\]"$/.exec(line.trim())
		if (!m || seen.has(m[1])) continue
		seen.add(m[1])
		out.push(m[1] ? m[1].split(",").map(Number) : [])
	}
	return out
}

/** The labelled render's id for each of its colours' triangles, or -1 for an uncoloured (untagged) one. */
function partId(color: Model["parts"][number]["color"]): number {
	if (!color) return -1
	const [r, g, b] = color.map(c => Math.round(c * 255))
	return (r << 16) | (g << 8) | b
}

const triKey = (p: Float32Array, t: number) => {
	const o = t * 9
	const a = `${p[o]},${p[o + 1]},${p[o + 2]}`
	const b = `${p[o + 3]},${p[o + 4]},${p[o + 5]}`
	const c = `${p[o + 6]},${p[o + 7]},${p[o + 8]}`
	return [a, b, c].sort().join("|")
}

/** Most triangle pairs a fallback search may test, so a pathological model can't stall the worker. */
const FALLBACK_BUDGET = 20_000_000

/**
 * The labelled render's id for every triangle of the real one, per part.
 * Triangles match on their corners (the two renders' geometry is the same, so
 * nearly all do); one that doesn't takes the id of the labelled triangle its
 * centre lies on, or -1.
 */
export function matchFaces(real: readonly Float32Array[], labelled: Model): Int32Array[] {
	const byKey = new Map<string, number>()
	const lTris: {p: Float32Array; t: number; id: number}[] = []
	for (const part of labelled.parts) {
		const id = partId(part.color)
		const count = part.positions.length / 9
		for (let t = 0; t < count; t++) {
			byKey.set(triKey(part.positions, t), id)
			lTris.push({p: part.positions, t, id})
		}
	}
	const misses: {part: number; t: number}[] = []
	const out = real.map((positions, part) => {
		const ids = new Int32Array(positions.length / 9)
		for (let t = 0; t < ids.length; t++) {
			const id = byKey.get(triKey(positions, t))
			if (id === undefined) {
				ids[t] = -1
				misses.push({part, t})
			} else ids[t] = id
		}
		return ids
	})
	if (misses.length && misses.length * lTris.length <= FALLBACK_BUDGET) {
		for (const {part, t} of misses) out[part][t] = idAtCentre(real[part], t, lTris)
	}
	return out
}

function idAtCentre(p: Float32Array, t: number, tris: {p: Float32Array; t: number; id: number}[]): number {
	const o = t * 9
	const cx = (p[o] + p[o + 3] + p[o + 6]) / 3
	const cy = (p[o + 1] + p[o + 4] + p[o + 7]) / 3
	const cz = (p[o + 2] + p[o + 5] + p[o + 8]) / 3
	let best = -1
	let bestDist = Infinity
	for (const tri of tris) {
		const d = distanceToTriangle(cx, cy, cz, tri.p, tri.t * 9)
		if (d < bestDist) {
			bestDist = d
			best = tri.id
		}
	}
	// only a triangle the centre is on (allowing for float noise in a large model)
	const size = Math.hypot(p[o] - p[o + 3], p[o + 1] - p[o + 4], p[o + 2] - p[o + 5]) + 1e-9
	return bestDist <= size * 1e-4 ? best : -1
}

/** Distance from a point to a triangle (corners at p[o..o+8]). */
function distanceToTriangle(x: number, y: number, z: number, p: Float32Array, o: number): number {
	// Ericson, Real-Time Collision Detection, closest point on triangle
	const ax = p[o], ay = p[o + 1], az = p[o + 2]
	const abx = p[o + 3] - ax, aby = p[o + 4] - ay, abz = p[o + 5] - az
	const acx = p[o + 6] - ax, acy = p[o + 7] - ay, acz = p[o + 8] - az
	const apx = x - ax, apy = y - ay, apz = z - az
	const d1 = abx * apx + aby * apy + abz * apz
	const d2 = acx * apx + acy * apy + acz * apz
	const dist = (qx: number, qy: number, qz: number) => Math.hypot(x - qx, y - qy, z - qz)
	if (d1 <= 0 && d2 <= 0) return dist(ax, ay, az)
	const bpx = x - p[o + 3], bpy = y - p[o + 4], bpz = z - p[o + 5]
	const d3 = abx * bpx + aby * bpy + abz * bpz
	const d4 = acx * bpx + acy * bpy + acz * bpz
	if (d3 >= 0 && d4 <= d3) return dist(p[o + 3], p[o + 4], p[o + 5])
	const vc = d1 * d4 - d3 * d2
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3)
		return dist(ax + v * abx, ay + v * aby, az + v * abz)
	}
	const cpx = x - p[o + 6], cpy = y - p[o + 7], cpz = z - p[o + 8]
	const d5 = abx * cpx + aby * cpy + abz * cpz
	const d6 = acx * cpx + acy * cpy + acz * cpz
	if (d6 >= 0 && d5 <= d6) return dist(p[o + 6], p[o + 7], p[o + 8])
	const vb = d5 * d2 - d1 * d6
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6)
		return dist(ax + w * acx, ay + w * acy, az + w * acz)
	}
	const va = d3 * d6 - d5 * d4
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
		const bx = p[o + 3], by = p[o + 4], bz = p[o + 5]
		return dist(bx + w * (p[o + 6] - bx), by + w * (p[o + 7] - by), bz + w * (p[o + 8] - bz))
	}
	const denom = 1 / (va + vb + vc)
	const v = vb * denom
	const w = vc * denom
	return dist(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/**
 * Put it together: the real model's parts (positions), the labelled render's
 * model and logs, and the labelled files' sites and modules.
 */
export function buildSourceMap(
	real: readonly Float32Array[],
	labelled: Model,
	logs: readonly string[],
	files: readonly Labelled[],
): SourceMap {
	const sites = files.flatMap(f => f.sites)
	const modules = files.flatMap(f => f.modules)
	const records: SourceRecord[] = echoedPaths(logs).map(path => ({path}))
	// an id two paths share (a hash collision) keeps the first: its faces still
	// name a real call, just possibly the wrong one of the two
	const recordOf = new Map<number, number>()
	records.forEach((r, i) => {
		const id = pathId(r.path)
		if (!recordOf.has(id)) recordOf.set(id, i)
	})
	let unmapped = 0
	const faces = matchFaces(real, labelled).map(ids => {
		const out = new Int32Array(ids.length)
		for (let t = 0; t < ids.length; t++) {
			const r = ids[t] < 0 ? undefined : recordOf.get(ids[t])
			out[t] = r ?? -1
			if (r === undefined) unmapped++
		}
		return out
	})
	return {sites, modules, records, faces, unmapped}
}

// ─── reading a source map ───────────────────────────────────────────────────

/** A record's sites, outermost first (the shape last); ids the map doesn't know are left out. */
export function chainOf(map: Pick<SourceMap, "sites" | "records">, record: number): SourceSite[] {
	const byId = new Map(map.sites.map(s => [s.id, s]))
	return (map.records[record]?.path ?? []).map(id => byId.get(id)).filter((s): s is SourceSite => !!s)
}

/**
 * The name a record goes by: the innermost of your modules that placed it
 * ("cell"), else the shape itself ("cube"). Name modules well and these are
 * your labels.
 */
export function labelOf(map: Pick<SourceMap, "sites" | "records">, record: number): string {
	const chain = chainOf(map, record)
	const call = [...chain].reverse().find(s => s.kind === "call")
	return call?.name ?? chain[chain.length - 1]?.name ?? "?"
}

/** The triangles (9 floats each) of `model` whose record is in `records`, one soup across parts. */
export function trianglesOf(model: Model, map: Pick<SourceMap, "faces">, records: ReadonlySet<number>): Float32Array {
	let count = 0
	map.faces.forEach(ids => ids.forEach(r => (count += records.has(r) ? 1 : 0)))
	const out = new Float32Array(count * 9)
	let o = 0
	model.parts.forEach((part, pi) => {
		const ids = map.faces[pi]
		if (!ids) return
		for (let t = 0; t < ids.length; t++) {
			if (!records.has(ids[t])) continue
			out.set(part.positions.subarray(t * 9, t * 9 + 9), o)
			o += 9
		}
	})
	return out
}

/**
 * The piece a click landed on: the triangles of the same record connected to
 * triangle `tri` of part `part` through shared corners. A loop or a repeated
 * call makes one record of many pieces (six cells from one line); this is the
 * one you clicked.
 */
export function pieceOf(model: Model, map: Pick<SourceMap, "faces">, part: number, tri: number): Float32Array {
	const record = map.faces[part]?.[tri]
	if (record == null || record < 0) return new Float32Array(0)
	// the record's triangles, and which share each corner
	const tris: {p: Float32Array; t: number}[] = []
	const byCorner = new Map<string, number[]>()
	let start = -1
	model.parts.forEach((pt, pi) => {
		const ids = map.faces[pi]
		if (!ids) return
		for (let t = 0; t < ids.length; t++) {
			if (ids[t] !== record) continue
			const k = tris.length
			if (pi === part && t === tri) start = k
			tris.push({p: pt.positions, t})
			for (let v = 0; v < 3; v++) {
				const o = t * 9 + v * 3
				const key = `${pt.positions[o]},${pt.positions[o + 1]},${pt.positions[o + 2]}`
				let list = byCorner.get(key)
				if (!list) byCorner.set(key, (list = []))
				list.push(k)
			}
		}
	})
	if (start < 0) return new Float32Array(0)
	const seen = new Uint8Array(tris.length)
	const stack = [start]
	seen[start] = 1
	const piece: number[] = []
	while (stack.length) {
		const k = stack.pop()!
		piece.push(k)
		const {p, t} = tris[k]
		for (let v = 0; v < 3; v++) {
			const o = t * 9 + v * 3
			for (const n of byCorner.get(`${p[o]},${p[o + 1]},${p[o + 2]}`) ?? []) {
				if (seen[n]) continue
				seen[n] = 1
				stack.push(n)
			}
		}
	}
	const out = new Float32Array(piece.length * 9)
	piece.forEach((k, i) => out.set(tris[k].p.subarray(tris[k].t * 9, tris[k].t * 9 + 9), i * 9))
	return out
}

/** The records whose chain passes through a call in the document's own source that spans `offset`. */
export function recordsAt(map: Pick<SourceMap, "sites" | "records">, offset: number): Set<number> {
	const here = new Set(map.sites.filter(s => s.file === "" && s.from <= offset && offset <= s.to).map(s => s.id))
	const out = new Set<number>()
	if (!here.size) return out
	map.records.forEach((r, i) => {
		if (r.path.some(id => here.has(id))) out.add(i)
	})
	return out
}

/** One part of the model, as the document's last run lists it for other tools (lastRun.ts). */
export type PartSummary = {
	/** the innermost of your modules that placed it, else the shape (labelOf) */
	label: string
	/** the calls that placed it, outermost first: "name:line", with "file:" in front for a library's */
	chain: string[]
	triangles: number
	/** its bounding box in the model's own units and axes: [[minX, minY, minZ], [maxX, maxY, maxZ]] */
	box: [number[], number[]]
}

/** Most parts a summary lists (the biggest by triangles), so a vast model can't swell the document. */
export const MAX_PARTS = 200

/** Every part that drew triangles, biggest first. */
export function summarize(model: Model, map: SourceMap): PartSummary[] {
	const rows = new Map<number, {triangles: number; min: number[]; max: number[]}>()
	model.parts.forEach((part, pi) => {
		const ids = map.faces[pi]
		if (!ids) return
		for (let t = 0; t < ids.length; t++) {
			const r = ids[t]
			if (r < 0) continue
			let row = rows.get(r)
			if (!row) rows.set(r, (row = {triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]}))
			row.triangles++
			for (let v = 0; v < 3; v++)
				for (let k = 0; k < 3; k++) {
					const x = part.positions[t * 9 + v * 3 + k]
					if (x < row.min[k]) row.min[k] = x
					if (x > row.max[k]) row.max[k] = x
				}
		}
	})
	const round = (x: number) => Math.round(x * 1000) / 1000
	return [...rows]
		.sort((a, b) => b[1].triangles - a[1].triangles || a[0] - b[0])
		.slice(0, MAX_PARTS)
		.map(([r, row]) => ({
			label: labelOf(map, r),
			chain: chainOf(map, r).map(s => `${s.file ? `${s.file}:` : ""}${s.name}:${s.line}`),
			triangles: row.triangles,
			box: [row.min.map(round), row.max.map(round)],
		}))
}

/** Where a module is defined, by name, preferring the file a call came from. */
export function definitionOf(map: Pick<SourceMap, "modules">, name: string, file?: string): ModuleDef | undefined {
	return map.modules.find(m => m.name === name && m.file === file) ?? map.modules.find(m => m.name === name)
}
