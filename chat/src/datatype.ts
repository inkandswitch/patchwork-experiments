import type {ChatDoc} from "./types"

export const ChatDatatype = {
	init(doc: ChatDoc) {
		doc.title = "chitter chatter"
		doc.messages = []
		doc.docs = []
	},
	getTitle(doc: ChatDoc) {
		return doc.title || "chitter chtter"
	},
	setTitle(doc: ChatDoc, title: string) {
		doc.title = title
	},
}
