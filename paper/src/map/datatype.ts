import type {PaperMapDoc} from "./types"

// The map holds no state of its own; the tool renders fixed OpenFreeMap tiles.
// We keep a title so it shows up sensibly in document lists.
export const PaperMapDatatype = {
	init(doc: PaperMapDoc) {
		doc.title = "Map"
	},
	getTitle(doc: PaperMapDoc) {
		return doc.title || "Map"
	},
	setTitle(doc: PaperMapDoc, title: string) {
		doc.title = title
	},
}
