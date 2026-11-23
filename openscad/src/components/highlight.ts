// Drawing a picked part, and choosing what a click hit, for both views of a
// model: the editor's own (Viewer3D) and a scene's (scene/editTool.tsx). They
// use different copies of three.js, so it's passed in.

import type * as Three from "three"

/** The highlight colour when the theme gives none we can read. */
export const DEFAULT_ACCENT = "#35f7ca"

/** The theme's accent from an element's styles, if it's a colour three.js reads; else the default. */
export function accentOf(el: Element): string {
	const css = getComputedStyle(el).getPropertyValue("--openscad-accent").trim()
	return /^#[0-9a-f]{3,8}$/i.test(css) ? css : DEFAULT_ACCENT
}

/**
 * A part's triangles (9 floats each) washed in the accent; `strong` (the
 * picked part) more so, with its creases drawn over everything so it shows
 * through whatever is in front.
 */
export function highlightObjects(THREE: typeof Three, positions: Float32Array, strong: boolean, accent: string): Three.Object3D[] {
	if (!positions.length) return []
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.BufferAttribute(positions, 3))
	const fill = new THREE.Mesh(
		g,
		new THREE.MeshBasicMaterial({
			color: accent,
			transparent: true,
			opacity: strong ? 0.45 : 0.22,
			depthWrite: false,
			side: THREE.DoubleSide,
			polygonOffset: true,
			polygonOffsetFactor: -1,
			polygonOffsetUnits: -1,
		}),
	)
	fill.renderOrder = 10
	if (!strong) return [fill]
	const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({color: accent, transparent: true, opacity: 0.9, depthTest: false}))
	edges.renderOrder = 11
	return [fill, edges]
}

/** Dispose of what highlightObjects made (each object owns its geometry and material). */
export function disposeAll(objects: Iterable<Three.Object3D>) {
	for (const o of objects) {
		o.removeFromParent()
		const m = o as Three.Mesh
		m.geometry?.dispose()
		;(m.material as Three.Material | undefined)?.dispose()
	}
}

/**
 * What a click picks among a ray's hits (nearest first): see-through surfaces
 * are passed over for the first opaque one behind them, as the eye does (the
 * cells inside a translucent enclosure), unless there is none; `front` takes
 * the nearest regardless (Alt-click).
 */
export function chooseHit<H>(hits: readonly H[], seeThrough: (hit: H) => boolean, front = false): H | undefined {
	if (front) return hits[0]
	return hits.find(h => !seeThrough(h)) ?? hits[0]
}
