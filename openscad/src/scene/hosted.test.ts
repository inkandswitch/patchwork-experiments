import {describe, expect, it, vi} from "vitest"
import {apply, hostedHandle, modelFrame, multiply, undoablePatches} from "./hosted"
import {zUpToYUpMeters} from "./stl"
import type {OpenscadDoc} from "../types"

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const T = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
/** a quarter turn about Y, column-major */
const RY = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]!) < 1e-9)

describe("modelFrame: OpenSCAD's Z-up units to the scene's Y-up metres, under the object", () => {
	it("agrees with the built GLB's conversion for every unit, at the origin", () => {
		const p: [number, number, number] = [10, 20, 30]
		for (const unit of ["mm", "cm", "m", "in"] as const) {
			const built = Array.from(zUpToYUpMeters(new Float32Array(p), unit))
			// (the GLB's positions are float32)
			expect(apply(modelFrame(I, unit)!, p).every((v, i) => Math.abs(v - built[i]!) < 1e-6 * Math.max(1, Math.abs(v)))).toBe(true)
		}
	})
	it("follows the object's drawn matrix: moved, then turned", () => {
		expect(apply(modelFrame(T(5, 0, 0), "mm")!, [1000, 2000, 3000])).toEqual([6, 3, -2])
		const turned = apply(modelFrame(multiply(T(0, 1, 0), RY), "m")!, [1, 0, 0])
		expect(near(turned, [0, 1, -1])).toBe(true)
	})
	it("is null without a drawn matrix", () => {
		expect(modelFrame(null)).toBe(null)
		expect(modelFrame([1, 2, 3])).toBe(null)
	})
})

describe("hostedHandle: the editor's writes, on the scene's undo", () => {
	const handle = () => {
		let doc = {title: "Bracket", source: "cube(1);", "@comments": {} as Record<string, unknown>}
		return {
			url: "automerge:model",
			doc: () => doc,
			on: vi.fn(),
			change: vi.fn((fn: (d: typeof doc) => void, opts?: {patchCallback?: (p: unknown) => void}) => {
				const d = structuredClone(doc)
				fn(d)
				doc = d
				opts?.patchCallback?.([{path: ["source", 0]}, {path: ["@comments", "x"]}])
			}),
		}
	}
	it("goes through the edits service as one labelled step, without Patchwork's @ keys", () => {
		const h = handle()
		let recorded: unknown[] = []
		const edit = vi.fn((doc: {change(fn: (d: unknown) => void): unknown[]}, fn: (d: unknown) => void, o?: {label?: string}) => {
			recorded = doc.change(fn)
			return true
		})
		const hosted = hostedHandle<OpenscadDoc>(h as never, () => ({edit}))
		hosted.change((d: OpenscadDoc) => void (d.source = "sphere(1);"))
		expect(edit.mock.calls[0]![2]).toEqual({label: "Edit Bracket"})
		expect(recorded).toEqual([{path: ["source", 0]}])
		expect(h.doc().source).toBe("sphere(1);")
		// everything else is the handle's own
		expect(hosted.url).toBe("automerge:model")
		hosted.on("change", () => {})
		expect(h.on).toHaveBeenCalledTimes(1)
	})
	it("writes directly without the service, where it refuses, or for a change with options of its own", () => {
		for (const edits of [() => null, () => ({edit: () => false})]) {
			const h = handle()
			hostedHandle<OpenscadDoc>(h as never, edits).change((d: OpenscadDoc) => void (d.source = "x"))
			expect(h.doc().source).toBe("x")
		}
		const h = handle()
		const edit = vi.fn(() => true)
		hostedHandle<OpenscadDoc>(h as never, () => ({edit})).change((d: OpenscadDoc) => void (d.source = "y"), {message: "m"} as never)
		expect([edit.mock.calls.length, h.doc().source]).toEqual([0, "y"])
	})
	it("undoablePatches keeps the person's writes only", () => {
		expect(undoablePatches([{path: ["source", 3]}, {path: ["@patchwork", "title"]}, {path: ["imports", 0]}])).toEqual([{path: ["source", 3]}, {path: ["imports", 0]}])
	})
})
