/**
 * Call — Patchwork datatype and tool definitions.
 *
 * @typedef {Object} CallDoc
 * @property {string} content - Transcription text
 * @property {string} title - Document title
 */

export const CallDatatype = {
	init(doc) {
		doc.title = "Call"
		doc.content = ""
	},

	getTitle(doc) {
		return doc.title || "Call"
	},

	setTitle(doc, title) {
		doc.title = title
	},
}

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "call",
		name: "Call",
		icon: "Video",
		async load() {
			return CallDatatype
		},
	},
	{
		// The base `chat` tool's call feature, extracted here as a real plugin:
		// contributes the presence-bar call button and folds the transcript into the
		// assistant's context. Discovered via the shared registry when active.
		type: "chat:feature",
		id: "call",
		name: "Voice/video call",
		tier: "full",
		async load() {
			return (await import("./chat-call.js")).callFeature()
		},
	},
	{
		// `/call` (and `/call transcript`). A self-contained slash command whose
		// behaviour rides behind `run` — the base dispatches it generically with the
		// SlotContext, no hardcoded case in the host.
		type: "chat:slash",
		id: "call",
		cmd: "/call",
		usage: "/call [transcript]",
		desc: "Start a voice/video call in this chat (or /call transcript to pin it)",
		tier: "full",
		async load() {
			return {run: (await import("./chat-call.js")).callSlashRun}
		},
	},
	{
		type: "patchwork:tool",
		id: "telephone",
		name: "Telephone",
		icon: "Video",
		supportedDatatypes: ["call"],
		async load() {
			const {default: TelephoneTool} = await import("./telephone.js")
			return TelephoneTool
		},
	},
	{
		type: "patchwork:tool",
		id: "call-titlebar",
		name: "Call Titlebar",
		icon: "Video",
		supportedDatatypes: "*",
		unlisted: true,
		tags: ["titlebar-tool"],
		async load() {
			const {default: CallTitlebarTool} = await import("./call-titlebar.js")
			return CallTitlebarTool
		},
	},
	{
		type: "patchwork:tool",
		id: "teleprint",
		name: "Teleprint",
		icon: "FileText",
		supportedDatatypes: ["call"],
		async load() {
			const {default: TeleprintTool} = await import("./teleprint.js")
			return TeleprintTool
		},
	},
]
