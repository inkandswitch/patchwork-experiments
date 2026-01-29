import type {
	LoadablePlugin,
	ToolDescription,
	ToolImplementation,
} from "@inkandswitch/patchwork-plugins"

export const plugins: LoadablePlugin<any>[] = [
	{
		type: "patchwork:tool",
		id: "raw",
		name: "Raw",
		supportedDataTypes: "*",
		async load() {
			const {TinyTool} = await import("./components/RawEditor")
			return TinyTool
		},
	} satisfies LoadablePlugin<ToolDescription, ToolImplementation>,
]
