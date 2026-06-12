// Pandoc plugin for Patchwork
// Any-to-any document conversion running entirely in the browser
// via pandoc compiled to WebAssembly.

import {PandocDatatype} from "./datatype"

export * from "./types"
export * from "./datatype"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "pandoc",
		name: "Pandoc",
		icon: "ArrowLeftRight",
		async load() {
			return PandocDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "pandoc",
		name: "Pandoc",
		icon: "ArrowLeftRight",
		supportedDatatypes: ["pandoc"],
		async load() {
			const {PandocTool} = await import("./tool")
			return PandocTool
		},
	},
]
