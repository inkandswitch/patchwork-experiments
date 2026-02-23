import {Show, Switch, Match, For, createSignal, createMemo, createEffect} from "solid-js"
import type {AutomergeUrl, DocHandle} from "@automerge/automerge-repo"
import type {ResolvedMessage, MessageEntry, MessageData, InlineMessage} from "./types"
import {useDocument} from "@automerge/automerge-repo-solid-primitives"
import {useChatContext} from "./context"
import {useBlobUrl, useAudioUrl, getCachedBlobUrl, prefetchBlobUrl} from "./resources"
import {SVG_ICONS} from "./icons"
import {formatText, formatTime, formatDuration, resolveNamedColor} from "./helpers"
import {isLightBg} from "./theme"
import {EmbedInfoBar} from "./EmbedInfoBar"

export function Message(props: {
	msg: ResolvedMessage
	isContinuation: boolean
	allEntries: MessageEntry[]
}) {
	const ctx = useChatContext()
	const msg = () => props.msg
	const rawIdx = () => msg()._rawIdx

	// Resolve reply target
	const [replyOriginal, setReplyOriginal] = createSignal<ResolvedMessage | null>(null)
	createEffect(() => {
		const replyTo = msg().replyTo
		if (!replyTo) {
			setReplyOriginal(null)
			return
		}
		// Check inline messages first
		for (const entry of props.allEntries) {
			if (!("ref" in entry) || !entry.ref) {
				const inline = entry as InlineMessage
				if (inline.id === replyTo) {
					setReplyOriginal(inline as unknown as ResolvedMessage)
					return
				}
			}
		}
		// Search ref message docs asynchronously
		const repo = (window as any).repo
		if (!repo) return
		for (const entry of props.allEntries) {
			if ("ref" in entry && entry.ref) {
				repo.find(entry.url).then((handle: any) => {
					const d = handle.doc()
					if (d?.id === replyTo) {
						setReplyOriginal(d as ResolvedMessage)
					}
				}).catch(() => {})
			}
		}
	})

	// Collect emoticon URLs used in this message
	const emoticonUrls = createMemo(() => {
		const urls: Record<string, string> = {}
		const allEm = ctx.getAllEmoticons()
		for (const [name, info] of Object.entries(allEm)) {
			urls[name] = info.url
		}
		// Also include emoticons embedded in the message
		const m = msg()
		if (m.emoticons) {
			for (const [name, url] of Object.entries(m.emoticons)) {
				if (!urls[name]) urls[name] = url
			}
		}
		return urls
	})

	const msgHandle = () => msg()._handle
	const hasGif = () => !!msg().gifSelfieUrl

	return (
		<Switch>
			<Match when={msg().action}>
				<ReplyRef original={replyOriginal()} />
				<div
					class="chat-msg-action"
					data-msg-id={msg().id || ""}
					style={{
						"font-family": msg().font || undefined,
						color: msg().color ? resolveNamedColor(msg().color!, isLightBg()) : undefined,
					}}
				>
					{"* "}
					<span class="chat-msg-action-name">{msg().name}</span>
					<MessageTextSpan text={msg().text} emoticonUrls={emoticonUrls()} />
					<MessageActions rawIdx={rawIdx()} msgId={msg().id} timestamp={msg().timestamp} msgName={msg().name} msgText={msg().text} msgHandle={msgHandle()} />
					<Reactions msg={msg()} rawIdx={rawIdx()} emoticonUrls={emoticonUrls()} msgHandle={msgHandle()} />
				</div>
			</Match>
			<Match when={props.isContinuation}>
				<div
					class={"chat-msg-continuation" + (hasGif() ? " has-gif" : "")}
					data-msg-id={msg().id || ""}
				>
					<Show when={hasGif()}>
						<div class="chat-avatar-col">
							<GifInline url={msg().gifSelfieUrl!} />
						</div>
					</Show>
					<div class="chat-msg-body">
						<MessageText msg={msg()} emoticonUrls={emoticonUrls()} />
						<Attachments msg={msg()} msgHandle={msgHandle()} />
						<Reactions msg={msg()} rawIdx={rawIdx()} emoticonUrls={emoticonUrls()} msgHandle={msgHandle()} />
					</div>
					<MessageActions rawIdx={rawIdx()} msgId={msg().id} timestamp={msg().timestamp} msgName={msg().name} msgText={msg().text} msgHandle={msgHandle()} />
				</div>
			</Match>
			<Match when={true}>
				<ReplyRef original={replyOriginal()} />
				<div class="chat-msg-group" data-msg-id={msg().id || ""}>
					<MessageActions rawIdx={rawIdx()} msgId={msg().id} timestamp={msg().timestamp} msgName={msg().name} msgText={msg().text} msgHandle={msgHandle()} />
					<div class="chat-avatar-col">
						<Avatar msg={msg()} />
					</div>
					<div class="chat-msg-body">
						<div class="chat-msg-header">
							<span class="chat-msg-name">{msg().name}</span>
							<span class="chat-msg-time">{formatTime(msg().timestamp)}</span>
						</div>
						<MessageText msg={msg()} emoticonUrls={emoticonUrls()} />
						<Attachments msg={msg()} msgHandle={msgHandle()} />
						<Reactions msg={msg()} rawIdx={rawIdx()} emoticonUrls={emoticonUrls()} msgHandle={msgHandle()} />
					</div>
				</div>
			</Match>
		</Switch>
	)
}

