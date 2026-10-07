/**
 * Should the viewer re-frame its camera for a new render? Not for ordinary
 * edits (the user's orbit is kept), only when the part's bounding radius has
 * changed by more than `factor` either way since the camera was last framed.
 */
export function needsReframe(framedRadius: number, radius: number, factor = 3): boolean {
	if (!(radius > 0) || !isFinite(radius)) return false
	if (!(framedRadius > 0) || !isFinite(framedRadius)) return true
	const ratio = radius / framedRadius
	return ratio > factor || ratio < 1 / factor
}
