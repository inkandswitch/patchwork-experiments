// A page with the OpenSCAD editor on a local document, for probes/*.mjs.
// No network: an in-memory repo. ?source=<name> picks a sample (samples.ts).

import "@automerge/automerge" // loads automerge's wasm before the repo needs it
import {render} from "solid-js/web"
import {Repo} from "@automerge/automerge-repo"
import {EditorView} from "@codemirror/view"
import {OpenscadEditor} from "../../src/components/OpenscadEditor"
import type {OpenscadDoc} from "../../src/types"
import {SAMPLES} from "./samples"

const name = new URLSearchParams(location.search).get("source") ?? "pack"
const repo = new Repo({network: []})
const handle = repo.create<OpenscadDoc>({title: name, source: SAMPLES[name] ?? SAMPLES.pack, imports: []})

render(() => <OpenscadEditor handle={handle} element={{repo} as never} />, document.getElementById("app")!)

/** What probes read: the code's selection, and the document. */
;(window as any).__harness = {
	selection() {
		const el = document.querySelector(".cm-editor") as HTMLElement | null
		const view = el && EditorView.findFromDOM(el)
		if (!view) return null
		const {from, to} = view.state.selection.main
		return {from, to, text: view.state.sliceDoc(from, to), line: view.state.doc.lineAt(from).number}
	},
	/** put the code's cursor at an offset, as a click in the code would */
	cursor(offset: number) {
		const el = document.querySelector(".cm-editor") as HTMLElement | null
		const view = el && EditorView.findFromDOM(el)
		view?.dispatch({selection: {anchor: offset}, userEvent: "select.pointer"})
	},
	doc: () => handle.doc(),
}
