// Cursor is an opaque string type in automerge v3
export type Comment = {
	id: string
	fromCursor: string
	toCursor: string
	text: string
	timestamp: string // ISO 8601
	author: string
}

export type CommentedEssayDoc = {
	content: string
	comments: Comment[]
}

export const EssayCommentsDatatype = {
	init(doc: CommentedEssayDoc) {
		doc.content = "# Untitled\n\n"
		doc.comments = []
	},

	getTitle(doc: CommentedEssayDoc): string {
		const match = doc.content?.match(/^#\s+(.+)$/m)
		return match ? match[1].trim() : "Untitled"
	},

	setTitle(doc: CommentedEssayDoc, title: string) {
		if (doc.content?.match(/^#\s+.+$/m)) {
			doc.content = doc.content.replace(/^(#\s+).+$/m, `$1${title}`)
		} else {
			doc.content = `# ${title}\n\n${doc.content ?? ""}`
		}
	},
}
