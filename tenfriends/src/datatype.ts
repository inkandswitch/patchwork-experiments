export interface TenfriendDoc {
	user: string
	"@patchwork": {type: string}
}

export const TenfriendDatatype = {
	init(doc: TenfriendDoc) {
		doc.user = ""
	},

	getTitle(doc: TenfriendDoc) {
		return doc.user || "New Tenfriend"
	},

	setTitle(doc: TenfriendDoc, title: string) {
		doc.user = title
	},
}
