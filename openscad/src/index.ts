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
		// package). Everything but load() is plain data: the host reads this
		// `plugins` array in a worker, so it must survive structuredClone.
		// build() itself runs on the main thread (src/scene/source.ts), and the
		// render engine it calls starts its own worker for OpenSCAD.
		type: "scene:source",
		id: "openscad-model",
		name: "OpenSCAD model",
		icon: "Box",
		supportedDatatypes: ["openscad"],
		// A source edit re-runs OpenSCAD, so debounce it like an expensive
		// build even though `unit` is cheap.
		cost: "expensive",
		// Bump when build() makes different output from the same doc and
		// params; renders built by an older version (or none) go stale once.
		// The fingerprint stays content-only. v1: the Manifold backend.
		version: 1,
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
				// the engine caches STLs by source + imports, so a unit
				// change only re-encodes
				cost: "cheap",
			},
		],
		async load() {
			return (await import("./scene/source")).default
		},
	},
]
