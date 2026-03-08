import {onCleanup} from "solid-js"
import {EditorView} from "@codemirror/view"
import {minimalSetup} from "codemirror"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import type {FileDoc} from "../types"

export const isTextFile = (doc: FileDoc) => {
	return (
		doc?.mimeType?.match("text/") ||
		doc?.mimeType?.match("application/json") ||
		doc?.mimeType?.match("application/javascript")
	)
}

export function TextFileEditor(props: {doc: FileDoc; handle: any}) {
	let container!: HTMLDivElement

	const view = new EditorView({
		doc: props.doc.content?.toString() || "",
		extensions: [
			minimalSetup,
			EditorView.lineWrapping,
			EditorView.theme({
				"&": {height: "100%", fontSize: "16px"},
				".cm-scroller": {
					overflow: "auto",
					fontFamily: "monospace",
				},
			}),
			automergeSyncPlugin({handle: props.handle, path: ["content"]}),
		],
	})

	onCleanup(() => {
		view.destroy()
	})

	return (
		<div
			ref={(el) => {
				container = el
				el.appendChild(view.dom)
			}}
			style={{
				width: "100%",
				height: "100%",
			}}
		/>
	)
}
