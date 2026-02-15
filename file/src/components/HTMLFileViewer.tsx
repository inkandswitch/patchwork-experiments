import {createMemo} from "solid-js"
import type {FileDoc} from "../types"
import {isBinaryFileDoc} from "../datatype"

export type HTMLFileDoc = FileDoc & {
	extension: "html" | "htm"
}

export const isHTMLFile = (doc: FileDoc) => {
	return (
		["html", "htm"].includes(doc.extension?.toLowerCase()) ||
		doc.mimeType === "text/html"
	)
}

export function HTMLFileViewer(props: {doc: FileDoc}) {
	const textData = createMemo(() => {
		if (!props.doc) {
			return ""
		}

		if (isBinaryFileDoc(props.doc)) {
			return new TextDecoder().decode(props.doc.content)
		} else {
			return props.doc.content.toString()
		}
	})

	const blobUrl = createMemo(() => {
		const content = textData()
		if (!content) return ""
		const blob = new Blob([content], {type: "text/html"})
		return URL.createObjectURL(blob)
	})

	return (
		<div class="overflow-auto h-full">
			{textData() ? (
				<iframe
					src={blobUrl()}
					style={{width: "100%", height: "100%", border: "none"}}
				/>
			) : (
				<div class="flex items-center justify-center h-full text-gray-500">
					Loading...
				</div>
			)}
		</div>
	)
}
