import {For, Show, createMemo, type JSX} from "solid-js"
import {useDocument} from "@automerge/automerge-repo-solid-primitives"
import {subscribe, subscribeDoc} from "@inkandswitch/patchwork-providers-solid"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import type {PaperLayerDoc, Shape} from "../paper/types"
import type {SurfaceLayers} from "../surface/types"
import {outlinePoints, resolveOutline, shapeRef} from "./geometry"
import "./select.css"

// Mirrors the shared focus document the FocusProvider owns. We only read
// `selection` here; keys are composite `layerUrl#index` strings.
type FocusDoc = {
	selection: Record<string, true>
}

// A full-canvas overlay that draws a highlight on each selected shape. It is
// purely a renderer: it reads the current selection from the focus provider and
// the shapes from each layer (discovered via the `surface:layer` provider), and
// paints dashed outlines. All selection interaction lives in SelectButton.
export function SelectionOverlay(): JSX.Element {
	let root!: HTMLDivElement

	const layers = subscribe<SurfaceLayers>(() => root, {type: "surface:layer"}, {})
	const [focusDoc] = subscribeDoc<FocusDoc>(() => root, {type: "patchwork:focus"})

	const selection = () => focusDoc()?.selection ?? {}

	return (
		<div ref={root} class="select-overlay">
			<svg class="select-overlay-svg" width="100%" height="100%">
				<For each={Object.entries(layers())}>
					{([, url]) => (
						<LayerProbe
							url={url}
							isSelected={(index) => Boolean(selection()[shapeRef(url, index)])}
						/>
					)}
				</For>
			</svg>
		</div>
	)
}

// Subscribes to a single layer and renders a highlight for each of its selected
// shapes.
function LayerProbe(props: {
	url: AutomergeUrl
	isSelected: (index: number) => boolean
}): JSX.Element {
	const [doc] = useDocument<PaperLayerDoc>(() => props.url)
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
