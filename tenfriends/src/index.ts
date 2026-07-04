import {TenfriendDatatype} from "./datatype"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "tenfriend",
		name: "Tenfriend",
		icon: "Users",
		async load() {
			return TenfriendDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "tenfriend",
		name: "Tenfriend",
		icon: "Users",
		supportedDatatypes: ["tenfriend"],
		async load() {
			const {TenfriendTool} = await import("./tool")
			return TenfriendTool
		},
	},
]
