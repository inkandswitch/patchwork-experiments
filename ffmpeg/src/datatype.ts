import type {FfmpegDoc} from "./types"

export const FfmpegDatatype = {
	init(doc: FfmpegDoc) {
		doc["@patchwork"] = {type: "ffmpeg"}
		doc.title = "FFmpeg"
		doc.inputs = []
		// overwritten by detection when the first input is added
		doc.to = "mp4"
		doc.outputs = []
	},

	setTitle(doc: FfmpegDoc, title: string) {
		doc.title = title
	},

	getTitle(doc: FfmpegDoc) {
		return doc.title || "FFmpeg"
	},
}
