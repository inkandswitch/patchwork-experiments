// The prose tool: (handle, element) => cleanup. Mounts a CodeMirror editor bound to
// the markdown doc's `content` string and layers on the live-preview extension.
//
// Text sync is hand-rolled on am.splice (like cute.txt) — the doc stays a plain
// markdown string any other tool can open, and remote edits reconcile with a
// minimal diff so local cursors survive.

import {EditorView, keymap, drawSelection} from "@codemirror/view"
import {EditorState, Annotation} from "@codemirror/state"
import {history, historyKeymap, defaultKeymap, indentWithTab} from "@codemirror/commands"
import {splice} from "@automerge/automerge"
import {markdownExtensions} from "./preview.js"
import {STYLE} from "./style.js"

const PATH = ["content"]
const remote = Annotation.define() // automerge -> view reconcile (don't echo back)

function getText(doc) {
	const value = doc?.content
	if (typeof value === "string") return value
	return value && typeof value.toString === "function" ? value.toString() : ""
}

// Push CodeMirror edits into the automerge string as splices (latest offset first).
function pushLocalEdits(handle, update) {
	if (!update.docChanged) return
	if (update.transactions.some(tr => tr.annotation(remote))) return
	const edits = []
	update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		edits.push([fromA, toA - fromA, inserted.toString()])
	})
	if (!edits.length) return
	handle.change(doc => {
		for (let i = edits.length - 1; i >= 0; i--) {
			const [from, del, ins] = edits[i]
			splice(doc, PATH, from, del, ins)
		}
	})
}

// Reconcile a remote/automerge change into the view with the smallest edit.
function reconcile(view, handle) {
	const text = getText(handle.doc())
	const current = view.state.doc.toString()
	if (text === current) return
	let start = 0
	const min = Math.min(text.length, current.length)
	while (start < min && text[start] === current[start]) start++
	let endText = text.length
	let endCur = current.length
	while (endText > start && endCur > start && text[endText - 1] === current[endCur - 1]) {
		endText--
		endCur--
	}
	view.dispatch({
		changes: {from: start, to: endCur, insert: text.slice(start, endText)},
		annotations: remote.of(true),
	})
}

export default function ProseTool(handle, element) {
	element.classList.add("prose-tool")
	const style = document.createElement("style")
	style.textContent = STYLE
	const mount = document.createElement("div")
	mount.className = "prose-editor"
	element.append(style, mount)

	const onChange = () => queueMicrotask(() => reconcile(view, handle))
	handle.on("change", onChange)

	const view = new EditorView({
		doc: getText(handle.doc()),
		parent: mount,
		extensions: [
			history(),
			drawSelection(),
			EditorView.lineWrapping,
			...markdownExtensions(),
			keymap.of([...historyKeymap, indentWithTab, ...defaultKeymap]),
			EditorView.updateListener.of(update => pushLocalEdits(handle, update)),
		],
	})

	return () => {
		handle.off("change", onChange)
		view.destroy()
		mount.remove()
		style.remove()
		element.classList.remove("prose-tool")
	}
}
