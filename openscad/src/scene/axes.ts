// OpenSCAD's unitless Z-up coordinates -> the scene's Y-up metres.
// Pure: no three, no DOM, safe in a worker or node.

/** Metres per unit for the `unit` build param. */
export const UNIT_METERS = {
	mm: 0.001,
	cm: 0.01,
	m: 1,
	in: 0.0254,
} as const

export type Unit = keyof typeof UNIT_METERS

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
