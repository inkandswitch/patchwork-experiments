import type {
	ToolDescription,
	ToolImplementation,
} from "@inkandswitch/patchwork-plugins"
import type {LoadablePlugin} from "@inkandswitch/patchwork-plugins"

export const plugins: LoadablePlugin<any>[] = [
	{
		type: "patchwork:datatype",
		id: "essay",
		name: "Essay",
		icon: "FileText",
		async load() {
			const {EssayDatatype} = await import("./datatype")
			return EssayDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "essay",
		name: "Essay",
		icon: "FileText",
		supportedDatatypes: ["essay"],
		async load(): Promise<ToolImplementation> {
			const {EssayTool} = await import("./tool")
			return EssayTool
		},
	} satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
]
