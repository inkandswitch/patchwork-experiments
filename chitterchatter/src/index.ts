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
]
