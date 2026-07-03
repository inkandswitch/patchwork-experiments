import type {AutomergeUrl} from "@automerge/automerge-repo"

/** A reference to a document used as conversion input. */
export type PandocInput = {
	/** Path-like name as seen by pandoc, e.g. "paper.md" or "img/figure1.png" */
	name: string
	url: AutomergeUrl
	/**
	 * For non-file docs: path to the value inside the doc to use as content
	 * (e.g. ["content"]). Omitted for file docs / whole-doc JSON inputs.
	 */
	path?: string[]
}

/** A converted output that was saved back into Patchwork. */
export type PandocOutput = {
	name: string
	url: AutomergeUrl
}

export type PandocDoc = {
	"@patchwork"?: {type: string}
	title?: string
	/** All input files; one is the main document, the rest are resources (images, bibliographies, ...) */
	inputs: PandocInput[]
	/** Index into inputs of the document to convert. */
	mainInput?: number
	/** "auto" or a pandoc reader name */
	from: string
	/** "auto" or a pandoc writer name */
	to: string
	standalone: boolean
	outputs: PandocOutput[]
}

/** Shape of file docs we create / read (matches @patchwork/file's UnixFileEntry). */
export type FileDocShape = {
	"@patchwork"?: {type: string}
	name?: string
	title?: string
	extension?: string
	mimeType?: string
	content?: unknown
}

/** Per-source conversion settings, remembered across focus changes. */
export type PandocSourceSettings = {
	/** pandoc reader name override */
	from?: string
	/** pandoc writer name override */
	to?: string
	/** For non-file docs: path to the value inside the doc to use as content. */
	path?: string[]
	/** For non-file docs: convert the whole document as JSON. */
	whole?: boolean
}

/**
 * Account-linked settings doc for the Pandoc context sidebar. Remembers the
 * output-format choice per source document so it follows you across focus.
 */
export type PandocContextDoc = {
	"@patchwork"?: {type: string}
	title?: string
	/** keyed by source documentId */
	sources: Record<string, PandocSourceSettings>
}

/** The bit of the account doc the context sidebar reads/writes. */
export type AccountDocShape = {
	pandocContextUrl?: AutomergeUrl
}
