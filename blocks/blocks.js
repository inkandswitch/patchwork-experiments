// Blocks — a markdown block editor for Patchwork `file` documents.
//
// Renders `doc.content` (markdown) as a column of draggable blocks. Drag a
// block onto the canvas on the right to "set it aside": the block is NOT
// removed from the document — it is wrapped in a `:::aside x=.. y=..` fence
// in place (so Automerge cursors/comments anchored inside it survive) and
// simply hidden from the main flow while shown on the canvas.
//
// All edits go through minimal Automerge splices on the `content` string, so
// the document stays a plain markdown file that any other tool can open.

export const plugins = [
	{
		type: "patchwork:tool",
		id: "markdown-blocks",
		name: "Markdown Blocks",
		icon: "LayoutList",
		supportedDatatypes: ["markdown"],
		async load() {
			return (await import("./tool.js")).default
		},
	},
]
