// File document types

import {ImmutableString} from "@automerge/automerge-repo"
import {UnixFileEntry} from "@inkandswitch/patchwork-filesystem"

export type TextFileDoc = {
	name: string
	extension: string
	mimeType: string
	content: string
}

export type BinaryFileDoc = {
	name: string
	extension: string
	mimeType: string
	content: Uint8Array
}

export type ImmutableStringFileDoc = {
	name: string
	extension: string
	mimeType: string
	content: ImmutableString
}

export type FileDoc = UnixFileEntry

// Conservatively use LongTextFileContent for text files longer than 100KB.
export const LONG_TEXT_FILE_LENGTH_THRESHOLD = 100000
