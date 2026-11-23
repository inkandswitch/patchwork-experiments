import {onCleanup, createSignal, createEffect} from "solid-js"
import {
	EditorView,
	lineNumbers,
	highlightSpecialChars,
	highlightActiveLineGutter,
	highlightActiveLine,
	rectangularSelection,
	keymap,
} from "@codemirror/view"
import {EditorState, Compartment, StateEffect, StateField} from "@codemirror/state"
import {Decoration, type DecorationSet} from "@codemirror/view"
import {
	syntaxHighlighting,
	indentUnit,
	bracketMatching,
	foldGutter,
	foldKeymap,
} from "@codemirror/language"
import {highlightSelectionMatches, searchKeymap} from "@codemirror/search"
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import type {DocHandle} from "@automerge/automerge-repo"
import {draculaTheme, draculaHighlightStyle} from "../dracula"
import {lycheeTheme, lycheeHighlightStyle} from "../lychee"
import type {OpenscadDoc} from "../types"

/** What the rest of the editor can do with the code: show a range of it, and read it. */
export type CodeEditorApi = {
	/** select from..to (offsets, clamped to the text) and scroll it to the middle */
	reveal(from: number, to: number): void
	text(): string
}

/**
 * The range a view revealed (a part's call, a module's definition), marked
 * so it shows without the editor's focus; gone at the next edit or the next
 * selection you make.
 */
const setRevealed = StateEffect.define<{from: number; to: number} | null>()
const revealedMark = Decoration.mark({class: "cm-openscad-revealed"})
const revealed = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(marks, tr) {
		for (const e of tr.effects) if (e.is(setRevealed)) return e.value && e.value.to > e.value.from ? Decoration.set([revealedMark.range(e.value.from, e.value.to)]) : Decoration.none
		if (tr.docChanged || tr.isUserEvent("select")) return Decoration.none
		return marks
	},
	provide: f => EditorView.decorations.from(f),
})

function isDarkMode() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function CodeEditor(props: {
	source: string
	handle: DocHandle<OpenscadDoc>
	onRenderRequested: () => void
	onReady?: (api: CodeEditorApi) => void
	/** the main cursor moved (an offset), by the keyboard or a click */
	onCursor?: (offset: number) => void
}) {
	const themeCompartment = new Compartment()

	const lightTheme = [lycheeTheme, syntaxHighlighting(lycheeHighlightStyle)]
	const darkTheme = [draculaTheme, syntaxHighlighting(draculaHighlightStyle)]

	const [dark, setDark] = createSignal(isDarkMode())

	const view = new EditorView({
		doc: props.source,
		extensions: [
			lineNumbers(),
			highlightSpecialChars(),
			highlightActiveLineGutter(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			history(),
			foldGutter(),
			bracketMatching(),
			indentUnit.of("  "),
			EditorState.allowMultipleSelections.of(true),
			EditorState.tabSize.of(2),
			EditorView.lineWrapping,
			rectangularSelection(),
			keymap.of([
				{
					key: "Mod-Enter",
					run: () => {
						props.onRenderRequested()
						return true
					},
				},
				indentWithTab,
				...searchKeymap,
				...historyKeymap,
				...foldKeymap,
				...defaultKeymap,
			]),
			themeCompartment.of(dark() ? darkTheme : lightTheme),
			EditorView.theme({
				"&": {height: "100%", fontSize: "13px"},
				".cm-scroller": {overflow: "auto", fontFamily: "var(--openscad-family-code)"},
				".cm-openscad-revealed": {
					backgroundColor: "color-mix(in oklch, var(--openscad-accent, #35f7ca) 35%, transparent)",
					borderRadius: "2px",
					outline: "1px solid color-mix(in oklch, var(--openscad-accent, #35f7ca) 70%, transparent)",
				},
			}),
			revealed,
			automergeSyncPlugin({handle: props.handle, path: ["source"]}),
			EditorView.updateListener.of(update => {
				if (update.selectionSet && update.transactions.some(t => t.isUserEvent("select") || t.isUserEvent("input") || t.isUserEvent("delete")))
					props.onCursor?.(update.state.selection.main.head)
			}),
		],
	})

	props.onReady?.({
		reveal(from, to) {
			const n = view.state.doc.length
			const a = Math.max(0, Math.min(from, n))
			const b = Math.max(a, Math.min(to, n))
			view.dispatch({selection: {anchor: a, head: b}, effects: [EditorView.scrollIntoView(a, {y: "center"}), setRevealed.of({from: a, to: b})]})
		},
		text: () => view.state.doc.toString(),
	})

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
	const handleChange = (e: MediaQueryListEvent) => setDark(e.matches)
	mediaQuery.addEventListener("change", handleChange)

	createEffect(() => {
		const theme = dark() ? darkTheme : lightTheme
		view.dispatch({effects: themeCompartment.reconfigure(theme)})
	})

	onCleanup(() => {
		mediaQuery.removeEventListener("change", handleChange)
		view.destroy()
	})

	return (
		<div
			ref={el => {
				el.appendChild(view.dom)
			}}
			class="openscad-editor-host"
		/>
	)
}
