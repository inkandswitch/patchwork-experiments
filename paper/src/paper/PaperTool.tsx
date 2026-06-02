import {render} from "solid-js/web"
import {For} from "solid-js"
import {RepoContext, useDocument} from "@automerge/automerge-repo-solid-primitives"
import type {ToolRender} from "@inkandswitch/patchwork-plugins"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import "@inkandswitch/patchwork-elements"
import type {PaperDoc} from "../types"
import "./paper.css"

const VERSION = "0.0.1"

// The surface tool: renders each layer as a <patchwork-view>. The example
// layers are seeded by the paper datatype's init, not here.
export const PaperTool: ToolRender = (handle, element) => {
	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => (
			<RepoContext.Provider value={element.repo}>
				<PaperSurface url={(handle as DocHandle<PaperDoc>).url} />
			</RepoContext.Provider>
		),
		element
	)
	return dispose
}

function PaperSurface(props: {url: AutomergeUrl}) {
	const [doc] = useDocument<PaperDoc>(() => props.url)
	return (
		<div class="paper-canvas">
			<For each={doc()?.layers ?? []}>
				{(layer) => (
					<patchwork-view doc-url={layer.url} tool-id={layer.toolId} />
				)}
			</For>
			<div class="paper-version">v{VERSION}</div>
		</div>
	)
}
