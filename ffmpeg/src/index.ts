// FFmpeg plugin for Patchwork
// Audio, video, and image conversion running entirely in the browser
// via ffmpeg compiled to WebAssembly (ffmpeg.wasm).

import {FfmpegDatatype} from "./datatype"

export * from "./types"
export * from "./datatype"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "ffmpeg",
		name: "FFmpeg",
		icon: "Film",
		async load() {
			return FfmpegDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "ffmpeg",
		name: "FFmpeg",
		icon: "Film",
		supportedDatatypes: ["ffmpeg"],
		async load() {
			const {FfmpegTool} = await import("./tool")
			return FfmpegTool
		},
	},
]
