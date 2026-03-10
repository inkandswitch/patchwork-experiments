import {
	Index,
	Show,
	createSignal,
	createMemo,
	createEffect,
	onCleanup,
} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import type {ChatMessage, ChatMessageRef} from "../types"
import {MessageRow} from "./MessageRow"
import {formatTimeGap} from "../lib/helpers"

export function MessageList(props: {
	replyToId: string | null
	onReply: (msgId: string) => void
	onReact: (idx: number, anchorEl: HTMLElement) => void
}) {
	let messagesRef!: HTMLDivElement
	const {handle, doc, repo} = useChat()
	const {myName} = useIdentity()
	const {peerEmoticons} = usePresence()

	// Message doc cache (for ref messages)
	const [msgDocCache, setMsgDocCache] = createSignal(
		new Map<string, {data: ChatMessage; handle: any}>()
	)

	// Track which URLs we've started resolving — prevents duplicate async calls
	const pendingResolves = new Set<string>()
	const subscribedUrls = new Set<string>()
	const subscriptions: {handle: any; cb: () => void}[] = []

	onCleanup(() => {
		for (const sub of subscriptions) {
			try { sub.handle.off("change", sub.cb) } catch {}
		}
		subscriptions.length = 0
	})

	async function resolveMessageDoc(url: AutomergeUrl) {
		if (pendingResolves.has(url)) return
		pendingResolves.add(url)
		try {
			const mh = await repo.find(url)
			const data = mh.doc() as ChatMessage
			if (data) {
				setMsgDocCache(prev => {
					const next = new Map(prev)
					next.set(url, {data, handle: mh})
					return next
				})
			}
			if (!subscribedUrls.has(url)) {
				subscribedUrls.add(url)
				const cb = () => {
					const updated = mh.doc() as ChatMessage
					if (updated) {
						setMsgDocCache(prev => {
							const next = new Map(prev)
							next.set(url, {data: updated, handle: mh})
							return next
						})
					}
				}
				mh.on("change", cb)
				subscriptions.push({handle: mh, cb})
			}
			// If doc() was null (not synced yet), the "change" listener above
			// will update the cache when it arrives. But make sure we're not stuck.
			if (!data) {
				// Remove from pending so the effect can retry if needed
				pendingResolves.delete(url)
			}
		} catch (e) {
			console.warn("[Chat] resolve msg doc:", e)
			// Allow retry on failure
			pendingResolves.delete(url)
		}
	}

	// Retry counter signal — bump to trigger re-resolution of failed message docs
	const [retryTick, setRetryTick] = createSignal(0)

	// Effect to load uncached message refs — separated from the memo to avoid
	// triggering side effects inside a computation
	createEffect(() => {
		const d = doc()
		if (!d) return
		const rawEntries = d.messages || []
		const cache = msgDocCache()
		const _tick = retryTick() // subscribe to retry ticks

		let hasUnresolved = false
		for (const entry of rawEntries as any[]) {
			if (entry.ref && entry.url && !cache.has(entry.url)) {
				if (!pendingResolves.has(entry.url)) {
					resolveMessageDoc(entry.url)
				}
				hasUnresolved = true
			}
		}

		// If there are still unresolved messages, schedule a retry
		if (hasUnresolved) {
			setTimeout(() => setRetryTick(t => t + 1), 2000)
		}
	})

	// Resolve messages from doc entries (pure computation, no side effects)
	const messages = createMemo(() => {
		const d = doc()
		if (!d) return []
		const rawEntries = d.messages || []
		const cache = msgDocCache()
		const result: ChatMessage[] = []

		for (let ri = 0; ri < rawEntries.length; ri++) {
			const entry = rawEntries[ri] as any
			if (entry.ref && entry.url) {
				const cached = cache.get(entry.url)
				if (cached) {
					const msg = {...cached.data, _rawIdx: ri, _ref: entry}
					// Clear stale streaming flag (>2 min old)
					if (msg.streaming && msg.timestamp && Date.now() - msg.timestamp > 120000) {
						msg.streaming = false
					}
					result.push(msg)
				} else {
					result.push({
						_loading: true,
						_rawIdx: ri,
						id: "_loading_" + entry.url,
						timestamp: entry.timestamp || 0,
						name: "",
						text: "",
					})
				}
			} else {
				// Inline message
				result.push({...entry, _rawIdx: ri})
			}
		}

		return result
	})

	// Message map for reply lookups
	const msgMap = createMemo(() => {
		const map = new Map<string, ChatMessage>()
		for (const m of messages()) {
			if (m.id) map.set(m.id, m)
		}
		return map
	})

	// Resolve emoticon URLs for rendering
	const emoticonBlobUrls = createMemo(() => {
		const urls: Record<string, string> = {}
		for (const [, emoticons] of peerEmoticons()) {
			for (const [name, url] of Object.entries(emoticons)) {
				if (!urls[name]) urls[name] = "/" + encodeURIComponent(url) + "/"
			}
		}
		for (const msg of messages()) {
			if (msg.emoticons) {
				for (const [name, url] of Object.entries(msg.emoticons)) {
					if (!urls[name]) urls[name] = "/" + encodeURIComponent(url) + "/"
				}
			}
		}
		return urls
	})

	// Auto-scroll to bottom
	const [wasAtBottom, setWasAtBottom] = createSignal(true)

	function checkScroll() {
		if (!messagesRef) return
		const atBottom =
			messagesRef.scrollHeight - messagesRef.scrollTop - messagesRef.clientHeight < 40
		setWasAtBottom(atBottom)
	}

	createEffect(() => {
		const _msgs = messages()
		if (wasAtBottom() && messagesRef) {
			requestAnimationFrame(() => {
				messagesRef.scrollTop = messagesRef.scrollHeight
			})
		}
	})

	// Continuation logic
	function isContinuation(msg: ChatMessage, prevMsg: ChatMessage | undefined): boolean {
		if (!prevMsg) return false
		if (msg.replyTo) return false
		if (msg.name !== prevMsg.name) return false
		if (msg.timestamp - prevMsg.timestamp > 5 * 60 * 1000) return false
		return true
	}

	// Pre-compute per-message display metadata so <For> callback doesn't read messages()
	const messagesMeta = createMemo(() => {
		const msgs = messages()
		return msgs.map((msg, i) => {
			const prev = i > 0 ? msgs[i - 1] : undefined
			return {
				isContinuation: isContinuation(msg, prev),
				showTimeGap: prev ? msg.timestamp - prev.timestamp >= 120000 : false,
			}
		})
	})

	function toggleReaction(idx: number, emoji: string) {
		const d = doc()
		const entry = d?.messages?.[idx] as any
		if (!entry) return
		const name = myName()

		if (entry.ref && entry.url) {
			const cached = msgDocCache().get(entry.url)
			if (!cached) return
			cached.handle.change((d: any) => {
				if (!d.reactions) d.reactions = {}
				if (!d.reactions[emoji]) d.reactions[emoji] = []
				const arr = d.reactions[emoji]
				const i = arr.indexOf(name)
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete d.reactions[emoji]
				} else arr.push(name)
			})
		} else {
			handle.change((d: any) => {
				const msg = d.messages[idx]
				if (!msg) return
				if (!msg.reactions) msg.reactions = {}
				if (!msg.reactions[emoji]) msg.reactions[emoji] = []
				const arr = msg.reactions[emoji]
				const i = arr.indexOf(name)
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete msg.reactions[emoji]
				} else arr.push(name)
			})
		}
	}

	function deleteMessage(idx: number) {
		handle.change((d: any) => {
			if (!d.messages || idx < 0 || idx >= d.messages.length) return
			d.messages.splice(idx, 1)
		})
	}

	function scrollToMsg(msgId: string) {
		const el = messagesRef?.querySelector(`[data-msg-id="${msgId}"]`)
		if (el) {
			el.scrollIntoView({behavior: "smooth", block: "center"})
			el.classList.add("chat-msg-highlight")
			setTimeout(() => el.classList.remove("chat-msg-highlight"), 1500)
		}
	}

	return (
		<div
			ref={messagesRef}
			class="chat-messages"
			onScroll={checkScroll}
		>
			<Show
				when={messages().length > 0}
				fallback={<div class="chat-empty">no messages yet. say hello</div>}
			>
				<Index each={messages()}>
					{(msg, i) => {
						const meta = () => messagesMeta()[i]
						return (
						<div data-msg-id={msg().id}>
							<Show when={meta()?.showTimeGap}>
								<div class="chat-time-gap">{formatTimeGap(msg().timestamp)}</div>
							</Show>
							<MessageRow
								msg={msg()}
								isContinuation={meta()?.isContinuation ?? false}
								replyToMsg={msg().replyTo ? msgMap().get(msg().replyTo!) : undefined}
								emoticonBlobUrls={emoticonBlobUrls()}
								onReply={props.onReply}
								onReact={props.onReact}
								onToggleReaction={toggleReaction}
								onDelete={deleteMessage}
								onScrollToMsg={scrollToMsg}
							/>
						</div>
						)
					}}
				</Index>
			</Show>
		</div>
	)
}
