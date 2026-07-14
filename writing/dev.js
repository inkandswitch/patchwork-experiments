// Dev harness — mounts the prose editor with real CodeMirror (via esm.sh) against a
// local doc, no automerge. For eyeballing rendering + cursor/click behaviour.

import {EditorView, keymap, drawSelection} from "@codemirror/view"
import {history, historyKeymap, defaultKeymap, indentWithTab} from "@codemirror/commands"
import {markdownExtensions} from "./preview.js"
import {STYLE} from "./style.js"

const style = document.createElement("style")
style.textContent = STYLE
document.head.append(style)

const app = document.getElementById("app")
app.className = "prose-tool"
const mount = document.createElement("div")
mount.className = "prose-editor"
app.append(mount)

const doc = `# Prose demo

A paragraph with **bold**, *italic*, \`code\`, ~~strike~~, ==mark== and a [link](https://example.com).

## Lists

- first bullet
- second bullet
	- nested bullet
- [ ] a todo item
- [x] a done item

1. one
2. two

> a quote line
> second quote line

\`\`\`js
function hi(name) {
	return "hello " + name
}
\`\`\`

---

The end of the document.
`

const view = new EditorView({
	doc,
	parent: mount,
	extensions: [
		history(),
		drawSelection(),
		EditorView.lineWrapping,
		...markdownExtensions(),
		keymap.of([...historyKeymap, indentWithTab, ...defaultKeymap]),
	],
})

window.__view = view

// live cursor readout for debugging click/arrow behaviour
function report() {
	const s = view.state.selection.main
	const line = view.state.doc.lineAt(s.head)
	document.getElementById("status").textContent = `pos ${s.head}  line ${line.number} col ${s.head - line.from}  "${line.text}"`
}
view.dom.addEventListener("keyup", report)
view.dom.addEventListener("mouseup", report)
report()
