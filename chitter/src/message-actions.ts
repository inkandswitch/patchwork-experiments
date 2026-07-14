// The full-tier hover-bar actions (the base keeps only core `reply`). Each has a
// `name` title. Registered as descriptions: metadata (incl. the SVG `icon` string)
// rides raw; the `run`/`show` functions live behind `async load()`.

const REACT_ICON =
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>'
const TRASH_ICON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'

export interface MessageActionPlugin {
	type: "chat:messageaction"
	id: string
	name: string
	icon: string
	tier: "core" | "full"
	show?: (msg: any) => boolean
	run?: (ctx: any) => void
}

export const messageActionPlugins: MessageActionPlugin[] = [
	{
		type: "chat:messageaction", id: "react", name: "Add reaction", icon: REACT_ICON, tier: "full",
		run: (ctx) => ctx.onReact(ctx.rawIdx, ctx.anchorEl),
	},
	{
		type: "chat:messageaction", id: "delete", name: "Delete", icon: TRASH_ICON, tier: "full",
		run: (ctx) => ctx.onDelete(ctx.rawIdx),
	},
]

// Serializable descriptions: metadata (incl. `icon`) + `async load()` for the fns.
export const messageActionDescriptions = messageActionPlugins.map((p) => {
	const {show, run, ...meta} = p
	return {...meta, async load() { return {show, run}}}
})
