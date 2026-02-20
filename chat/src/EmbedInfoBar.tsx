import {Show, createSignal} from "solid-js"
import {useChatContext} from "./context"
import type {EmbedLink} from "./types"

export function EmbedInfoBar(props: {embed: EmbedLink; toolId: string; embedKey: string}) {
	const ctx = useChatContext()
	const [editingTool, setEditingTool] = createSignal(false)
	const [toolInput, setToolInput] = createSignal(props.toolId)
	const [showUrlMenu, setShowUrlMenu] = createSignal(false)

	function saveTool(val: string) {
		ctx.handle.change((d) => {
			if (!d.toolOverrides) d.toolOverrides = {} as any
			if (val) (d.toolOverrides as any)[props.embedKey] = val
			else delete (d.toolOverrides as any)[props.embedKey]
		})
		setEditingTool(false)
	}

	const docIdShort = () =>
		props.embed.docUrl.replace("automerge:", "").slice(0, 8) + "\u2026"

	return (
		<div class="chat-embed-infobar">
			<Show when={props.embed.title}>
				<span class="chat-msg-embed-title">{props.embed.title}</span>
			</Show>

			{/* Tool pill */}
			<Show
				when={!editingTool()}
				fallback={
					<input
						class="chat-embed-tool-input"
						type="text"
						placeholder="tool id"
						value={toolInput()}
						on:input={(e) => setToolInput(e.currentTarget.value)}
						on:pointerdown={(e) => e.stopPropagation()}
						on:keydown={(e) => {
							e.stopPropagation()
							if (e.key === "Enter") saveTool(toolInput().trim())
							else if (e.key === "Escape") setEditingTool(false)
						}}
						on:blur={() => saveTool(toolInput().trim())}
						ref={(el) => {
							setTimeout(() => {
								el.focus()
								el.select()
							}, 0)
						}}
					/>
				}
			>
				<span
					class="chat-embed-pill clickable"
					title="Change tool"
					on:pointerdown={(e) => e.stopPropagation()}
					on:click={(e) => {
						e.stopPropagation()
						setEditingTool(true)
					}}
				>
					<span class="chat-embed-pill-label">tool</span>
					{" " + (props.toolId || "default")}
				</span>
			</Show>

			{/* URL pill */}
			<span
				class="chat-embed-pill clickable"
				style="position:relative"
				title="Copy URL"
				on:pointerdown={(e) => e.stopPropagation()}
				on:click={(e) => {
					e.stopPropagation()
					setShowUrlMenu(!showUrlMenu())
				}}
			>
				<span class="chat-embed-pill-label">url</span>
				{" " + docIdShort()}

				<Show when={showUrlMenu()}>
					<div class="chat-embed-url-menu">
						<button
							on:click={(e) => {
								e.stopPropagation()
								const params = new URLSearchParams()
								const docId = props.embed.docUrl.replace("automerge:", "")
								params.set("doc", docId)
								if (props.embed.title) params.set("title", props.embed.title)
								if (props.embed.type) params.set("type", props.embed.type)
								if (props.toolId) params.set("tool", props.toolId)
								const url =
									"https://tiny.patchwork.inkandswitch.com/#" +
									params.toString()
								navigator.clipboard.writeText(url).then(() => {
									setShowUrlMenu(false)
								})
							}}
						>
							Copy tiny patchwork URL
						</button>
						<button
							on:click={(e) => {
								e.stopPropagation()
								navigator.clipboard.writeText(props.embed.docUrl).then(() => {
									setShowUrlMenu(false)
								})
							}}
						>
							Copy automerge URL
						</button>
					</div>
				</Show>
			</span>
		</div>
	)
}
