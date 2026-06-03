import {render} from "solid-js/web"
import {For} from "solid-js"
import {RepoContext, useDocument} from "@automerge/automerge-repo-solid-primitives"
import type {ToolRender} from "@inkandswitch/patchwork-plugins"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PaperLayerDoc, Shape} from "../types"
import {resolveOutline} from "../select/geometry"
import "./rect.css"

// Geometry lives in `shape.outline` (a "rectangle" variant); only the visual
// properties sit on the shape itself.
export type RectShape = Shape & {
	outline?: {type: "rectangle"; width: number; height: number}
	fill?: string
	stroke?: string
	strokeWidth?: number
}

// Read width/height from the outline, falling back to legacy fields for
// shapes persisted before outlines existed.
function rectSize(rect: RectShape): {width: number; height: number} {
	const outline = resolveOutline(rect)
	if (outline?.type === "rectangle") return {width: outline.width, height: outline.height}
	return {width: rect.width ?? 120, height: rect.height ?? 120}
}

// A self-contained layer tool. The mount target is the enclosing
// <patchwork-view> content, so we make it a full-canvas overlay. Each shape
// gets its own absolutely positioned svg with a z-index driven by `shape.z`,
// which is what lets shapes interlace across layers.
export const RectLayerTool: ToolRender = (handle, element) => {
	element.classList.add("rect-host")

	const dispose = render(
		() => (
			<RepoContext.Provider value={element.repo}>
				<RectLayer url={(handle as DocHandle<PaperLayerDoc>).url} />
			</RepoContext.Provider>
		),
		element
	)
	return dispose
}

function RectLayer(props: {url: AutomergeUrl}) {
	const [doc] = useDocument<PaperLayerDoc>(() => props.url)
	const shapes = () => (doc()?.shapes ?? []) as RectShape[]

	return (
		<For each={shapes()}>
			{(rect) => (
				<svg class="rect-svg" width="100%" height="100%" style={{"z-index": rect.z}}>
					<rect
						x={rect.x}
						y={rect.y}
						width={rectSize(rect).width}
						height={rectSize(rect).height}
						fill={rect.fill ?? "#9bb3cc"}
						stroke={rect.stroke ?? "#6f8aa6"}
						stroke-width={rect.strokeWidth ?? 2}
						rx={6}
					/>
				</svg>
			)}
		</For>
	)
}
