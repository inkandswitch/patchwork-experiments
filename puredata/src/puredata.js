/**
 * Puredata — Patchwork datatype and tool definitions.
 *
 * @typedef {Object} PureDataDoc
 * @property {string} title - Document title
 * @property {string} patch - Automerge URL to UnixFileEntry doc (empty = new patch)
 */

export const PureDataDatatype = {
	init(doc) {
		doc.title = "Puredata"
		doc.patch = ""
	},

	getTitle(doc) {
		return doc.title || "Puredata"
	},

	setTitle(doc, title) {
		doc.title = title
	},
}

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "puredata",
		name: "Puredata",
		icon: "Cable",
		async load() {
			return PureDataDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "puredata",
		name: "Puredata",
		icon: "Cable",
		supportedDatatypes: ["puredata"],
		async load() {
			const { default: PdEditorTool } = await import("./pd-editor.js")
			return PdEditorTool
		},
	},
]
