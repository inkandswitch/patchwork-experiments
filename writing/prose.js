// prose — a Bear/Typora-style live-preview markdown editor for Patchwork.
//
// Renders a `markdown` doc's `content` string in place: the markup delimiters live
// in the plain text (`# `, `- `, `**bold**`) and are hidden + the inner text styled,
// revealing back to raw source wherever the caret is. The doc stays a plain markdown
// string, so any other markdown tool can open it too.
//
// Only a tool is registered here — the `markdown` datatype is provided elsewhere.

export const plugins = [
	{
		type: "patchwork:tool",
		id: "writing",
		name: "Writing",
		icon: "NotebookPen",
		supportedDatatypes: ["markdown"],
		async load() {
			return (await import("./tool.js")).default
		},
	},
]
