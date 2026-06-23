import {Show, Index, Switch, Match, createMemo, createEffect, createSignal} from "solid-js"
import type {ChatMessage} from "../types"
import {parseTextSegments, isEmojiOnly} from "../lib/format-text"
import type {TextSegment} from "../lib/format-text"
import {highlightCode} from "../lib/highlighter"
import {ensureFontLoaded} from "../lib/blob-cache"
import {resolveNamedColor} from "../lib/named-colors"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {useTheme} from "../context/ThemeContext"
import {VoiceNote} from "./VoiceNote"
import {MessageAttachments} from "./MessageAttachments"
import {RichBlockList} from "./RichBlockView"

function ThinkBlock(props: {content: string}) {
	const [open, setOpen] = createSignal(true)
	return (
		<details class="chat-think-block" open={open()} on:toggle={(e: Event) => setOpen((e.target as HTMLDetailsElement).open)}>
			<summary>thinking</summary>
			<div class="chat-think-content">{props.content}</div>
		</details>
	)
}

function CodeBlock(props: {lang: string; code: string}) {
	const {isLightBg} = useTheme()
	let containerRef!: HTMLDivElement
	let isHighlighted = false
	let highlightTimer: number | undefined
	let lastHighlightedCode = ""

	// Update code content — either update the text node or re-highlight
	createEffect(() => {
		const code = props.code.replace(/\n$/, "")
		if (!containerRef) return

		if (!isHighlighted) {
			// Plain mode: just update the code element's text
			const codeEl = containerRef.querySelector("code")
			if (codeEl) codeEl.textContent = code
		} else {
			// Already highlighted: update the shiki code element's text
			const shikiCode = containerRef.querySelector(".shiki code")
			if (shikiCode) shikiCode.textContent = code
		}
	})

	// Debounced highlighting
	createEffect(() => {
		const code = props.code.replace(/\n$/, "")
		const lang = props.lang
		const light = isLightBg()
		if (!containerRef) return

		clearTimeout(highlightTimer)
		highlightTimer = setTimeout(() => {
			if (code === lastHighlightedCode) return
			if (!lang) return
			lastHighlightedCode = code
			highlightCode(code, lang, light).then(html => {
				if (!containerRef?.parentNode) return
				// Only apply if code hasn't changed while highlighting
				if (props.code.replace(/\n$/, "") !== code) return
				containerRef.innerHTML = html
				isHighlighted = true
			})
		}, 200) as unknown as number
	})

	return (
		<div ref={containerRef} class="chat-code-block">
			<pre><code>{props.code.replace(/\n$/, "")}</code></pre>
		</div>
	)
}

function InlineHtml(props: {html: string}) {
	return (
		<span
			innerHTML={props.html}
			on:click={(e) => {
				const target = e.target as HTMLElement
				if (target.classList.contains("chat-spoiler")) {
					target.classList.toggle("revealed")
				}
			}}
		/>
	)
}

export function MessageBody(props: {
	msg: ChatMessage
	emoticonBlobUrls: Record<string, string>
}) {
	const {myFonts} = useIdentity()
	const {peerFonts} = usePresence()
	const {isLightBg} = useTheme()

	const resolvedColor = createMemo(() => {
		if (!props.msg.color) return undefined
		return resolveNamedColor(props.msg.color, isLightBg())
	})

	createEffect(() => {
		if (props.msg.font) {
			ensureFontLoaded(props.msg.font, myFonts(), peerFonts())
		}
	})

	const segments = createMemo(() => {
		if (!props.msg.text) return []
		return parseTextSegments(props.msg.text, props.emoticonBlobUrls)
	})

	const emojiOnly = createMemo(() =>
		props.msg.text ? isEmojiOnly(props.msg.text) : false
	)

	return (
		<>
			<Show when={props.msg.text || props.msg.streaming}>
				<div
					class="chat-msg-text"
					classList={{
						"emoji-only": emojiOnly(),
						streaming: props.msg.streaming,
					}}
					style={{
						...(props.msg.font ? {"font-family": props.msg.font} : {}),
						...(resolvedColor() ? {color: resolvedColor()} : {}),
					}}
				>
					<Show when={props.msg.marquee}>
						<marquee>
							<Index each={segments()}>
								{(seg) => <SegmentView segment={seg()} />}
							</Index>
						</marquee>
					</Show>
					<Show when={!props.msg.marquee}>
						<Index each={segments()}>
							{(seg) => <SegmentView segment={seg()} />}
						</Index>
					</Show>
				</div>
			</Show>
			<Show when={props.msg.voiceUrl}>
				<VoiceNote
					voiceUrl={props.msg.voiceUrl!}
					duration={props.msg.voiceDuration || 0}
				/>
			</Show>
			<Show when={props.msg.richBlocks?.length}>
				<RichBlockList blocks={props.msg.richBlocks!} />
			</Show>
			<MessageAttachments msg={props.msg} />
		</>
	)
}

function SegmentView(props: {segment: TextSegment}) {
	return (
		<Switch>
			<Match when={props.segment.type === "html" && props.segment as TextSegment & {type: "html"}}>
				{(seg) => <InlineHtml html={seg().content} />}
			</Match>
			<Match when={props.segment.type === "think" && props.segment as TextSegment & {type: "think"}}>
				{(seg) => <ThinkBlock content={seg().content} />}
			</Match>
			<Match when={props.segment.type === "code" && props.segment as TextSegment & {type: "code"}}>
				{(seg) => <CodeBlock lang={(seg() as any).lang} code={(seg() as any).code} />}
			</Match>
		</Switch>
	)
}
