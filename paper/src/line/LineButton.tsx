import {createSignal, type JSX} from "solid-js"
import {subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {PaperLayerDoc} from "../types"
import type {Point, SurfaceState} from "../surface/types"
import {createSurfacePointer} from "../surface/usePointer"
import type {LineShape} from "./LineLayerTool"

const STROKE = "#64748b"
const SIZE = 8
// Skip pointer samples closer than this (px) to the last one: keeps the stored
// path — and the Automerge change log — from exploding while staying smooth.
const MIN_POINT_DISTANCE = 2
// Discard strokes shorter than this so a stray click/tap leaves nothing behind.
const MIN_LENGTH = 4

// Selects the freehand tool and draws strokes into the line layer, entirely
// through the surface provider: selection over `surface:state`, the layer over
// `surface:layer`, and the drag over `surface:pointer`. Every pointer sample
// becomes a point in the stroke's outline; rendering expands it with
// perfect-freehand. The button dispatches from its own element, so there's no
// Solid context.
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
	let last: Point | undefined
	const [hovered, setHovered] = createSignal(false)

	// Append a sample to the stroke, stored relative to the shape origin so the
	// stroke can be moved by changing only `x`/`y`.
	const addPoint = (shape: LineShape, point: Point) => {
		const next = {x: point.x - shape.x, y: point.y - shape.y}
		if (shape.outline?.type === "line") shape.outline.points.push(next)
		else shape.outline = {type: "line", points: [next]}
	}

	const strokeLength = (shape: LineShape) => {
		const points = shape.outline?.type === "line" ? shape.outline.points : []
		let total = 0
		for (let i = 1; i < points.length; i++) {
			total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
		}
		return total
	}

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
					outline: {type: "line", points: [{x: 0, y: 0}]},
					stroke: STROKE,
					strokeWidth: SIZE,
				}
				doc.shapes.push(shape)
				index = doc.shapes.length - 1
			})
			last = point
		},
		onPointerMove: (pointer) => {
			const layer = layerHandle()
			if (!active() || !layer || index === undefined || !pointer.isPressed) return
			if (last && Math.hypot(pointer.x - last.x, pointer.y - last.y) < MIN_POINT_DISTANCE) return
			layer.change((doc) => {
				const shape = doc.shapes?.[index!] as LineShape | undefined
				if (shape) addPoint(shape, pointer)
			})
			last = {x: pointer.x, y: pointer.y}
		},
		onPointerUp: (point) => {
			const layer = layerHandle()
			if (active() && layer && index !== undefined) {
				layer.change((doc) => {
					const shape = doc.shapes?.[index!] as LineShape | undefined
					if (!shape) return
					addPoint(shape, point)
					if (strokeLength(shape) < MIN_LENGTH) {
						doc.shapes.splice(index!, 1)
					}
				})
			}
			index = undefined
			last = undefined
		},
	})

	const toggle = () => {
		stateHandle()?.change((doc) => {
			doc.selectedTool = doc.selectedTool === "line" ? "" : "line"
		})
	}

	const buttonStyle = (): JSX.CSSProperties => ({
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
			title="Draw"
			aria-label="Draw freehand"
			aria-pressed={active()}
			data-surface-no-draw
			onClick={toggle}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
		>
			<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
				<path
					d="M3 13c2.5 0 2.5-6 5-6s2.5 6 5 6 2.5-3 4-3"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	)
}
