import type {AutomergeUrl} from "@automerge/automerge-repo"

/** A reference to a document used as conversion input. */
export type FfmpegInput = {
	/** File name as seen by ffmpeg, e.g. "clip.mp4" or "overlay.png" */
	name: string
	url: AutomergeUrl
	/**
	 * For non-file docs: path to the value inside the doc to use as content
	 * (e.g. ["recording"]). Omitted for file docs.
	 */
	path?: string[]
}

/** A converted output that was saved back into Patchwork. */
export type FfmpegOutput = {
	name: string
	url: AutomergeUrl
}

/** The ffmpeg tool's document. */
export type FfmpegDoc = {
	"@patchwork"?: {type: string}
	title?: string
	/** Files available to ffmpeg (one main + resources like overlays/subtitles). */
	inputs: FfmpegInput[]
	/** Index into inputs of the file to convert. */
	mainInput?: number
	/** Target format (file extension), e.g. "mp4", "mp3", "gif". */
	to: string
	/** Extra ffmpeg arguments inserted between -i and the output file. */
	args?: string
	outputs: FfmpegOutput[]
}

/** Shape of Patchwork file docs (UnixFileEntry-ish) we read and create. */
export type FileDocShape = {
	"@patchwork"?: {type: string}
	name?: string
	title?: string
	extension?: string
	mimeType?: string
	content?: unknown
}
