import type {ChatDoc} from "./types"

export const ChatDatatype = {
	init(doc: ChatDoc) {
		doc.title = "chitter chatter " + new Date().toLocaleString()
		doc.messages = []
		doc.docs = []
	},
	getTitle(doc: ChatDoc) {
		return doc.title || "chitter chatter"
	},
	setTitle(doc: ChatDoc, title: string) {
		doc.title = title
	},
}
