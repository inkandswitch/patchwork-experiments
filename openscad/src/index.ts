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
	{
		// Renders an OpenSCAD doc into a 3D scene (see the patchwork "scene"
		// package). Metadata only up here: this module also runs in a worker.
		type: "scene:source",
		id: "openscad-model",
		name: "OpenSCAD model",
		icon: "Box",
		supportedDatatypes: ["openscad"],
		// Optional scene-host extension: a source edit re-runs OpenSCAD, so
		// debounce it like an expensive build even though `unit` is cheap.
		cost: "expensive",
		params: [
			{
				key: "unit",
				label: "Units",
				kind: "enum",
				default: "mm",
				options: [
					{value: "mm", label: "Millimetres"},
					{value: "cm", label: "Centimetres"},
					{value: "m", label: "Metres"},
					{value: "in", label: "Inches"},
				],
				// the last STL is cached, so a unit change only re-encodes
				cost: "cheap",
			},
		],
		async load() {
			return (await import("./scene/source")).default
		},
	},
]
