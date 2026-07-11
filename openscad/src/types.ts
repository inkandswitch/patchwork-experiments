import type {AutomergeUrl} from "@automerge/automerge-repo"

/**
 * A reference to another Automerge document whose data should be made
 * available inside the .scad source as `name` (via OpenSCAD's experimental
 * `import()`-as-data feature). See `src/imports.ts` for how `name` is
 * derived/kept unique, and `src/render/worker.ts` for how it's wired into
 * the WASM filesystem before compiling.
 */
export type OpenscadImport = {
	/** valid OpenSCAD identifier; bound to `import("imports/<name>.json")` */
	name: string
	docUrl: AutomergeUrl
	/** display label captured at drop time (e.g. the source doc's title) */
	label?: string
}

export type OpenscadDoc = {
	title?: string
	/** the .scad source, edited collaboratively via CodeMirror + automerge */
	source: string
	/** docs dragged in from the sidebar, exposed to `source` as JSON data */
	imports?: OpenscadImport[]
}
