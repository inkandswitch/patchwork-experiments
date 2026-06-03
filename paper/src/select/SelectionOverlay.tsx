import {For, Show, createMemo, onCleanup, onMount, type JSX} from "solid-js"
import {useDocument} from "@automerge/automerge-repo-solid-primitives"
import {subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PaperLayerDoc, Point, Shape} from "../types"
import type {SurfaceState} from "../surface/types"
import {createSurfacePointer} from "../surface/usePointer"
import {hitTestShape, outlinePoints, resolveOutline, shapeRef} from "./geometry"
import "./select.css"

// Mirrors the shared focus document the FocusProvider owns. We store composite
// `layerUrl#index` keys in `selection` (we have neither per-shape ids nor
// sub-document urls), so the key type is a plain string.
type FocusDoc = {
	selection: Record<string, true>
	highlight: Record<string, true>
}

// A live view of one layer the selection engine can read on demand.
type LayerEntry = {
	url: AutomergeUrl
	getDoc: () => PaperLayerDoc | undefined
	getHandle: () => DocHandle<PaperLayerDoc> | undefined
}

// The selection engine: a full-canvas overlay above the layer views. It reads
// every layer's shapes (for hit detection and deletion) and the shared focus
// doc (for the current selection), and draws a highlight on each selected
// shape. Clicking selects the topmost shape under the cursor; shift-click
// toggles; Backspace/Delete removes the selection. Drawing is left to the
// layer tools — this only ever reads them.
export function SelectionOverlay(props: {
	layers: () => [string, AutomergeUrl][]
}): JSX.Element {
	let root!: HTMLDivElement

	const [state] = subscribeDoc<SurfaceState>(() => root, {type: "surface:state"})
	const [focusDoc, focusHandle] = subscribeDoc<FocusDoc>(() => root, {
		type: "patchwork:focus",
	})
	const active = () => state()?.selectedTool === "select"
	const selection = () => focusDoc()?.selection ?? {}

	// Hit detection and deletion read layers imperatively at event time, so we
	// keep the live accessors in a plain Map the probe children maintain.
	const registry = new Map<AutomergeUrl, LayerEntry>()
	let shiftDown = false

	createSurfacePointer(() => root, {
		onPointerDown: (point) => selectAt(point),
	})

	onMount(() => {
		window.addEventListener("keydown", onKeyDown)
		window.addEventListener("keyup", onKeyUp)
		window.addEventListener("blur", onBlur)
		onCleanup(() => {
			window.removeEventListener("keydown", onKeyDown)
			window.removeEventListener("keyup", onKeyUp)
			window.removeEventListener("blur", onBlur)
		})
	})

	// Replace the selection with the topmost shape under the pointer (or clear
	// it on empty space); shift-click instead toggles that shape.
	function selectAt(point: Point) {
		if (!active()) return
		const focus = focusHandle()
		if (!focus) return

		const hit = topmostHit(point)
		focus.change((doc) => {
			if (!doc.selection) doc.selection = {}
			if (shiftDown) {
				if (!hit) return
				if (doc.selection[hit]) delete doc.selection[hit]
				else doc.selection[hit] = true
			} else {
				doc.selection = hit ? {[hit]: true} : {}
			}
		})
	}

	// The ref of the shape with the greatest `z` under `point`, if any.
	function topmostHit(point: Point): string | undefined {
		let best: {ref: string; z: number} | undefined
		for (const entry of registry.values()) {
			const shapes = entry.getDoc()?.shapes ?? []
			shapes.forEach((shape, index) => {
				if (!hitTestShape(shape, point)) return
				const z = shape.z ?? 0
				if (!best || z >= best.z) best = {ref: shapeRef(entry.url, index), z}
			})
		}
		return best?.ref
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key === "Shift") {
			shiftDown = true
			return
		}
		if (!active()) return
		if (event.key !== "Backspace" && event.key !== "Delete") return
		const focus = focusHandle()
		const selected = focusDoc()?.selection
		if (!focus || !selected || Object.keys(selected).length === 0) return
		event.preventDefault()
		deleteSelected(selected)
		focus.change((doc) => {
			doc.selection = {}
		})
	}

	// Remove every selected shape from every layer, splicing from the highest
	// index down so earlier indices stay valid.
	function deleteSelected(selected: Record<string, true>) {
		for (const entry of registry.values()) {
			const handle = entry.getHandle()
			if (!handle) continue
			const shapes = entry.getDoc()?.shapes ?? []
			const indices: number[] = []
			for (let i = 0; i < shapes.length; i++) {
				if (selected[shapeRef(entry.url, i)]) indices.push(i)
			}
			if (indices.length === 0) continue
			handle.change((doc) => {
				for (let k = indices.length - 1; k >= 0; k--) doc.shapes.splice(indices[k], 1)
			})
		}
	}

	function onKeyUp(event: KeyboardEvent) {
		if (event.key === "Shift") shiftDown = false
	}
	function onBlur() {
		shiftDown = false
	}

	return (
		<div ref={root} class="select-overlay">
			<svg class="select-overlay-svg" width="100%" height="100%">
				<For each={props.layers()}>
					{([, url]) => (
						<LayerProbe
							url={url}
							isSelected={(index) => Boolean(selection()[shapeRef(url, index)])}
							register={(entry) => registry.set(entry.url, entry)}
							unregister={(layerUrl) => registry.delete(layerUrl)}
						/>
					)}
				</For>
			</svg>
		</div>
	)
}

// Subscribes to a single layer: registers its live accessors for the engine
// and renders a highlight for each of its selected shapes.
function LayerProbe(props: {
	url: AutomergeUrl
	isSelected: (index: number) => boolean
	register: (entry: LayerEntry) => void
	unregister: (url: AutomergeUrl) => void
}): JSX.Element {
	const [doc, handle] = useDocument<PaperLayerDoc>(() => props.url)

	props.register({url: props.url, getDoc: doc, getHandle: () => handle()})
	onCleanup(() => props.unregister(props.url))

	const shapes = () => doc()?.shapes ?? []

	return (
		<For each={shapes()}>
			{(shape, index) => (
				<Show when={props.isSelected(index())}>
					<SelectionHighlight shape={shape} />
				</Show>
			)}
		</For>
	)
}

// Draws the resolved outline of a selected shape as a highlight. Rectangles and
// polygons close; lines stay open. Works for any outline variant, including the
// ones derived from legacy shapes.
function SelectionHighlight(props: {shape: Shape}): JSX.Element {
	const points = createMemo(() => {
		const outline = resolveOutline(props.shape)
		if (!outline) return undefined
		const local = outlinePoints(outline)
		return {
			closed: outline.type !== "line",
			value: local
				.map((p) => `${props.shape.x + p.x},${props.shape.y + p.y}`)
				.join(" "),
		}
	})

	return (
		<Show when={points()}>
			{(pts) => (
				<Show
					when={pts().closed}
					fallback={<polyline class="select-highlight" points={pts().value} />}
				>
					<polygon class="select-highlight" points={pts().value} />
				</Show>
			)}
		</Show>
	)
}
