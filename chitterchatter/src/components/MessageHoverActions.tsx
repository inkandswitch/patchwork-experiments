import {SVG_ICONS} from "../lib/svg-icons"
import {formatTime} from "../lib/helpers"
import type {ChatMessage} from "../types"

export function MessageHoverActions(props: {
	msg: ChatMessage
	rawIdx: number
	onReply: (msgId: string) => void
	onReact: (idx: number, anchorEl: HTMLElement) => void
	onDelete: (idx: number) => void
}) {
	return (
		<div class="chat-msg-actions">
			{!props.msg._loading && (
				<button
					class="chat-msg-action-btn"
					title="Reply"
					innerHTML={SVG_ICONS.reply}
					on:click={(e) => {
						e.stopPropagation()
						props.onReply(props.msg.id)
					}}
				/>
			)}
			<button
				class="chat-msg-action-btn"
				title="Add reaction"
				innerHTML={SVG_ICONS.react}
				on:click={(e) => {
					e.stopPropagation()
					props.onReact(props.rawIdx, e.currentTarget)
				}}
			/>
			<button
				class="chat-msg-action-btn"
				title="Delete"
				innerHTML={SVG_ICONS.trash}
				on:click={(e) => {
					e.stopPropagation()
					props.onDelete(props.rawIdx)
				}}
			/>
			<span class="chat-msg-inline-time">{formatTime(props.msg.timestamp)}</span>
		</div>
	)
}
