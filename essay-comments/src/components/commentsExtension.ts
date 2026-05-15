import {
	StateEffect,
	StateField,
	Extension,
	RangeSetBuilder,
} from "@codemirror/state"
import {
	ViewPlugin,
	ViewUpdate,
	Decoration,
	DecorationSet,
	EditorView,
} from "@codemirror/view"

export type ResolvedComment = {
	id: string
	from: number
	to: number
	text: string
	author: string
	timestamp: string
}

export const setCommentsEffect = StateEffect.define<ResolvedComment[]>()
export const setActiveCommentEffect = StateEffect.define<string | null>()

export const commentsStateField = StateField.define<ResolvedComment[]>({
	create: () => [],
	update(val, tr) {
		for (const e of tr.effects) {
			if (e.is(setCommentsEffect)) return e.value
		}
		return val
	},
})

const activeCommentField = StateField.define<string | null>({
	create: () => null,
	update(val, tr) {
		for (const e of tr.effects) {
			if (e.is(setActiveCommentEffect)) return e.value
		}
		return val
	},
})

function buildDecorations(
	comments: ResolvedComment[],
	activeId: string | null
): DecorationSet {
	const sorted = [...comments]
		.filter((c) => c.from < c.to)
		.sort((a, b) => a.from - b.from || a.to - b.to)

	const builder = new RangeSetBuilder<Decoration>()
	for (const c of sorted) {
		const isActive = c.id === activeId
		builder.add(
			c.from,
			c.to,
			Decoration.mark({
				class: isActive
					? "cm-comment-highlight cm-comment-active"
					: "cm-comment-highlight",
				attributes: {"data-comment-id": c.id},
			})
		)
	}
	return builder.finish()
}

function makeCommentsPlugin(onCommentClick: (id: string) => void) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet

			constructor(view: EditorView) {
				this.decorations = buildDecorations(
					view.state.field(commentsStateField),
					view.state.field(activeCommentField)
				)
			}

			update(update: ViewUpdate) {
				const commentsChanged =
					update.state.field(commentsStateField) !==
					update.startState.field(commentsStateField)
				const activeChanged =
					update.state.field(activeCommentField) !==
					update.startState.field(activeCommentField)
				if (update.docChanged || commentsChanged || activeChanged) {
					this.decorations = buildDecorations(
						update.state.field(commentsStateField),
						update.state.field(activeCommentField)
					)
				}
			}
		},
		{
			decorations: (v) => v.decorations,
			eventHandlers: {
				mousedown(e: MouseEvent) {
					const target = e.target as HTMLElement
					const el = target.closest("[data-comment-id]") as HTMLElement | null
					if (el) {
						const id = el.getAttribute("data-comment-id")
						if (id) {
							onCommentClick(id)
							e.preventDefault()
						}
					}
				},
			},
		}
	)
}

const commentsTheme = EditorView.theme({
	".cm-comment-highlight": {
		backgroundColor: "rgba(255, 212, 0, 0.25)",
		borderRadius: "2px",
	},
	".cm-comment-active": {
		backgroundColor: "rgba(255, 212, 0, 0.55)",
		outline: "1px solid rgba(255, 180, 0, 0.8)",
		borderRadius: "2px",
	},
})

export function commentsExtension(
	onCommentClick: (id: string) => void
): Extension {
	return [
		commentsStateField,
		activeCommentField,
		makeCommentsPlugin(onCommentClick),
		commentsTheme,
	]
}
