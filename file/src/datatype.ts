// File datatype implementation

import {isImmutableString} from "@automerge/automerge-repo"
import {BinaryFileDoc, FileDoc, TextFileDoc} from "./types"

export function isBinaryFileDoc(doc: FileDoc): doc is BinaryFileDoc {
	return doc.content instanceof Uint8Array
}

export function isTextFileDoc(doc: FileDoc): doc is TextFileDoc {
	return typeof doc.content === "string"
}

export const isImmutableStringFileDoc = (doc: FileDoc): boolean => {
	return isImmutableString(doc.content)
}

// Get file contents as string or Uint8Array
export const getFileContents = (doc: FileDoc): string | Uint8Array => {
	if (isBinaryFileDoc(doc)) {
		return doc.content
	} else if (typeof doc.content === "string") {
		return doc.content
	} else if (
		"toString" in doc.content &&
		typeof doc.content.toString == "function"
	) {
		const content = doc.content
		return content.toString()
	} else {
		throw new Error("Unsupported file content type")
	}
}

// Datatype implementation
export const FileDatatype = {
	init(doc: FileDoc) {
		doc.name = ""
		doc.extension = ""
		doc.mimeType = ""
		doc.content = ""
	},

	setTitle(doc: FileDoc, title: string) {
		doc.name = title
	},

	getTitle(doc: FileDoc) {
		return doc.name || "Untitled File"
	},
}
