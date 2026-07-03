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
	{
		// Context-sidebar variant: previews and converts whatever document is
		// currently focused, and lets you pull the conversion out into Patchwork.
		// Registered against the account doc (its handle) like other context tools.
		type: "patchwork:tool",
		id: "pandoc-context",
		name: "Pandoc",
		icon: "ArrowLeftRight",
		tags: ["context-tool"],
		supportedDatatypes: ["account"],
		async load() {
			const {PandocContextTool} = await import("./components/PandocContextTool")
			return PandocContextTool
		},
	},
]
