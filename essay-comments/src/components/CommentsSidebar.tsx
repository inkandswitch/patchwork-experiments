import {createSignal, createEffect, onMount, onCleanup, For, Show} from "solid-js"
import type {DocHandle} from "@automerge/automerge-repo"
import * as Automerge from "@automerge/automerge"
import type {CommentedEssayDoc} from "../datatype"
import type {ResolvedComment} from "./commentsExtension"

function formatTime(iso: string): string {
	const date = new Date(iso)
	const now = Date.now()
	const diff = now - date.getTime()
	const mins = Math.floor(diff / 60000)
	if (mins < 1) return "just now"
	if (mins < 60) return `${mins}m ago`
	const hours = Math.floor(mins / 60)
	if (hours < 24) return `${hours}h ago`
	const days = Math.floor(hours / 24)
	return `${days}d ago`
}

function resolveComments(doc: CommentedEssayDoc | undefined): ResolvedComment[] {
	if (!doc?.comments?.length) return []
	return doc.comments
		.map((c) => {
			try {
				const from = Automerge.getCursorPosition(doc, ["content"], c.fromCursor)
				const to = Automerge.getCursorPosition(doc, ["content"], c.toCursor)
				return {id: c.id, from, to, text: c.text, author: c.author, timestamp: c.timestamp}
			} catch {
				return null
			}
		})
		.filter((c): c is ResolvedComment => c !== null && c.from < c.to)
		.sort((a, b) => a.from - b.from)
}

export function CommentsSidebar(props: {
	handle: DocHandle<CommentedEssayDoc>
	activeCommentId: string | null
	onCommentClick: (id: string) => void
}) {
	const [comments, setComments] = createSignal<ResolvedComment[]>([])
	const cardRefs = new Map<string, HTMLElement>()

	function refresh() {
		setComments(resolveComments(props.handle.doc()))
	}

	onMount(() => {
		refresh()
		props.handle.on("change", refresh)
		onCleanup(() => props.handle.off("change", refresh))
	})

	// Scroll active card into view whenever it changes
	createEffect(() => {
		const id = props.activeCommentId
		if (id) {
			const el = cardRefs.get(id)
			el?.scrollIntoView({behavior: "smooth", block: "nearest"})
		}
	})

	return (
		<div
			style={{
				flex: "1",
				"min-height": "0",
				"overflow-y": "auto",
				padding: "8px 0",
			}}
		>
			<For each={comments()}>
				{(comment) => {
					const isActive = () => props.activeCommentId === comment.id
					return (
						<div
							ref={(el) => cardRefs.set(comment.id, el)}
							onClick={() => props.onCommentClick(comment.id)}
							style={{
								margin: "0 12px 8px",
								"background-color": isActive() ? "#fffbe6" : "#fff",
								border: isActive()
									? "1px solid rgba(255, 180, 0, 0.8)"
									: "1px solid #e0e0e0",
								"border-left": isActive()
									? "3px solid rgba(255, 180, 0, 0.9)"
									: "3px solid transparent",
								"border-radius": "6px",
								padding: "10px 12px",
								cursor: "pointer",
								"box-shadow": isActive()
									? "0 2px 8px rgba(0,0,0,0.12)"
									: "0 1px 3px rgba(0,0,0,0.06)",
								transition: "all 0.15s ease",
								opacity: isActive() ? "1" : "0.85",
								"font-family": "system-ui, sans-serif",
								"font-size": "13px",
								"line-height": "1.5",
							}}
						>
							<div
								style={{
									display: "flex",
									"justify-content": "space-between",
									"align-items": "baseline",
									"margin-bottom": "5px",
									gap: "8px",
								}}
							>
								<span
									style={{
										"font-weight": "600",
										color: "#1a1a1a",
										"white-space": "nowrap",
										overflow: "hidden",
										"text-overflow": "ellipsis",
										"min-width": "0",
									}}
								>
									{comment.author}
								</span>
								<span style={{color: "#888", "font-size": "11px", "flex-shrink": "0"}}>
									{formatTime(comment.timestamp)}
								</span>
							</div>
							<div style={{color: "#333"}}>{comment.text}</div>
						</div>
					)
				}}
			</For>
			<Show when={comments().length === 0}>
				<div
					style={{
						padding: "16px 12px",
						color: "#aaa",
						"font-size": "13px",
						"font-family": "system-ui, sans-serif",
					}}
				>
					No comments yet
				</div>
			</Show>
		</div>
	)
}
