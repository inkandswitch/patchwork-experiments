import {createSignal, onCleanup} from "solid-js"
import type {FileDoc} from "../types"

export const isTextFile = (doc: FileDoc) => {
	return (
		doc?.mimeType?.match("text/") ||
		doc?.mimeType?.match("application/json") ||
		doc?.mimeType?.match("application/javascript")
	)
}

export function TextFileEditor(props: {doc: FileDoc; handle: any}) {
	const [content, setContent] = createSignal(
		props.doc.content?.toString() || ""
	)

	const handleInput = (e: InputEvent) => {
		const target = e.target as HTMLTextAreaElement
		const newContent = target.value
		setContent(newContent)

		// Update document through handle
		props.handle.change((doc: FileDoc) => {
			doc.content = newContent
		})
	}

	// Listen for external changes
	const updateFromDoc = () => {
		const doc = props.handle.doc()
		if (doc) {
			setContent(doc.content?.toString() || "")
		}
	}

	props.handle.on("change", updateFromDoc)

	onCleanup(() => {
		props.handle.off("change", updateFromDoc)
	})

	return (
		<textarea
			style={{
				width: "100%",
				height: "100%",
				padding: "0.25em",
				border: 0,
				"font-family": "monospace",
				"font-size": "16px",
				outline: "none",
			}}
			value={content()}
			onInput={handleInput}
			placeholder="Enter text content..."
		/>
	)
}
