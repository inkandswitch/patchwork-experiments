import {Show, createResource} from "solid-js"
import type {ChatMessage} from "../types"
import {loadBlobUrl} from "../lib/blob-cache"

export function MessageReplyRef(props: {
	replyToMsg: ChatMessage | undefined
	onClick?: () => void
}) {
	const msg = () => props.replyToMsg

	const [avatarBlobUrl] = createResource(
		() => msg()?.avatarUrl,
		async (url) => (url ? loadBlobUrl(url) : null)
	)

	return (
		<Show when={msg()}>
			<div class="chat-msg-reply-ref" onClick={props.onClick}>
				<span class="chat-msg-reply-ref-avatar">
					<Show when={avatarBlobUrl()}>
						<img src={avatarBlobUrl()!} />
					</Show>
				</span>
				<span class="chat-msg-reply-ref-name">{msg()!.name}</span>
				<span class="chat-msg-reply-ref-text">
					{msg()!.text || "(attachment)"}
				</span>
			</div>
		</Show>
	)
}
