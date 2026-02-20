export * from "./types"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "chitter",
		name: "chitter chatter",
		icon: "MessageCircle",
		async load() {
			const {ChatDatatype} = await import("./datatype")
			return ChatDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "chitter",
		name: "chitter chatter",
		icon: "MessageCircle",
		supportedDatatypes: ["chat", "chitter"],
		async load() {
			const {Tool} = await import("./tool")
			return Tool
		},
	},
]
