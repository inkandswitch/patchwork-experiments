import {Show, Switch, Match, createMemo} from "solid-js"
import type {ChatMessage} from "../types"
import {Avatar} from "./Avatar"
import {MessageBody} from "./MessageBody"
import {MessageReplyRef} from "./MessageReplyRef"
import {MessageReactions} from "./MessageReactions"
import {MessageHoverActions} from "./MessageHoverActions"
import {formatTime} from "../lib/helpers"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"
import {resolveNamedColor} from "../lib/named-colors"
import {useTheme} from "../context/ThemeContext"

export function MessageRow(props: {
	msg: ChatMessage
	replyToMsg?: ChatMessage
	isContinuation: boolean
	emoticonBlobUrls: Record<string, string>
	onReply: (msgId: string) => void
	onReact: (idx: number, anchorEl: HTMLElement) => void
	onToggleReaction: (idx: number, emoji: string) => void
	onDelete: (idx: number) => void
	onScrollToMsg?: (msgId: string) => void
}) {
	const {isLightBg} = useTheme()
	const resolvedColor = createMemo(() => {
		if (!props.msg.color) return undefined
		return resolveNamedColor(props.msg.color, isLightBg())
	})

	return (
		<Switch>
			{/* Action messages (/me) */}
			<Match when={props.msg.action}>
				<div class="chat-msg-action"
					style={{
						...(props.msg.font ? {"font-family": props.msg.font} : {}),
						...(resolvedColor() ? {color: resolvedColor()} : {}),
					}}
				>
					<span class="chat-msg-action-name"
						style={resolvedColor() ? {color: resolvedColor()} : undefined}
					>{props.msg.name}</span>{" "}
					{props.msg.text}
					<MessageHoverActions
						msg={props.msg}
						rawIdx={props.msg._rawIdx!}
						onReply={props.onReply}
						onReact={props.onReact}
						onDelete={props.onDelete}
					/>
				</div>
			</Match>

			{/* Loading placeholder */}
			<Match when={props.msg._loading}>
				<div class="chat-msg-group chat-msg-loading">
					<div class="chat-avatar-col">
						<div class="chat-avatar chat-skeleton" />
					</div>
					<div class="chat-msg-body">
						<div class="chat-skeleton-line short" />
						<div class="chat-skeleton-line" />
					</div>
					<MessageHoverActions
						msg={props.msg}
						rawIdx={props.msg._rawIdx!}
						onReply={props.onReply}
						onReact={props.onReact}
						onDelete={props.onDelete}
					/>
				</div>
			</Match>

			{/* Continuation row (same author within 5 min, no reply) */}
			<Match when={props.isContinuation && !props.msg.replyTo}>
				<div
					class="chat-msg-continuation"
					classList={{"has-gif": !!props.msg.gifSelfieUrl}}
				>
					<Show when={props.msg.gifSelfieUrl}>
						<GifInlineThumbnail gifSelfieUrl={props.msg.gifSelfieUrl!} />
					</Show>
					<div>
						<MessageBody msg={props.msg} emoticonBlobUrls={props.emoticonBlobUrls} />
						<MessageReactions
							msg={props.msg}
							rawIdx={props.msg._rawIdx!}
							onToggleReaction={props.onToggleReaction}
							onAddReaction={props.onReact}
						/>
					</div>
					<MessageHoverActions
						msg={props.msg}
						rawIdx={props.msg._rawIdx!}
						onReply={props.onReply}
						onReact={props.onReact}
						onDelete={props.onDelete}
					/>
				</div>
			</Match>

			{/* Full message row */}
			<Match when={true}>
				<>
					<Show when={props.msg.replyTo && props.replyToMsg}>
						<MessageReplyRef
							replyToMsg={props.replyToMsg}
							on:click={() => props.onScrollToMsg?.(props.msg.replyTo!)}
						/>
					</Show>
					<div class="chat-msg-group">
						<div class="chat-avatar-col">
							<Avatar
								name={props.msg.name}
								avatarUrl={props.msg.avatarUrl}
								gifSelfieUrl={props.msg.gifSelfieUrl}
								isComputer={!!props.msg.isComputer}
							/>
						</div>
						<div class="chat-msg-body">
							<div class="chat-msg-header">
								<span
									class="chat-msg-name"
									classList={{"chat-msg-name-computer": !!props.msg.isComputer}}
									style={resolvedColor() ? {color: resolvedColor()} : undefined}
								>
									{props.msg.name}
								</span>
								<span class="chat-msg-time">{formatTime(props.msg.timestamp)}</span>
							</div>
							<MessageBody msg={props.msg} emoticonBlobUrls={props.emoticonBlobUrls} />
							<MessageReactions
								msg={props.msg}
								rawIdx={props.msg._rawIdx!}
								onToggleReaction={props.onToggleReaction}
								onAddReaction={props.onReact}
							/>
						</div>
						<MessageHoverActions
							msg={props.msg}
							rawIdx={props.msg._rawIdx!}
							onReply={props.onReply}
							onReact={props.onReact}
							onDelete={props.onDelete}
						/>
					</div>
				</>
			</Match>
		</Switch>
	)
}

/** Inline GIF thumbnail for continuation rows */
function GifInlineThumbnail(props: {gifSelfieUrl: string}) {
	const src = createMemo(() => automergeUrlToServiceWorkerUrl(props.gifSelfieUrl as any))

	return (
		<div class="chat-avatar-col">
			<Show when={src()}>
				<img class="chat-msg-gif-inline" src={src()!} alt="selfie" />
			</Show>
		</div>
	)
}
