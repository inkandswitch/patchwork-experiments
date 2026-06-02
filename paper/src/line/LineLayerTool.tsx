import {render} from "solid-js/web"
import {For} from "solid-js"
import {RepoContext, useDocument} from "@automerge/automerge-repo-solid-primitives"
import type {ToolRender} from "@inkandswitch/patchwork-plugins"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {PaperLayerDoc, Shape} from "../types"
import "./line.css"

export type LineShape = Shape & {
	x2: number
	y2: number
	stroke?: string
	strokeWidth?: number
}

// A self-contained layer tool. The mount target is the enclosing
// <patchwork-view> content, so we make it a full-canvas overlay. Each shape
// gets its own absolutely positioned svg with a z-index driven by `shape.z`,
// which is what lets shapes interlace across layers.
export const LineLayerTool: ToolRender = (handle, element) => {
	element.classList.add("line-host")

	const dispose = render(
		() => (
			<RepoContext.Provider value={element.repo}>
				<LineLayer url={(handle as DocHandle<PaperLayerDoc>).url} />
			</RepoContext.Provider>
		),
		element
	)
	return dispose
}

function LineLayer(props: {url: AutomergeUrl}) {
	const [doc] = useDocument<PaperLayerDoc>(() => props.url)
	const shapes = () => (doc()?.shapes ?? []) as LineShape[]

	return (
		<For each={shapes()}>
			{(line) => (
				<svg class="line-svg" width="100%" height="100%" style={{"z-index": line.z}}>
					<line
						x1={line.x}
						y1={line.y}
						x2={line.x2}
						y2={line.y2}
						stroke={line.stroke ?? "#64748b"}
						stroke-width={line.strokeWidth ?? 4}
						stroke-linecap="round"
					/>
				</svg>
			)}
		</For>
	)
}
