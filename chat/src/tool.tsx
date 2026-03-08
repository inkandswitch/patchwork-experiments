import {render} from "solid-js/web"
import {ChatRoot} from "./components/ChatRoot"
import type {DocHandle} from "@automerge/automerge-repo"
import type {ChatDoc} from "./types"

export function ChatTool(
	handle: DocHandle<ChatDoc>,
	element: HTMLElement
) {
	// Ensure the host element is a positioning context
	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const dispose = render(
		() => <ChatRoot handle={handle} element={element} />,
		element
	)

	return () => {
		dispose()
	}
}
