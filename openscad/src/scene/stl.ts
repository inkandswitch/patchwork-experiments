// STL -> triangle soup, and OpenSCAD's unitless Z-up coordinates -> the
// scene's Y-up metres. Pure: no three, no DOM, safe in a worker or node.
//
// The engine always exports binary STL (--export-format=binstl), but ASCII is
// accepted too so a hand-fed STL doesn't fail for no reason.

const decoder = new TextDecoder()

/** Metres per unit for the `unit` build param. */
export const UNIT_METERS = {
	mm: 0.001,
	cm: 0.01,
	m: 1,
	in: 0.0254,
} as const

export type Unit = keyof typeof UNIT_METERS

export type ParsedSTL = {
	/** xyz per vertex, three vertices per triangle, in the file's own units/axes */
	positions: Float32Array
	triangles: number
	format: "binary" | "ascii"
}

function isBinary(bytes: Uint8Array): boolean {
	if (bytes.byteLength < 84) return false
	const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true)
	if (84 + count * 50 === bytes.byteLength) return true
	const head = decoder.decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).trimStart()
	return !/^solid\b[\s\S]*facet/i.test(head) && 84 + count * 50 <= bytes.byteLength
}

function parseBinary(bytes: Uint8Array): Float32Array {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const count = dv.getUint32(80, true)
	const positions = new Float32Array(count * 9)
	for (let t = 0; t < count; t++) {
		const base = 84 + t * 50 + 12 // skip the stored facet normal
		for (let k = 0; k < 9; k++) positions[t * 9 + k] = dv.getFloat32(base + k * 4, true)
	}
	return positions
}

function parseAscii(text: string): Float32Array {
	const out: number[] = []
	const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(text))) out.push(Number(m[1]), Number(m[2]), Number(m[3]))
	if (out.length % 9) throw new Error(`STL: ${out.length / 3} vertices is not a whole number of triangles`)
	if (out.some(v => !Number.isFinite(v))) throw new Error("STL: unreadable vertex coordinate")
	return Float32Array.from(out)
}

export function parseSTL(input: Uint8Array | ArrayBuffer | string): ParsedSTL {
	let positions: Float32Array
	let format: ParsedSTL["format"]
	if (typeof input === "string") {
		positions = parseAscii(input)
		format = "ascii"
	} else {
		const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
		if (isBinary(bytes)) {
			positions = parseBinary(bytes)
			format = "binary"
		} else {
			positions = parseAscii(decoder.decode(bytes))
			format = "ascii"
		}
	}
	return {positions, triangles: positions.length / 9, format}
}

/**
 * OpenSCAD space (Z-up, `unit` per coordinate) -> glTF space (Y-up, metres).
 * Z-up -> Y-up is a -90 degree turn about X: (x, y, z) -> (x, z, -y). That is a
 * rotation, not a reflection, so triangle winding (and so facing) is kept.
 */
export function zUpToYUpMeters(positions: Float32Array, unit: Unit = "mm"): Float32Array {
	const s = UNIT_METERS[unit] ?? UNIT_METERS.mm
	const out = new Float32Array(positions.length)
	for (let i = 0; i < positions.length; i += 3) {
		out[i] = positions[i] * s
		out[i + 1] = positions[i + 2] * s
		out[i + 2] = -positions[i + 1] * s
	}
	return out
}
