import {For, Show} from "solid-js"
import type {ChatMessage} from "../types"
import {useIdentity} from "../context/IdentityContext"
import {SVG_ICONS} from "../lib/svg-icons"

export function MessageReactions(props: {
	msg: ChatMessage
	rawIdx: number
	onToggleReaction: (idx: number, emoji: string) => void
	onAddReaction: (idx: number, anchorEl: HTMLElement) => void
}) {
	const {myName} = useIdentity()

	const reactionEntries = () => {
		const r = props.msg.reactions
		if (!r) return []
		return Object.entries(r).filter(([, users]) => users.length > 0)
	}

	return (
		<Show when={reactionEntries().length > 0}>
			<div class="chat-reactions">
				<For each={reactionEntries()}>
					{([emoji, users]) => (
						<button
							class="chat-reaction"
							classList={{mine: users.includes(myName())}}
							onClick={() => props.onToggleReaction(props.rawIdx, emoji)}
						>
							{emoji}
							<span class="chat-reaction-count">{users.length}</span>
						</button>
					)}
				</For>
				<button
					class="chat-reaction-add"
					onClick={(e) => props.onAddReaction(props.rawIdx, e.currentTarget)}
					innerHTML={SVG_ICONS.plus}
				/>
			</div>
		</Show>
	)
}
