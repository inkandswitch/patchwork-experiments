import {ChatDatatype} from "./datatype"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "chat",
		name: "Chat",
		icon: "MessageCircle",
		async load() {
			return ChatDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "chat",
		name: "Chat",
		icon: "MessageCircle",
		supportedDatatypes: ["chat"],
		async load() {
			const {ChatTool} = await import("./tool")
			return ChatTool
		},
	},
]
