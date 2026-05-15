import {onCleanup, createSignal, createEffect, Show} from "solid-js"
import {EditorView, keymap} from "@codemirror/view"
import {Compartment} from "@codemirror/state"
import {syntaxHighlighting, HighlightStyle} from "@codemirror/language"
import {markdown, markdownLanguage} from "@codemirror/lang-markdown"
import {
	defaultKeymap,
	history,
	historyKeymap,
} from "@codemirror/commands"
import {searchKeymap} from "@codemirror/search"
import {tags as t} from "@lezer/highlight"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import type {DocHandle} from "@automerge/automerge-repo"
import type {MarkdownDoc} from "../datatype"
import {Timeline} from "./Timeline"

function isDarkMode() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

const lightHighlight = HighlightStyle.define([
	{tag: t.heading1, fontWeight: "700", fontSize: "1.75em", color: "#111"},
	{tag: t.heading2, fontWeight: "700", fontSize: "1.4em", color: "#222"},
	{tag: t.heading3, fontWeight: "700", fontSize: "1.15em", color: "#333"},
	{tag: t.emphasis, fontStyle: "italic"},
	{tag: t.strong, fontWeight: "700"},
	{tag: t.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.9em", color: "#555"},
	{tag: t.link, color: "#0070f3", textDecoration: "underline"},
	{tag: t.url, color: "#0070f3"},
	{tag: t.quote, color: "#666", fontStyle: "italic"},
	{tag: t.strikethrough, textDecoration: "line-through"},
])

const darkHighlight = HighlightStyle.define([
	{tag: t.heading1, fontWeight: "700", fontSize: "1.75em", color: "#f5f5f5"},
	{tag: t.heading2, fontWeight: "700", fontSize: "1.4em", color: "#e8e8e8"},
	{tag: t.heading3, fontWeight: "700", fontSize: "1.15em", color: "#d8d8d8"},
	{tag: t.emphasis, fontStyle: "italic"},
	{tag: t.strong, fontWeight: "700"},
	{tag: t.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.9em", color: "#aaa"},
	{tag: t.link, color: "#58a6ff", textDecoration: "underline"},
	{tag: t.url, color: "#58a6ff"},
	{tag: t.quote, color: "#999", fontStyle: "italic"},
	{tag: t.strikethrough, textDecoration: "line-through"},
])

const lightTheme = EditorView.theme({
	"&": {
		backgroundColor: "#fafaf8",
		color: "#1a1a1a",
		height: "100%",
		minHeight: "0",
	},
	".cm-scroller": {
		overflow: "auto",
		fontFamily: "Georgia, 'Times New Roman', serif",
		fontSize: "18px",
		lineHeight: "1.75",
	},
	".cm-content": {
		maxWidth: "680px",
		margin: "0 auto",
		padding: "64px 24px 128px",
		caretColor: "#1a1a1a",
	},
	".cm-cursor": {borderLeftColor: "#1a1a1a"},
	".cm-activeLine": {backgroundColor: "transparent"},
	".cm-selectionBackground, .cm-content ::selection": {
		backgroundColor: "#d4d0cb !important",
	},
	".cm-focused .cm-selectionBackground": {backgroundColor: "#d4d0cb"},
})

const darkTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "#1c1c1c",
			color: "#e0ddd6",
			height: "100%",
			minHeight: "0",
		},
		".cm-scroller": {
			overflow: "auto",
			fontFamily: "Georgia, 'Times New Roman', serif",
			fontSize: "18px",
			lineHeight: "1.75",
		},
		".cm-content": {
			maxWidth: "680px",
			margin: "0 auto",
			padding: "64px 24px 128px",
			caretColor: "#e0ddd6",
		},
		".cm-cursor": {borderLeftColor: "#e0ddd6"},
		".cm-activeLine": {backgroundColor: "transparent"},
		".cm-selectionBackground, .cm-content ::selection": {
			backgroundColor: "#3a3632 !important",
		},
		".cm-focused .cm-selectionBackground": {backgroundColor: "#3a3632"},
	},
	{dark: true}
)

export function EssayEditor(props: {handle: DocHandle<MarkdownDoc>}) {
	let container!: HTMLDivElement
	const themeCompartment = new Compartment()
	const highlightCompartment = new Compartment()
	const automergeCompartment = new Compartment()
	const readonlyCompartment = new Compartment()

	const [dark, setDark] = createSignal(isDarkMode())
	const [timeTravelContent, setTimeTravelContent] = createSignal<string | null>(null)

	const view = new EditorView({
		doc: props.handle.doc()?.content?.toString() ?? "",
		extensions: [
			EditorView.lineWrapping,
			history(),
			keymap.of([...historyKeymap, ...searchKeymap, ...defaultKeymap]),
			markdown({base: markdownLanguage}),
			themeCompartment.of(dark() ? darkTheme : lightTheme),
			highlightCompartment.of(
				syntaxHighlighting(dark() ? darkHighlight : lightHighlight)
			),
			automergeCompartment.of(automergeSyncPlugin({handle: props.handle, path: ["content"]})),
			readonlyCompartment.of(EditorView.editable.of(true)),
		],
	})

	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
	const handleChange = (e: MediaQueryListEvent) => setDark(e.matches)
	mediaQuery.addEventListener("change", handleChange)

	createEffect(() => {
		view.dispatch({
			effects: [
				themeCompartment.reconfigure(dark() ? darkTheme : lightTheme),
				highlightCompartment.reconfigure(
					syntaxHighlighting(dark() ? darkHighlight : lightHighlight)
				),
			],
		})
	})

	let wasTimeTraveling = false
	createEffect(() => {
		const content = timeTravelContent()
		if (content !== null) {
			wasTimeTraveling = true
			view.dispatch({effects: automergeCompartment.reconfigure([])})
			view.dispatch({
				changes: {from: 0, to: view.state.doc.length, insert: content},
				effects: readonlyCompartment.reconfigure(EditorView.editable.of(false)),
			})
		} else if (wasTimeTraveling) {
			wasTimeTraveling = false
			const liveContent = props.handle.doc()?.content?.toString() ?? ""
			view.dispatch({
				changes: {from: 0, to: view.state.doc.length, insert: liveContent},
				effects: readonlyCompartment.reconfigure(EditorView.editable.of(true)),
			})
			view.dispatch({effects: automergeCompartment.reconfigure(automergeSyncPlugin({handle: props.handle, path: ["content"]}))})
		}
	})

	onCleanup(() => {
		mediaQuery.removeEventListener("change", handleChange)
		view.destroy()
	})

	return (
		<div style={{display: "flex", "flex-direction": "column", width: "100%", height: "100%", "min-width": "0", overflow: "hidden"}}>
			<div
				ref={(el) => {
					container = el
					el.appendChild(view.dom)
				}}
				style={{flex: "1", "min-height": "0", "min-width": "0", overflow: "hidden"}}
			/>
			<Show when={timeTravelContent() !== null}>
				<div style={{
					"background": "rgba(251,191,36,0.12)",
					"border-top": "1px solid rgba(251,191,36,0.3)",
					"color": "#fbbf24",
					"font-size": "11px",
					"font-family": "ui-monospace, monospace",
					"padding": "5px 14px",
					"text-align": "center",
					"flex-shrink": "0",
					"letter-spacing": "0.02em",
				}}>
					Viewing history — drag pin to the right end to resume editing
				</div>
			</Show>
			<Timeline handle={props.handle} onTimeTravel={setTimeTravelContent} />
		</div>
	)
}