function ReplyRef(props: {original: ResolvedMessage | null}) {
	const avatarBlobUrl = useBlobUrl(() => props.original?.avatarUrl)

	function scrollToReply() {
		const orig = props.original
		if (!orig) return
		const el = document.querySelector(`[data-msg-id="${orig.id}"]`) as HTMLElement | null
		if (el) {
			el.scrollIntoView({behavior: "smooth", block: "center"})
			el.style.background = "var(--bg-hover)"
			setTimeout(() => (el.style.background = ""), 1500)
		}
	}

	return (
		<Show when={props.original}>
			{(original) => (
				<div class="chat-msg-reply-ref" on:click={scrollToReply}>
					<span class="chat-msg-reply-ref-avatar">
						<Show when={avatarBlobUrl()}>
							<img src={avatarBlobUrl()!} />
						</Show>
					</span>
					<span class="chat-msg-reply-ref-name">{original().name}</span>
					<span class="chat-msg-reply-ref-text">
						{original().text || "(attachment)"}
					</span>
				</div>
			)}
		</Show>
	)
}

function Avatar(props: {msg: ResolvedMessage}) {
	const ctx = useChatContext()

	// Prefer gifSelfie over regular avatar
	const avatarSrc = () => props.msg.gifSelfieUrl || props.msg.avatarUrl
	const blobUrl = useBlobUrl(avatarSrc)

	const hasCatEars = () => ctx.catEarsSet.has(props.msg.name)
	const isGif = () => !!props.msg.gifSelfieUrl

	return (
		<div
			class={
				"chat-avatar" +
				(hasCatEars() ? " cat-ears" : "") +
				(isGif() ? " gif-selfie" : "")
			}
			on:click={() => {
				if (ctx.catEarsSet.has(props.msg.name)) ctx.catEarsSet.delete(props.msg.name)
				else ctx.catEarsSet.add(props.msg.name)
			}}
		>
			<Show
				when={blobUrl()}
				fallback={<>{(props.msg.name || "?")[0].toUpperCase()}</>}
			>
				<img src={blobUrl()!} />
			</Show>
		</div>
	)
}

function GifInline(props: {url: string}) {
	const blobUrl = useBlobUrl(() => props.url)

	return (
		<Show when={blobUrl()}>
			<img class="chat-msg-gif-inline" src={blobUrl()!} alt="selfie" />
		</Show>
	)
}

function MessageText(props: {msg: ResolvedMessage; emoticonUrls: Record<string, string>}) {
	return (
		<Show when={props.msg.text}>
			<MessageTextSpan
				text={props.msg.text}
				emoticonUrls={props.emoticonUrls}
				font={props.msg.font}
				color={props.msg.color}
				marquee={props.msg.marquee}
			/>
		</Show>
	)
}

