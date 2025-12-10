import type {Plugin, Tool} from "@inkandswitch/patchwork-plugins"

export const plugins: Plugin<any>[] = [
	{
		type: "patchwork:tool",
		id: "raw",
		name: "Raw",
		supportedDatatypes: "*",
		async load() {
			const {TinyTool} = await import("./components/RawEditor")
			return TinyTool
		},
	} satisfies Tool,
]
