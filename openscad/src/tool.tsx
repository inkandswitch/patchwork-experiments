import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import {OpenscadEditor} from "./components/OpenscadEditor"
import type {OpenscadDoc} from "./types"

export function OpenscadTool(
	handle: DocHandle<OpenscadDoc>,
	element: PatchworkViewElement,
) {
	const dispose = render(
		() => <OpenscadEditor handle={handle} element={element} />,
		element,
	)

	return () => {
		dispose()
	}
}
