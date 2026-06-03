import type {AutomergeUrl} from "@automerge/automerge-repo"

// Shape of the ephemeral surface state document the provider owns. Buttons
// read/write `selectedTool` through it; more fields will land here later.
export type SurfaceState = {
	selectedTool: string
}

// The paper's layers, keyed by toolId. The provider pushes this over
// `surface:layer` when requested without a `toolId`, re-emitting whenever
// layers are added or removed.
export type SurfaceLayers = {[toolId: string]: AutomergeUrl}

// A point in canvas coordinates.
export type Point = {
	x: number
	y: number
}

// A single pointer over the canvas. Reported by the provider as pure
// (non-persisted) state over the `surface:pointer` subscription.
export type Pointer = {
	x: number
	y: number
	isPressed: boolean
}

// The value the provider emits for `surface:pointer`. `pointer` is absent
// until the cursor first interacts with the canvas.
export type SurfacePointerState = {
	pointer?: Pointer
}
