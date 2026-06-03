import {render} from "solid-js/web"
import {For} from "solid-js"
import {RepoContext, useDocument} from "@automerge/automerge-repo-solid-primitives"
import type {ToolElement, ToolRender} from "@inkandswitch/patchwork-plugins"
import type {DocHandle} from "@automerge/automerge-repo"
import "@inkandswitch/patchwork-elements"
import type {PaperDoc} from "./types"
import {SurfaceProvider} from "../surface/SurfaceProvider"
import {LineButton} from "../line/LineButton"
import {RectButton} from "../rect/RectButton"
import {SelectButton} from "../select/SelectButton"
import {SelectionOverlay} from "../select/SelectionOverlay"
import "./paper.css"

const VERSION = "0.0.4"

// The surface tool: wraps the stack of layer <patchwork-view>s in a
// SurfaceProvider so the layer buttons can drive the canvas purely through the
// provider protocol.
export const PaperTool: ToolRender = (handle, element) => {
	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => (
			<RepoContext.Provider value={element.repo}>
				<PaperSurface handle={handle as DocHandle<PaperDoc>} element={element} />
			</RepoContext.Provider>
		),
		element
	)
	return dispose
}

function PaperSurface(props: {handle: DocHandle<PaperDoc>; element: ToolElement}) {
	const [doc] = useDocument<PaperDoc>(() => props.handle.url)
	const layers = () => Object.entries(doc()?.layers ?? {})

	return (
		<div class="paper-canvas">
			<SurfaceProvider element={props.element} paper={props.handle}>
				<For each={layers()}>
					{([toolId, url]) => (
						<patchwork-view doc-url={url} tool-id={`paper-${toolId}`} />
					)}
				</For>
				<SelectionOverlay layers={layers} />
				<div class="paper-controls" data-surface-no-draw>
					<SelectButton />
					<RectButton />
					<LineButton />
				</div>
			</SurfaceProvider>
			<div class="paper-version">v{VERSION}</div>
		</div>
	)
}
