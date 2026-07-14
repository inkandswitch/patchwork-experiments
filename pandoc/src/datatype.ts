import type {PandocDoc} from "./types"

export const PandocDatatype = {
	init(doc: PandocDoc) {
		doc["@patchwork"] = {type: "pandoc"}
		doc.title = "Pandoc"
		doc.inputs = []
		// overwritten by detection when the first input is added
		doc.from = "markdown"
		doc.to = "html"
		doc.standalone = true
		doc.outputs = []
	},

	setTitle(doc: PandocDoc, title: string) {
		doc.title = title
	},

	getTitle(doc: PandocDoc) {
		return doc.title || "Pandoc"
	},
}
