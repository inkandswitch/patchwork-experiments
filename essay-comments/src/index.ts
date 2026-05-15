import type {
	ToolDescription,
	ToolImplementation,
} from "@inkandswitch/patchwork-plugins"
import type {LoadablePlugin} from "@inkandswitch/patchwork-plugins"

export const plugins: LoadablePlugin<any>[] = [
	{
		type: "patchwork:datatype",
		id: "essay-comments",
		name: "Essay with Comments",
		icon: "MessageSquare",
		async load() {
			const {EssayCommentsDatatype} = await import("./datatype")
			return EssayCommentsDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "essay-comments",
		name: "Essay with Comments",
		icon: "MessageSquare",
		supportedDatatypes: ["essay-comments"],
		async load(): Promise<ToolImplementation> {
			const {EssayCommentsTool} = await import("./tool")
			return EssayCommentsTool
		},
	} satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
]
