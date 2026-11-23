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
		content: "built",
		name: "OpenSCAD model",
		icon: "Box",
		supportedDatatypes: ["openscad"],
		// A source edit re-runs OpenSCAD, so debounce it like an expensive
		// build even though `unit` is cheap.
		cost: "expensive",
		// Bump when build() makes different output from the same doc and
		// params; renders built by an older version (or none) go stale once.
		// The fingerprint stays content-only. v1: the Manifold backend.
		// v2: colours (a primitive per color()). v3: the vendored engine,
		// OpenSCAD 2026.11.20 with Manifold 3.5.4. v4: a node per part, named
		// by the module that placed it, its source in extras.source.
		version: 4,
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
				// the engine caches models by source + imports, so a unit
				// change only re-encodes
				cost: "cheap",
			},
		],
		async load() {
			return (await import("./scene/source")).default
		},
	},
	{
		// Editing a model where it stands in a scene: its Open lays the code
		// editor over the scene and draws each render in the object's place
		// (src/scene/editTool.tsx).
		type: "scene:view",
		id: "openscad-scene-edit",
		name: "OpenSCAD editing",
		async load() {
			return (await import("./scene/editTool")).default
		},
	},
]
