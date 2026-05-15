import {render} from "solid-js/web"
import {EssayEditor} from "./components/EssayEditor"
import type {DocHandle} from "@automerge/automerge-repo"
import type {MarkdownDoc} from "./datatype"

export function EssayTool(handle: DocHandle<MarkdownDoc>, element: HTMLElement) {
	const dispose = render(() => <EssayEditor handle={handle} />, element)
	return () => dispose()
}
