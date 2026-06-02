import {createSignal, type JSX} from "solid-js"
import {subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {PaperLayerDoc} from "../types"
import type {Point, SurfaceState} from "../surface/types"
import {createSurfacePointer} from "../surface/usePointer"
import type {LineShape} from "./LineLayerTool"

const STROKE = "#64748b"
const STROKE_WIDTH = 4
const MIN_LENGTH = 3

// Selects the line tool and draws lines into its layer, entirely through the
// surface provider: selection over `surface:state`, the layer over
// `surface:layer`, and the drag over `surface:pointer`. The button dispatches
// from its own element, so there's no Solid context.
export function LineButton(): JSX.Element {
	let root!: HTMLButtonElement

	const [state, stateHandle] = subscribeDoc<SurfaceState>(() => root, {
		type: "surface:state",
	})
	const [, layerHandle] = subscribeDoc<PaperLayerDoc>(() => root, {
		type: "surface:layer",
		toolId: "line",
	})
	const active = () => state()?.selectedTool === "line"

	let index: number | undefined
	const [hovered, setHovered] = createSignal(false)

	createSurfacePointer(() => root, {
		onPointerDown: (point) => {
			const layer = layerHandle()
			if (!active() || !layer) return
			layer.change((doc) => {
				if (!doc.shapes) doc.shapes = []
				const z = doc.shapes.reduce((max, s) => Math.max(max, s.z ?? 0), 0) + 1
				const shape: LineShape = {
					x: point.x,
					y: point.y,
					z,
					x2: point.x,
					y2: point.y,
					stroke: STROKE,
					strokeWidth: STROKE_WIDTH,
				}
				doc.shapes.push(shape)
				index = doc.shapes.length - 1
			})
		},
		onPointerMove: (point) => {
			const layer = layerHandle()
			if (!active() || !layer || index === undefined) return
			layer.change((doc) => {
				const shape = doc.shapes?.[index!] as LineShape | undefined
				if (shape) {
					shape.x2 = point.x
					shape.y2 = point.y
				}
			})
		},
		onPointerUp: (point) => {
			const layer = layerHandle()
			if (active() && layer && index !== undefined) {
				layer.change((doc) => {
					const shape = doc.shapes?.[index!] as LineShape | undefined
					if (!shape) return
					shape.x2 = point.x
					shape.y2 = point.y
					if (Math.hypot(shape.x2 - shape.x, shape.y2 - shape.y) < MIN_LENGTH) {
						doc.shapes.splice(index!, 1)
					}
				})
			}
			index = undefined
		},
	})

	const toggle = () => {
		stateHandle()?.change((doc) => {
			doc.selectedTool = doc.selectedTool === "line" ? "" : "line"
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
			title="Line"
			aria-label="Line"
			aria-pressed={active()}
			data-surface-no-draw
			onClick={toggle}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<line
					x1="4"
					y1="16"
					x2="16"
					y2="4"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	)
}
