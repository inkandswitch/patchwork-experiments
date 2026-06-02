// Shape of the ephemeral surface state document the provider owns. Buttons
// read/write `selectedTool` through it; more fields will land here later.
export type SurfaceState = {
	selectedTool: string
}

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
