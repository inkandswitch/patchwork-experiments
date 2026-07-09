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
import {EditorState, Compartment} from "@codemirror/state"
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

function isDarkMode() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function CodeEditor(props: {
	source: string
	handle: DocHandle<OpenscadDoc>
	onRenderRequested: () => void
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
			}),
			automergeSyncPlugin({handle: props.handle, path: ["source"]}),
		],
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