function MessageTextSpan(props: {
	text: string
	emoticonUrls: Record<string, string>
	font?: string
	color?: string
	marquee?: boolean
}) {
	// Side effect: prefetch any uncached emoticon URLs
	createEffect(() => {
		for (const url of Object.values(props.emoticonUrls)) {
			prefetchBlobUrl(url)
		}
	})

	// Pure derivation: read cached blob URLs
	const emoticonBlobUrls = createMemo(() => {
		const urls: Record<string, string> = {}
		for (const [name, automergeUrl] of Object.entries(props.emoticonUrls)) {
			const cached = getCachedBlobUrl(automergeUrl)
			if (cached) urls[name] = cached
		}
		return urls
	})

	const html = createMemo(() => {
		let result = formatText(props.text, emoticonBlobUrls())
		if (props.marquee) result = "<marquee>" + result + "</marquee>"
		return result
	})

	function handleClick(e: MouseEvent) {
		const target = e.target as HTMLElement
		if (target.classList.contains("chat-spoiler")) {
			target.classList.toggle("revealed")
		}
	}

	return (
		<div
			class="chat-msg-text"
			style={{
				"font-family": props.font || undefined,
				color: props.color ? resolveNamedColor(props.color, isLightBg()) : undefined,
			}}
			innerHTML={html()}
			on:click={handleClick}
		/>
	)
}

function Attachments(props: {msg: ResolvedMessage; msgHandle?: DocHandle<any>}) {
	return (
		<>
			<Show when={props.msg.imageUrl}>
				<ImageAttachment
					url={props.msg.imageUrl!}
					name={props.msg.imageName}
					width={props.msg.imageWidth}
					height={props.msg.imageHeight}
				/>
			</Show>
			<Show when={props.msg.voiceUrl}>
				<VoiceNote url={props.msg.voiceUrl!} duration={props.msg.voiceDuration} />
			</Show>
			<Show when={props.msg.embeds}>
				<For each={props.msg.embeds}>
					{(embed, ei) => (
						<EmbedAttachment
							embed={embed}
							msg={props.msg}
							embedIndex={ei()}
							msgHandle={props.msgHandle}
						/>
					)}
				</For>
			</Show>
			<Show when={props.msg.files}>
				<For each={props.msg.files}>
					{(file) => <FileAttachment file={file} />}
				</For>
			</Show>
		</>
	)
}

function ImageAttachment(props: {
	url: string
	name?: string | null
	width?: number
	height?: number
}) {
	const blobUrl = useBlobUrl(() => props.url)

	return (
		<div
			class="chat-msg-image-wrap"
			style={{
				width: (props.width || 350) + "px",
				height: props.height ? props.height + "px" : "auto",
			}}
		>
			<Show when={blobUrl()}>
				<img
					class="chat-msg-image"
					src={blobUrl()!}
					alt={props.name || "image"}
					loading="lazy"
				/>
			</Show>
		</div>
	)
}

function VoiceNote(props: {url: string; duration?: number | null}) {
	const [playing, setPlaying] = createSignal(false)
	const audioUrl = useAudioUrl(() => props.url)
	let audio: HTMLAudioElement | null = null

	const bars = Array.from({length: 24}, () => 3 + Math.random() * 18)

	function toggle() {
		const url = audioUrl()
		if (!url) return

		if (!audio) {
			audio = new Audio(url)
			audio.onended = () => setPlaying(false)
		}

		if (audio.paused) {
			audio.play()
			setPlaying(true)
		} else {
			audio.pause()
			setPlaying(false)
		}
	}

	return (
		<div class="chat-voice-note">
			<button
				class="chat-voice-play-btn"
				on:click={(e) => {
					e.stopPropagation()
					toggle()
				}}
				innerHTML={playing() ? SVG_ICONS.pause : SVG_ICONS.play}
			/>
			<div class="chat-voice-waveform">
				{bars.map((h) => (
					<div class="chat-voice-bar" style={`height:${h}px`} />
				))}
			</div>
			<span class="chat-voice-duration">
				{props.duration ? formatDuration(props.duration) : "0:00"}
			</span>
		</div>
	)
}

