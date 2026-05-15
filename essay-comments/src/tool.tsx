import {render} from "solid-js/web"
import {Editor} from "./components/Editor"
import type {DocHandle} from "@automerge/automerge-repo"
import type {CommentedEssayDoc} from "./datatype"

export function EssayCommentsTool(
	handle: DocHandle<unknown>,
	element: HTMLElement
) {
	const dispose = render(
		() => <Editor handle={handle as DocHandle<CommentedEssayDoc>} />,
		element
	)
	return () => dispose()
}
