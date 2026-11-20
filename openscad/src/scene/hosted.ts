// The pure parts of editing an OpenSCAD model in a scene (editTool.tsx): where
// its live render goes, and how its writes reach the scene's undo.

import type {DocHandle} from "@automerge/automerge-repo"
import {UNIT_METERS, type Unit} from "./stl"

/** A column-major 4×4 matrix (three.js's `elements`). */
export type Mat4 = number[]

/** a × b, both column-major. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16).fill(0)
	for (let c = 0; c < 4; c++)
		for (let r = 0; r < 4; r++) {
			let s = 0
			for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!
			out[c * 4 + r] = s
		}
	return out
}

/**
 * The model's frame in the scene: the object's drawn matrix (`world`, its
 * stage's frame) times OpenSCAD's Z-up `unit`s → the scene's Y-up metres, the
 * same turn stl.ts's zUpToYUpMeters makes for the built GLB: x stays, z goes
 * up, y goes away (-z). Null while the object has no drawn matrix.
 */
export function modelFrame(world: Mat4 | null | undefined, unit: Unit = "mm"): Mat4 | null {
	if (!Array.isArray(world) || world.length !== 16) return null
	const s = UNIT_METERS[unit] ?? UNIT_METERS.mm
	// columns: where x, y and z go
	const turn = [s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, 0, 1]
	return multiply(world, turn)
}

/** A point through a column-major matrix. */
export function apply(m: Mat4, [x, y, z]: [number, number, number]): [number, number, number] {
	return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!]
}

/** What the person wrote, of a change's patches: not Patchwork's own `@` keys (comments, metadata), which undo leaves alone. */
export const undoablePatches = <P extends {path: readonly unknown[]}>(patches: readonly P[]): P[] => patches.filter(p => !String(p.path[0]).startsWith("@"))

/** The scene's undo for a package's own writes (scene EDITOR.md, "Undo"). */
export type Edits = {
	edit(doc: {url: string; doc(): unknown; change(fn: (d: unknown) => void): unknown[]}, fn: (d: unknown) => void, o?: {label?: string}): boolean
}

/**
 * The model's handle as the editor gets it in a scene: every write goes on the
 * scene's undo as one step ("Edit ‹title›"), with Patchwork's `@` keys left
 * out of it. Without the scene's `edits` service, or where it refuses (the
 * scene can't be written here), or for a change with options of its own, the
 * write goes to the model as it would anyway.
 */
export function hostedHandle<T extends {title?: string}>(handle: DocHandle<T>, edits: () => Edits | null): DocHandle<T> {
	const doc = {
		url: handle.url,
		doc: () => handle.doc(),
		change(fn: (d: unknown) => void) {
			let patches: {path: readonly unknown[]}[] = []
			handle.change(fn as (d: T) => void, {patchCallback: (p: unknown) => void (patches = p as never)} as never)
			return undoablePatches(patches)
		},
	}
	const change = (fn: (d: T) => void, opts?: object) => {
		if (opts || !edits()?.edit(doc, fn as (d: unknown) => void, {label: `Edit ${handle.doc()?.title || "model"}`})) handle.change(fn, opts as never)
	}
	return new Proxy(handle, {
		get(target, key) {
			if (key === "change") return change
			const v = Reflect.get(target, key, target) as unknown
			return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v
		},
	})
}