function EmbedAttachment(props: {
	embed: any
	msg: ResolvedMessage
	embedIndex: number
	msgHandle?: DocHandle<any>
}) {
	const ctx = useChatContext()

	const embedKey = () => (props.msg.id || "") + "_" + props.embedIndex

	const toolId = () => {
		const doc = ctx.handle.doc()
		return doc?.toolOverrides?.[embedKey()] || ""
	}

	const savedWidth = () => (props.msg as any)["embed_" + props.embedIndex + "Width"]
	const savedHeight = () => (props.msg as any)["embed_" + props.embedIndex + "Height"]

	return (
		<div
			class="chat-msg-embed"
			style={{
				width: savedWidth() ? savedWidth() + "px" : undefined,
				height: savedHeight() ? savedHeight() + "px" : undefined,
			}}
		>
			<patchwork-view
				doc-url={props.embed.docUrl}
				tool-id={toolId() || undefined}
			/>
			<EmbedInfoBar
				embed={props.embed}
				toolId={toolId()}
				embedKey={embedKey()}
			/>
			<ResizeHandle msg={props.msg} sizeKey={"embed_" + props.embedIndex} msgHandle={props.msgHandle} />
		</div>
	)
}

function FileAttachment(props: {file: any}) {
	const blobUrl = useBlobUrl(() => props.file.url)
	const mime = () => props.file.mimeType || ""

	return (
		<Switch fallback={
			<a
				class="chat-msg-file"
				title={props.file.name || "file"}
				href={blobUrl() || undefined}
				download={props.file.name || "file"}
			>
				<span class="chat-msg-file-icon" innerHTML={SVG_ICONS.file} />
				{props.file.name || "file"}
			</a>
		}>
			<Match when={mime().startsWith("image/")}>
				<div class="chat-msg-image-wrap" style="width:350px">
					<Show when={blobUrl()}>
						<img
							class="chat-msg-image"
							src={blobUrl()!}
							alt={props.file.name || "image"}
							loading="lazy"
						/>
					</Show>
				</div>
			</Match>
			<Match when={mime().startsWith("video/")}>
				<div class="chat-msg-video-wrap">
					<Show when={blobUrl()}>
						<video class="chat-msg-video" src={blobUrl()!} controls preload="metadata" />
					</Show>
				</div>
			</Match>
			<Match when={mime().startsWith("audio/")}>
				<Show when={blobUrl()}>
					<audio src={blobUrl()!} controls preload="metadata" style="margin-top:4px" />
				</Show>
			</Match>
		</Switch>
	)
}

function Reactions(props: {
	msg: ResolvedMessage
	rawIdx: number
	emoticonUrls: Record<string, string>
	msgHandle?: DocHandle<any>
}) {
	const ctx = useChatContext()
	const reactions = () => props.msg.reactions
	const hasReactions = () => reactions() && Object.keys(reactions()!).length > 0

	return (
		<Show when={hasReactions()}>
		<div class="chat-reactions">
			<For each={Object.entries(reactions()!)}>
				{([emoji, names]) => {
					if (!names || names.length === 0) return null
					const isMine = () => names.includes(ctx.myName())
					const emoticonMatch = emoji.match(/^:([a-zA-Z0-9_-]+):$/)

					// Load emoticon blob if needed
					const emoticonBlobUrl = useBlobUrl(() => {
						if (!emoticonMatch) return null
						return props.emoticonUrls[emoticonMatch[1]] || null
					})

					return (
						<span
							class={"chat-reaction" + (isMine() ? " mine" : "")}
							title={names.join(", ")}
							on:click={(e) => {
								e.stopPropagation()
								ctx.toggleReaction(props.rawIdx, emoji, props.msgHandle)
							}}
						>
							<Show
								when={emoticonMatch && emoticonBlobUrl()}
								fallback={<>{emoji + " "}</>}
							>
								<img
									class="chat-emoticon-inline"
									src={emoticonBlobUrl()!}
									alt={emoji}
								/>{" "}
							</Show>
							<span class="chat-reaction-count">{names.length}</span>
						</span>
					)
				}}
			</For>
			<button
				class="chat-reaction-add"
				innerHTML={SVG_ICONS.plus}
				on:click={(e) => {
					e.stopPropagation()
					ctx.openEmojiPicker(props.rawIdx, e.currentTarget as HTMLElement)
				}}
			/>
		</div>
		</Show>
	)
}

