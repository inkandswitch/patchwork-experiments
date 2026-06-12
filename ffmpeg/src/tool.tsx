import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {FfmpegDoc} from "./types"
import {FfmpegEditor} from "./components/FfmpegTool"

export function FfmpegTool(
	handle: DocHandle<FfmpegDoc>,
	element: PatchworkViewElement
) {
	const dispose = render(
		() => <FfmpegEditor handle={handle} element={element} />,
		element
	)

	return () => {
		dispose()
	}
}
