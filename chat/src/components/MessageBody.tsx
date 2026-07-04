import {Show, Index, For, Switch, Match, createMemo, createEffect, createSignal, onCleanup} from "solid-js"
import type {ChatMessage} from "../types"
import {parseTextSegments, isEmojiOnly} from "../lib/format-text"
import type {TextSegment} from "../lib/format-text"
import {resolvePlugins} from "../lib/registry"
import {parserExtensionPlugins, toInlineRule} from "../lib/parser-extensions"
import {highlightCode} from "../lib/highlighter"
import {ensureFontLoaded} from "../lib/blob-cache"
import {resolveNamedColor} from "../lib/named-colors"
import {generateId} from "../lib/helpers"
import {useChat} from "../context/ChatContext"
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
			<summary>computing</summary>
			<div class="chat-think-content">{props.content}</div>
		</details>
	)
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Keep-last-good, coalesced, never-regress highlighting.
//
// The old design ran two fighting effects: one wrote textContent onto the
// highlighted element (nuking shiki's spans → highlighting "disappeared"), and a
// 200ms-debounced one swapped innerHTML wholesale, dropping to plain text in
// between (→ flicker while streaming). Instead we hold the highlighted HTML in a
// signal, coalesce re-highlights to one per animation frame, discard stale async
// results by request-id, and NEVER swap back to plain once we have a highlight.
// (shiki re-tokenizes the whole snippet per update — fine at chat-snippet size and
//  now bounded to one call per frame.)
function CodeBlock(props: {lang: string; code: string}) {
	const {isLightBg} = useTheme()
	const [html, setHtml] = createSignal<string | null>(null)
	let reqId = 0
	let frame: number | undefined

	createEffect(() => {
		const code = props.code.replace(/\n$/, "")
		const lang = props.lang
		const light = isLightBg()
		// No language → leave the plain <pre> fallback in place, no shiki.
		if (!lang) return

		if (frame !== undefined) cancelAnimationFrame(frame)
		frame = requestAnimationFrame(() => {
			frame = undefined
			const id = ++reqId
			highlightCode(code, lang, light).then(out => {
				// A newer tick superseded this one — drop the stale result so we
				// never regress to older/plainer output.
				if (id !== reqId) return
				setHtml(out)
			})
		})
	})

	onCleanup(() => {
		if (frame !== undefined) cancelAnimationFrame(frame)
	})

	// Plain, escaped fallback shown only until the first highlight lands.
	const plain = () =>
		"<pre><code>" + escapeHtml(props.code.replace(/\n$/, "")) + "</code></pre>"

	return <div class="chat-code-block" innerHTML={html() ?? plain()} />
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
	const {selector, hasFeature} = useChat()

	// Active inline delimiter rules from the chat:parser-extension registry,
	// filtered by this tool's feature selector (core = *bold*/_italic_ only).
	const inlineRules = createMemo(() =>
		resolvePlugins(
			"chat:parser-extension",
			parserExtensionPlugins,
			selector()
		).map(toInlineRule)
	)

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
		return parseTextSegments(props.msg.text, {
			emoticonBlobUrls: props.emoticonBlobUrls,
			rules: inlineRules(),
			allowEmoticons: hasFeature("emoticons"),
			allowThink: hasFeature("computer"),
		})
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
			<Show when={props.msg.quickReplies?.length}>
				<QuickReplies options={props.msg.quickReplies!} />
			</Show>
			<MessageAttachments msg={props.msg} />
		</>
	)
}

/** Clickable answer buttons for an ask_user question — sends the choice as a message. */
function QuickReplies(props: {options: string[]}) {
	const {handle, repo} = useChat()
	const {myName, myContactUrl} = useIdentity()
	const [used, setUsed] = createSignal(false)

	async function pick(opt: string) {
		if (used()) return
		setUsed(true)
		const msgData: any = {
			id: generateId(),
			name: myName(),
			text: opt,
			timestamp: Date.now(),
		}
		const cu = myContactUrl()
		if (cu) msgData.contactUrl = cu
		const mh = await repo.create2(msgData)
		handle.change((d: any) => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: mh.url, timestamp: msgData.timestamp})
		})
	}

	return (
		<div class="chat-quick-replies">
			<For each={props.options}>
				{(opt) => (
					<button
						class="chat-quick-reply"
						disabled={used()}
						on:click={() => pick(opt)}>
						{opt}
					</button>
				)}
			</For>
		</div>
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
