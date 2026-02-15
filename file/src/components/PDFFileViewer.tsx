import {createMemo} from "solid-js"
import type {FileDoc} from "../types"
import {createBinaryUrl} from "../utils"
import {isBinaryFileDoc} from "../datatype"

export type PDFFileDoc = FileDoc & {
	extension: "pdf"
	mimeType: "application/pdf"
}

export const isPDFFile = (doc: FileDoc): doc is PDFFileDoc => {
	return (
		doc.extension?.toLowerCase() === "pdf" || doc.mimeType === "application/pdf"
	)
}

export function PDFFileViewer(props: {doc: FileDoc}) {
	const pdfUrl = createMemo(() => {
		if (isBinaryFileDoc(props.doc)) {
			return createBinaryUrl(props.doc.content)
		}
		return undefined
	})

	return (
		<div class="overflow-auto h-full">
			{pdfUrl() ? (
				<iframe
					src={pdfUrl()}
					style={{width: "100%", height: "100%", border: "none"}}
					title={props.doc.name}
				/>
			) : (
				<div class="flex items-center justify-center h-full text-gray-500">
					No PDF to display
				</div>
			)}
		</div>
	)
}
