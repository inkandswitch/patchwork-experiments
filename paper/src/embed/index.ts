export const plugins = [
	{
		type: "patchwork:tool",
		id: "paper-embed",
		name: "Embed Layer",
		icon: "SquareStack",
		supportedDatatypes: ["paper-layer"],
		async load() {
			const {EmbedLayerTool} = await import("./EmbedLayerTool")
			return EmbedLayerTool
		},
	},
]
