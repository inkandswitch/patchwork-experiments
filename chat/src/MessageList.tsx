import {For, Show, Suspense, createEffect, createMemo} from "solid-js"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import type {MessageEntry, MessageRef, MessageData, InlineMessage, ResolvedMessage} from "./types"
import {useDocument} from "@automerge/automerge-repo-solid-primitives"
import {useChatContext} from "./context"
import {Message} from "./Message"

export function MessageList(props: {
	entries: MessageEntry[]
	ref: (el: HTMLDivElement) => void
	onScroll: () => void
}) {
	let scrollRef: HTMLDivElement | undefined
	let wasAtBottom = true

	// Auto-scroll when new messages arrive
	createEffect(() => {
		const len = props.entries.length
		if (!scrollRef) return
		requestAnimationFrame(() => {
			if (wasAtBottom || scrollRef!.children.length <= 1) {
				scrollRef!.scrollTop = scrollRef!.scrollHeight
			}
		})
	})

	function handleScroll() {
		if (scrollRef) {
			wasAtBottom = scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight < 40
		}
		props.onScroll()
	}

	return (
		<div
			class="chat-messages"
			ref={(el) => {
				scrollRef = el
				props.ref(el)
			}}
			on:scroll={handleScroll}
		>
			<Show when={props.entries.length === 0}>
				<div class="chat-empty">no messages yet. say hello 🥰</div>
			</Show>

			<For each={props.entries}>
				{(entry, idx) => (
					<MessageSlot
						entry={entry}
						idx={idx()}
						prevEntry={idx() > 0 ? props.entries[idx() - 1] : null}
						allEntries={props.entries}
					/>
				)}
			</For>
		</div>
	)
}

/**
 * A slot that handles loading for ref messages via Suspense.
 * Inline messages render immediately.
 */
function MessageSlot(props: {
	entry: MessageEntry
	idx: number
	prevEntry: MessageEntry | null
	allEntries: MessageEntry[]
}) {
	const isRef = () => "ref" in props.entry && props.entry.ref

	return (
		<Show
			when={isRef()}
			fallback={
				<InlineMessageSlot
					entry={props.entry as InlineMessage}
					idx={props.idx}
					prevEntry={props.prevEntry}
					allEntries={props.allEntries}
				/>
			}
		>
			<Suspense fallback={<MessageSkeleton />}>
				<RefMessageSlot
					entry={props.entry as MessageRef}
					idx={props.idx}
					prevEntry={props.prevEntry}
					allEntries={props.allEntries}
				/>
			</Suspense>
		</Show>
	)
}

/**
 * Handles a ref message - uses createResource for lazy loading.
 */
function RefMessageSlot(props: {
	entry: MessageRef
	idx: number
	prevEntry: MessageEntry | null
	allEntries: MessageEntry[]
}) {
	const ctx = useChatContext()
	const [doc, handleResource] = useDocument<MessageData>(() => props.entry.url as AutomergeUrl | undefined, {repo: ctx.repo})

	// Derive resolved message from resource
	const resolved = createMemo((): ResolvedMessage | null => {
		const d = doc()
		if (!d) return null
		return {
			...d,
			_rawIdx: props.idx,
			_ref: props.entry,
			_handle: handleResource(),
		}
	})

	// Load prev ref doc for continuation check
	const prevRefUrl = () => {
		const pe = props.prevEntry
		if (pe && "ref" in pe && pe.ref) return pe.url as AutomergeUrl | undefined
		return undefined
	}
	const [prevRefDoc] = useDocument<MessageData>(prevRefUrl, {repo: ctx.repo})

	// Check continuation against previous message
	const isContinuation = createMemo(() => {
		const msg = resolved()
		if (!msg || msg.replyTo) return false
		const prev = resolvePrevMessage(props.prevEntry, prevRefDoc())
		if (!prev) return false
		return msg.name === prev.name && msg.timestamp - prev.timestamp < 300000
	})

	return (
		<Show
			when={resolved()}
			fallback={<MessageUnavailable url={props.entry.url} />}
		>
			{(msg) => (
				<Message
					msg={msg()}
					isContinuation={isContinuation()}
					allEntries={props.allEntries}
				/>
			)}
		</Show>
	)
}

/**
 * Handles an inline message (no loading needed).
 */
function InlineMessageSlot(props: {
	entry: InlineMessage
	idx: number
	prevEntry: MessageEntry | null
	allEntries: MessageEntry[]
}) {
	const ctx = useChatContext()
	const resolved = createMemo((): ResolvedMessage => ({
		...props.entry,
		_rawIdx: props.idx,
	}))

	// Load prev ref doc for continuation check
	const prevRefUrl = () => {
		const pe = props.prevEntry
		if (pe && "ref" in pe && pe.ref) return pe.url as AutomergeUrl | undefined
		return undefined
	}
	const [prevRefDoc] = useDocument<MessageData>(prevRefUrl, {repo: ctx.repo})

	const isContinuation = createMemo(() => {
		const msg = resolved()
		if (msg.replyTo) return false
		const prev = resolvePrevMessage(props.prevEntry, prevRefDoc())
		if (!prev) return false
		return msg.name === prev.name && msg.timestamp - prev.timestamp < 300000
	})

	return (
		<Message
			msg={resolved()}
			isContinuation={isContinuation()}
			allEntries={props.allEntries}
		/>
	)
}

/**
 * Helper to get the previous message's data for continuation check.
 * Works with both inline and ref messages.
 */
function resolvePrevMessage(
	prevEntry: MessageEntry | null,
	prevRefDoc?: MessageData
): {name: string; timestamp: number} | null {
	if (!prevEntry) return null
	if ("ref" in prevEntry && prevEntry.ref) {
		if (prevRefDoc) return {name: prevRefDoc.name, timestamp: prevRefDoc.timestamp}
		return null
	}
	return {name: (prevEntry as InlineMessage).name, timestamp: (prevEntry as InlineMessage).timestamp}
}

function MessageSkeleton() {
	return (
		<div class="chat-msg-skeleton">
			<div class="chat-msg-skeleton-avatar" />
			<div class="chat-msg-skeleton-body">
				<div class="chat-msg-skeleton-line short" />
				<div class="chat-msg-skeleton-line" />
			</div>
		</div>
	)
}

function MessageUnavailable(props: {url: string}) {
	const shortUrl = () => props.url.replace("automerge:", "").slice(0, 8)
	return (
		<div class="chat-msg-unavailable">
			message unavailable — {shortUrl()}…
		</div>
	)
}
