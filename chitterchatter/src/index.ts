import {ChatDatatype} from "./datatype"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "chitterchatter",
		name: "Chitter chatter",
		icon: "MessageCircle",
		async load() {
			return ChatDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "chitterchatter",
		name: "Chitter chatter",
		icon: "MessageCircle",
		supportedDatatypes: ["chitterchatter", "chat"],
		async load() {
			const {ChatTool} = await import("./tool")
			return ChatTool
		},
	},
	{
		// Streamlined context-sidebar variant: no sidebar, chats about whatever
		// document is focused (chat stored at focusedDoc['@patchwork'].chitchat),
		// and the computer edits that document via universal Automerge ops.
		type: "patchwork:component",
		id: "chitterchatter-context",
		name: "Chitchat",
		icon: "MessageCircle",
		tags: ["context-tool"],
		async load() {
			const {ChatContextComponent} = await import("./context-tool")
			return ChatContextComponent
		},
	},
]
