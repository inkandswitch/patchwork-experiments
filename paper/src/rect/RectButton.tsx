import {createSignal, type JSX} from "solid-js"
import {subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {PaperLayerDoc} from "../types"
import type {Point, SurfaceState} from "../surface/types"
import {createSurfacePointer} from "../surface/usePointer"
import type {RectShape} from "./RectLayerTool"

const FILL = "#9bb3cc"
const STROKE = "#6f8aa6"
const MIN_SIZE = 3

// Selects the rectangle tool and draws rectangles into its layer, entirely
// through the surface provider: selection over `surface:state`, the layer over
// `surface:layer`, and the drag over `surface:pointer`. The button dispatches
// from its own element, so there's no Solid context.
export function RectButton(): JSX.Element {
	let root!: HTMLButtonElement

	const [state, stateHandle] = subscribeDoc<SurfaceState>(() => root, {
		type: "surface:state",
	})
	const [, layerHandle] = subscribeDoc<PaperLayerDoc>(() => root, {
		type: "surface:layer",
		toolId: "rect",
	})
	const active = () => state()?.selectedTool === "rect"

	let start: Point | undefined
	let index: number | undefined
	const [hovered, setHovered] = createSignal(false)

	// Anchor at the drag origin so dragging in any direction grows the rect.
	const resize = (shape: RectShape, point: Point) => {
		shape.x = Math.min(start!.x, point.x)
		shape.y = Math.min(start!.y, point.y)
		shape.width = Math.abs(point.x - start!.x)
		shape.height = Math.abs(point.y - start!.y)
	}

	createSurfacePointer(() => root, {
		onPointerDown: (point) => {
			const layer = layerHandle()
			if (!active() || !layer) return
			start = point
			layer.change((doc) => {
				if (!doc.shapes) doc.shapes = []
				const z = doc.shapes.reduce((max, s) => Math.max(max, s.z ?? 0), 0) + 1
				const shape: RectShape = {
					x: point.x,
					y: point.y,
					z,
					width: 0,
					height: 0,
					fill: FILL,
					stroke: STROKE,
				}
				doc.shapes.push(shape)
				index = doc.shapes.length - 1
			})
		},
		onPointerMove: (point) => {
			const layer = layerHandle()
			if (!active() || !layer || start === undefined || index === undefined) return
			layer.change((doc) => {
				const shape = doc.shapes?.[index!] as RectShape | undefined
				if (shape) resize(shape, point)
			})
		},
		onPointerUp: (point) => {
			const layer = layerHandle()
			if (active() && layer && start !== undefined && index !== undefined) {
				layer.change((doc) => {
					const shape = doc.shapes?.[index!] as RectShape | undefined
					if (!shape) return
					resize(shape, point)
					if ((shape.width ?? 0) < MIN_SIZE || (shape.height ?? 0) < MIN_SIZE) {
						doc.shapes.splice(index!, 1)
					}
				})
			}
			start = undefined
			index = undefined
		},
	})

	const toggle = () => {
		stateHandle()?.change((doc) => {
			doc.selectedTool = doc.selectedTool === "rect" ? "" : "rect"
		})
	}

	const buttonStyle = () => ({
		display: "flex",
		"align-items": "center",
		"justify-content": "center",
		width: "34px",
		height: "34px",
		padding: "0",
		border: `1px solid ${active() ? "#1c1917" : "rgba(28, 25, 23, 0.1)"}`,
		"border-radius": "10px",
		background: active() ? "#1c1917" : hovered() ? "#ffffff" : "rgba(255, 255, 255, 0.9)",
		"box-shadow": "0 1px 3px rgba(28, 25, 23, 0.18)",
		"backdrop-filter": "blur(6px)",
		color: active() ? "#fafaf9" : "#44403c",
		cursor: "pointer",
		"pointer-events": "auto",
		transition: "background 0.12s ease, color 0.12s ease, border-color 0.12s ease",
	})

	return (
		<button
			ref={root}
			type="button"
			style={buttonStyle()}
			title="Rectangle"
			aria-label="Rectangle"
			aria-pressed={active()}
			data-surface-no-draw
			onClick={toggle}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<rect
					x="3.5"
					y="5"
					width="13"
					height="10"
					rx="1.5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
				/>
			</svg>
		</button>
	)
}
