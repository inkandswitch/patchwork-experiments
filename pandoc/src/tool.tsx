import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type {PatchworkViewElement} from "@inkandswitch/patchwork-elements"
import type {PandocDoc} from "./types"
import {PandocEditor} from "./components/PandocTool"

export function PandocTool(
	handle: DocHandle<PandocDoc>,
	element: PatchworkViewElement
) {
	const dispose = render(
		() => <PandocEditor handle={handle} element={element} />,
		element
	)

	return () => {
		dispose()
	}
}
