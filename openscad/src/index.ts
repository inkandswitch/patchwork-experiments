// OpenSCAD plugin for Patchwork
// A .scad source editor + 3D preview, compiling entirely client-side via
// openscad-wasm (loaded from a CDN on first use).

export type {OpenscadDoc} from "./types"

export const plugins = [
	{
		type: "patchwork:datatype",
		id: "openscad",
		name: "OpenSCAD",
		icon: "Box",
		async load() {
			return (await import("./datatype")).OpenscadDatatype
		},
	},
	{
		type: "patchwork:tool",
		id: "openscad",
		name: "OpenSCAD",
		icon: "Box",
		supportedDatatypes: ["openscad"],
		async load() {
			return (await import("./tool")).OpenscadTool
		},
	},
]
