export const LoomDatatype = {
	init(doc) {
		doc.title = "Loom"
		doc.content = ""
	},
	getTitle(doc) {
		return doc.title || "Loom"
	},
	setTitle(doc, title) {
		doc.title = title
	},
	markCopy(doc) {
		doc.title = "Copy of " + this.getTitle(doc)
	},
}
