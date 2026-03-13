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
import {
	EditorState,
	type Extension,
	Compartment,
} from "@codemirror/state"
import {
	syntaxHighlighting,
	indentUnit,
	bracketMatching,
	foldGutter,
	foldKeymap,
} from "@codemirror/language"
import {
	highlightSelectionMatches,
	searchKeymap,
} from "@codemirror/search"
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	emacsStyleKeymap,
} from "@codemirror/commands"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import {draculaTheme, draculaHighlightStyle} from "../dracula"
import {lycheeTheme, lycheeHighlightStyle} from "../lychee"
import {getLanguageExtension} from "../languages"
import type {FileDoc} from "../types"

enum mod {
	shift = 1,
	control = 2,
	option = 3,
	command = 4,
}

function modshift(event: {
	ctrlKey: boolean
	shiftKey: boolean
	altKey: boolean
	metaKey: boolean
}) {
	let bits = 0
	bits |= +event.shiftKey << mod.shift
	bits |= +event.ctrlKey << mod.control
	bits |= +event.altKey << mod.option
	bits |= +event.metaKey << mod.command
	return bits
}

export const isTextFile = (doc: FileDoc) => {
	return (
		doc?.mimeType?.match("text/") ||
		doc?.mimeType?.match("application/json") ||
		doc?.mimeType?.match("application/javascript")
	)
}

function isDarkMode() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function TextFileEditor(props: {doc: FileDoc; handle: any}) {
	let container!: HTMLDivElement
	const themeCompartment = new Compartment()

	const lightTheme: Extension = [
		lycheeTheme,
		syntaxHighlighting(lycheeHighlightStyle),
	]
	const darkTheme: Extension = [
		draculaTheme,
		syntaxHighlighting(draculaHighlightStyle),
	]

	const [dark, setDark] = createSignal(isDarkMode())

	const languageExtension = getLanguageExtension(
		props.doc.extension,
		props.doc.mimeType,
	)

	const view = new EditorView({
		doc: props.doc.content?.toString() || "",
		extensions: [
			lineNumbers(),
			highlightSpecialChars(),
			highlightActiveLineGutter(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			history(),
			foldGutter(),
			bracketMatching(),
			indentUnit.of("\t"),
			EditorState.allowMultipleSelections.of(true),
			EditorState.tabSize.of(2),
			EditorView.lineWrapping,
			EditorView.clickAddsSelectionRange.of((event) => {
				const mask = modshift(event)
				if (mask == 1 << mod.option) return true
				return false
			}),
			rectangularSelection({
				eventFilter(event) {
					const mask = modshift(event)
					if (mask == ((1 << mod.shift) | (1 << mod.option)))
						return true
					return false
				},
			}),
			keymap.of([
				indentWithTab,
				...emacsStyleKeymap,
				...searchKeymap,
				...historyKeymap,
				...foldKeymap,
				...defaultKeymap,
			]),
			languageExtension,
			themeCompartment.of(dark() ? darkTheme : lightTheme),
			EditorView.theme({
				"&": {height: "100%", fontSize: "16px"},
				".cm-scroller": {
					overflow: "auto",
				},
			}),
			automergeSyncPlugin({handle: props.handle, path: ["content"]}),
		],
	})

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
	const handleChange = (e: MediaQueryListEvent) => setDark(e.matches)
	mediaQuery.addEventListener("change", handleChange)

	createEffect(() => {
		const theme = dark() ? darkTheme : lightTheme
		view.dispatch({
			effects: themeCompartment.reconfigure(theme),
		})
	})

	onCleanup(() => {
		mediaQuery.removeEventListener("change", handleChange)
		view.destroy()
	})

	return (
		<div
			ref={(el) => {
				container = el
				el.appendChild(view.dom)
			}}
			style={{
				width: "100%",
				height: "100%",
			}}
		/>
	)
}
