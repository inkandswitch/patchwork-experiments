import type {ChatDoc} from "./types"
import {BUILTIN_FULL_IDS} from "./lib/plugin-catalog"

// Shared skeleton. `plugins` decides which full-tier features are active — the
// two datatype presets differ ONLY in what they seed here.
function base(doc: ChatDoc, title: string, plugins: string[]) {
	doc.title = title
	doc.messages = []
	doc.docs = []
	doc.plugins = plugins
}

const getTitle = (doc: ChatDoc) => doc.title || "chat"
const setTitle = (doc: ChatDoc, title: string) => {
	doc.title = title
}

// `chat` — the minimal preset: no full-tier plugins. A plain chat that can grow
// itself via `/plugin load`.
export const ChatDatatype = {
	init(doc: ChatDoc) {
		base(doc, "chat " + new Date().toLocaleString(), ["computer"])
	},
	getTitle,
	setTitle,
}

// `chitterchatter` — the everything preset: seeds the full built-in plugin set.
export const ChitterDatatype = {
	init(doc: ChatDoc) {
		base(doc, "chitter chatter " + new Date().toLocaleString(), BUILTIN_FULL_IDS.slice())
	},
	getTitle,
	setTitle,
}
