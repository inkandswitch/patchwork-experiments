import {onCleanup, createSignal, createEffect, onMount} from "solid-js"
import {EditorView, keymap} from "@codemirror/view"
import {Compartment} from "@codemirror/state"
import {syntaxHighlighting, HighlightStyle} from "@codemirror/language"
import {markdown, markdownLanguage} from "@codemirror/lang-markdown"
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands"
import {searchKeymap} from "@codemirror/search"
import {tags as t} from "@lezer/highlight"
import {automergeSyncPlugin} from "@automerge/automerge-codemirror"
import * as Automerge from "@automerge/automerge"
import type {DocHandle} from "@automerge/automerge-repo"
import type {CommentedEssayDoc} from "../datatype"
import {
	commentsExtension,
	commentsStateField,
	setCommentsEffect,
	setActiveCommentEffect,
} from "./commentsExtension"
import type {ResolvedComment} from "./commentsExtension"
import {CommentsSidebar} from "./CommentsSidebar"
import {LLMPromptBox} from "./LLMPromptBox"

function isDarkMode() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches
}

const lightHighlight = HighlightStyle.define([
	{tag: t.heading1, fontWeight: "700", fontSize: "1.75em", color: "#111"},
	{tag: t.heading2, fontWeight: "700", fontSize: "1.4em", color: "#222"},
	{tag: t.heading3, fontWeight: "700", fontSize: "1.15em", color: "#333"},
	{tag: t.emphasis, fontStyle: "italic"},
	{tag: t.strong, fontWeight: "700"},
	{
		tag: t.monospace,
		fontFamily: "ui-monospace, monospace",
		fontSize: "0.9em",
		color: "#555",
	},
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
	{
		tag: t.monospace,
		fontFamily: "ui-monospace, monospace",
		fontSize: "0.9em",
		color: "#aaa",
	},
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
		maxWidth: "620px",
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
			maxWidth: "620px",
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

function resolveComments(
	doc: CommentedEssayDoc | undefined
): ResolvedComment[] {
	if (!doc?.comments?.length) return []
	return doc.comments
		.map((c) => {
			try {
				const from = Automerge.getCursorPosition(
					doc,
					["content"],
					c.fromCursor
				)
				const to = Automerge.getCursorPosition(doc, ["content"], c.toCursor)
				return {id: c.id, from, to, text: c.text, author: c.author, timestamp: c.timestamp}
			} catch {
				return null
			}
		})
		.filter((c): c is ResolvedComment => c !== null && c.from < c.to)
}

export function Editor(props: {handle: DocHandle<CommentedEssayDoc>}) {
	let editorContainer!: HTMLDivElement

	const themeCompartment = new Compartment()
	const highlightCompartment = new Compartment()
	const automergeCompartment = new Compartment()

	const [dark, setDark] = createSignal(isDarkMode())
	const [activeCommentId, setActiveCommentId] = createSignal<string | null>(null)

	const editorView = new EditorView({
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
			automergeCompartment.of(
				automergeSyncPlugin({handle: props.handle, path: ["content"]})
			),
			commentsExtension((id) => setActiveCommentId(id)),
		],
	})

	// Theme sync
	const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
	const handleThemeChange = (e: MediaQueryListEvent) => setDark(e.matches)
	mediaQuery.addEventListener("change", handleThemeChange)

	createEffect(() => {
		editorView.dispatch({
			effects: [
				themeCompartment.reconfigure(dark() ? darkTheme : lightTheme),
				highlightCompartment.reconfigure(
					syntaxHighlighting(dark() ? darkHighlight : lightHighlight)
				),
			],
		})
	})

	// Push initial comment decorations into CM
	onMount(() => {
		const initial = resolveComments(props.handle.doc())
		if (initial.length > 0) {
			editorView.dispatch({effects: setCommentsEffect.of(initial)})
		}
	})

	// Re-resolve comments whenever the automerge doc changes.
	// We defer the dispatch with setTimeout because the automerge sync plugin
	// also listens to this same event and dispatches to CM synchronously —
	// dispatching from inside a CM update cycle raises an error.
	const handleChange = ({doc}: {doc: CommentedEssayDoc}) => {
		const resolved = resolveComments(doc)
		setTimeout(() => {
			if (editorView.dom.isConnected) {
				editorView.dispatch({effects: setCommentsEffect.of(resolved)})
			}
		}, 0)
	}
	props.handle.on("change", handleChange)

	// Sync active comment id into CM state + scroll editor to the range
	createEffect(() => {
		const id = activeCommentId()
		editorView.dispatch({effects: setActiveCommentEffect.of(id)})
		if (id) {
			const comments = editorView.state.field(commentsStateField)
			const comment = comments.find((c) => c.id === id)
			if (comment) {
				editorView.dispatch({
					effects: EditorView.scrollIntoView(comment.from, {y: "center"}),
				})
			}
		}
	})

	onCleanup(() => {
		mediaQuery.removeEventListener("change", handleThemeChange)
		props.handle.off("change", handleChange)
		editorView.destroy()
	})

	return (
		<div
			style={{
				display: "flex",
				width: "100%",
				height: "100%",
				"min-width": "0",
				overflow: "hidden",
				"background-color": dark() ? "#1c1c1c" : "#fafaf8",
			}}
		>
			<div
				ref={(el) => {
					editorContainer = el
					el.appendChild(editorView.dom)
				}}
				style={{flex: "1", "min-height": "0", "min-width": "0", overflow: "hidden"}}
			/>
			<div
				style={{
					display: "flex",
					"flex-direction": "column",
					width: "320px",
					"flex-shrink": "0",
					"min-height": "0",
					"border-left": dark() ? "1px solid #2e2e2e" : "1px solid #e8e8e8",
					"background-color": dark() ? "#1c1c1c" : "#fafaf8",
				}}
			>
				<LLMPromptBox handle={props.handle} />
				<CommentsSidebar
					handle={props.handle}
					activeCommentId={activeCommentId()}
					onCommentClick={(id) => setActiveCommentId(id)}
				/>
			</div>
		</div>
	)
}
