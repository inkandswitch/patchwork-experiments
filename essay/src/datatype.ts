export type MarkdownDoc = {
	content: string
}

export const EssayDatatype = {
	init(doc: MarkdownDoc) {
		doc.content = "# Untitled\n\n"
	},

	getTitle(doc: MarkdownDoc): string {
		const match = doc.content?.match(/^#\s+(.+)$/m)
		return match ? match[1].trim() : "Untitled"
	},

	setTitle(doc: MarkdownDoc, title: string) {
		if (doc.content?.match(/^#\s+.+$/m)) {
			doc.content = doc.content.replace(/^(#\s+).+$/m, `$1${title}`)
		} else {
			doc.content = `# ${title}\n\n${doc.content ?? ""}`
		}
	},
}
