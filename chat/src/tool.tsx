import {render} from "solid-js/web"
import type {DocHandle} from "@automerge/automerge-repo"
import type {ChatDoc} from "./types"
import {Chat} from "./Chat"
import {createStyles} from "./styles"

export function Tool(
	handle: DocHandle<ChatDoc>,
	element: HTMLElement
) {
	const style = createStyles()
	element.appendChild(style)

	const dispose = render(
		() => <Chat handle={handle} element={element} />,
		element
	)

	return () => {
		dispose()
		style.remove()
	}
}