function MessageActions(props: {rawIdx: number; msgId: string; timestamp: number; msgName?: string; msgText?: string; msgHandle?: DocHandle<any>}) {
	const ctx = useChatContext()
	const [menuOpen, setMenuOpen] = createSignal(false)

	return (
		<div class="chat-msg-actions">
			<button
				class="chat-msg-action-btn"
				title="Reply"
				innerHTML={SVG_ICONS.reply}
				on:click={(e) => {
					e.stopPropagation()
					const preview = props.msgName
						? props.msgName + ": " + (props.msgText || "(attachment)")
						: undefined
					ctx.setReply(props.msgId, preview)
				}}
			/>
			<button
				class="chat-msg-action-btn"
				title="Add reaction"
				innerHTML={SVG_ICONS.react}
				on:click={(e) => {
					e.stopPropagation()
					ctx.openEmojiPicker(props.rawIdx, e.currentTarget as HTMLElement)
				}}
			/>
			<div class="chat-msg-menu-wrap">
				<button
					class="chat-msg-action-btn"
					title="More"
					innerHTML={SVG_ICONS.more}
					on:click={(e) => {
						e.stopPropagation()
						setMenuOpen(!menuOpen())
					}}
				/>
				<Show when={menuOpen()}>
					<div class="chat-msg-menu show">
						<button
							class="chat-msg-menu-item danger"
							on:click={(e) => {
								e.stopPropagation()
								setMenuOpen(false)
								ctx.deleteMessage(props.rawIdx)
							}}
						>
							<span innerHTML={SVG_ICONS.trash} /> Delete
						</button>
					</div>
				</Show>
			</div>
			<span class="chat-msg-inline-time">{formatTime(props.timestamp)}</span>
		</div>
	)
}

function ResizeHandle(props: {msg: ResolvedMessage; sizeKey: string; msgHandle?: DocHandle<any>}) {
	const ctx = useChatContext()

	function onPointerDown(e: PointerEvent) {
		e.preventDefault()
		e.stopPropagation()
		const grip = e.currentTarget as HTMLElement
		const container = grip.parentElement!
		grip.setPointerCapture(e.pointerId)
		const startX = e.clientX, startY = e.clientY
		const startW = container.offsetWidth, startH = container.offsetHeight

		function onMove(ev: PointerEvent) {
			const w = Math.max(100, startW + ev.clientX - startX)
			const h = Math.max(60, startH + ev.clientY - startY)
			container.style.width = w + "px"
			container.style.height = h + "px"
		}

		function onUp(ev: PointerEvent) {
			grip.releasePointerCapture(ev.pointerId)
			grip.removeEventListener("pointermove", onMove)
			grip.removeEventListener("pointerup", onUp)
			grip.removeEventListener("lostpointercapture", onUp)
			const w = container.offsetWidth, h = container.offsetHeight
			if (props.msgHandle) {
				props.msgHandle.change((d: any) => {
					d[props.sizeKey + "Width"] = w
					d[props.sizeKey + "Height"] = h
				})
			} else {
				ctx.handle.change((d) => {
					const m = d.messages?.[props.msg._rawIdx] as any
					if (!m) return
					m[props.sizeKey + "Width"] = w
					m[props.sizeKey + "Height"] = h
				})
			}
		}

		grip.addEventListener("pointermove", onMove)
		grip.addEventListener("pointerup", onUp)
		grip.addEventListener("lostpointercapture", onUp)
	}

	return (
		<div
			class="chat-resize-handle"
			on:pointerdown={onPointerDown}
			innerHTML='<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1L1 9M9 5L5 9M9 8L8 9"/></svg>'
		/>
	)
}
