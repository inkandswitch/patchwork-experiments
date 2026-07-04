// The `chitter` datatype — the "everything" preset. Seeds a new chat doc's
// `plugins` array with the full chitter feature set so the base `chat` tool lights
// up every extension when this bundle is loaded. (The base `chat` datatype, in the
// chat bundle, seeds only `["computer"]`.)
//
// Doc shape is the base chat doc (title/messages/docs/plugins). We only need the
// preset ids here; the base tool owns the schema + title helpers.

// The full-tier plugin ids this bundle contributes. Kept explicit (not computed)
// so a freshly-created chitter doc is self-describing and reproducible.
export const CHITTER_FULL_IDS: string[] = [
	// features
	"reactions",
	"sidebar",
	"voice",
	"gifSelfie",
	"emoticons",
	"call",
	"notifications",
	// the computer feature lives in the base `chat` bundle but is part of the
	// everything preset too.
	"computer",
	// slash commands
	"me",
	"slap",
	"font",
	"colour",
	"face",
	"marquee",
	"shrug",
	"tableflip",
	"addfont",
	"emoticon",
	// message actions
	"react",
	"delete",
	// parser extensions
	"sub",
	"sup",
	"underline-em",
	"underline",
	"spoiler",
	"inverted",
	"strike",
]

interface ChatDocLike {
	title: string
	messages: unknown[]
	docs: unknown[]
	plugins: string[]
}

export const ChitterDatatype = {
	init(doc: ChatDocLike) {
		doc.title = "chitter chatter " + new Date().toLocaleString()
		doc.messages = []
		doc.docs = []
		doc.plugins = CHITTER_FULL_IDS.slice()
	},
	getTitle: (doc: ChatDocLike) => doc.title || "chat",
	setTitle: (doc: ChatDocLike, title: string) => {
		doc.title = title
	},
}
