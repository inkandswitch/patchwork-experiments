import {PaperDatatype, PaperLayerDatatype} from "./datatype"

// The paper surface owns the "paper" datatype plus the shared "paper-layer"
// datatype that the individual layer tools render.
export const plugins = [
	{
		type: "patchwork:datatype",
		id: "paper",
		name: "Paper",
		icon: "Square",
		async load() {
			return PaperDatatype
		},
	},
	{
		type: "patchwork:datatype",
		id: "paper-layer",
		name: "Paper Layer",
		icon: "Layers",
		async load() {
			return PaperLayerDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "paper",
		name: "Paper",
		icon: "Square",
		supportedDatatypes: ["paper"],
		async load() {
			const {PaperTool} = await import("./PaperTool")
			return PaperTool
		},
	},
]
