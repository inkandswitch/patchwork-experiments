import {Show, createMemo, createEffect} from "solid-js"
import type {ChatMessage} from "../types"
import {formatText, isEmojiOnly} from "../lib/format-text"
import {highlightCode} from "../lib/highlighter"
import {ensureFontLoaded} from "../lib/blob-cache"
import {resolveNamedColor} from "../lib/named-colors"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {useTheme} from "../context/ThemeContext"
import {VoiceNote} from "./VoiceNote"
import {MessageAttachments} from "./MessageAttachments"
import {RichBlockList} from "./RichBlockView"

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

	const html = createMemo(() => {
		if (!props.msg.text) return ""
		return formatText(props.msg.text, props.emoticonBlobUrls)
	})

	const emojiOnly = createMemo(() =>
		props.msg.text ? isEmojiOnly(props.msg.text) : false
	)

	let textRef!: HTMLDivElement

	// Highlight fenced code blocks with shiki after render
	createEffect(() => {
		const _ = html() // track
		const light = isLightBg()
		if (!textRef) return
		queueMicrotask(() => {
			// Find unprocessed code blocks or already-highlighted shiki blocks
			const codeEls = textRef.querySelectorAll("code[data-lang]")
			const shikiEls = textRef.querySelectorAll(".shiki[data-lang][data-code]")

			// Process new code blocks
			for (const el of codeEls) {
				const lang = el.getAttribute("data-lang") || ""
				const code = el.textContent || ""
				highlightCode(code, lang || undefined, light).then(highlighted => {
					const pre = el.closest("pre")
					if (pre && pre.parentNode) {
						const wrapper = document.createElement("div")
						wrapper.innerHTML = highlighted
						const newEl = wrapper.firstElementChild
						if (newEl) {
							newEl.setAttribute("data-lang", lang)
							newEl.setAttribute("data-code", btoa(encodeURIComponent(code)))
							pre.replaceWith(newEl)
						}
					}
				})
			}

			// Re-highlight existing shiki blocks (theme change)
			for (const el of shikiEls) {
				const lang = el.getAttribute("data-lang") || ""
				const code = decodeURIComponent(atob(el.getAttribute("data-code") || ""))
				if (!code) continue
				highlightCode(code, lang || undefined, light).then(highlighted => {
					const wrapper = document.createElement("div")
					wrapper.innerHTML = highlighted
					const newEl = wrapper.firstElementChild
					if (newEl && el.parentNode) {
						newEl.setAttribute("data-lang", lang)
						newEl.setAttribute("data-code", el.getAttribute("data-code") || "")
						el.replaceWith(newEl)
					}
				})
			}
		})
	})

	return (
		<>
			<Show when={props.msg.text || props.msg.streaming}>
				<div
					ref={textRef}
					class="chat-msg-text"
					classList={{
						"emoji-only": emojiOnly(),
						streaming: props.msg.streaming,
					}}
					style={{
					...(props.msg.font ? {"font-family": props.msg.font} : {}),
					...(resolvedColor() ? {color: resolvedColor()} : {}),
				}}
					innerHTML={props.msg.text
						? (props.msg.marquee ? "<marquee>" + html() + "</marquee>" : html())
						: ""}
					onClick={(e) => {
						// Handle spoiler reveals
						const target = e.target as HTMLElement
						if (target.classList.contains("chat-spoiler")) {
							target.classList.toggle("revealed")
						}
					}}
				/>
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
