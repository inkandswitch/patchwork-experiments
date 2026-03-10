import {createSignal, For, Show, createMemo} from "solid-js"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {automergeUrlToServiceWorkerUrl} from "@inkandswitch/patchwork-filesystem"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {
	EMOJI_DATA,
	EMOJI_LOADED,
	FALLBACK_EMOJIS,
	QUICK_EMOJIS,
} from "../lib/emoji-data"

export function EmojiPicker(props: {
	targetIdx: number | null
	anchorEl: HTMLElement | null
	onClose: () => void
}) {
	const {handle, doc} = useChat()
	const {myName, myEmoticons, setMyEmoticons, chatProfileHandle} = useIdentity()
	const {peerEmoticons} = usePresence()
	const [filter, setFilter] = createSignal("")

	const emojis = createMemo(() => {
		const q = filter().toLowerCase()
		if (!q) {
			if (EMOJI_LOADED()) {
				return EMOJI_DATA().slice(0, 160).map((e) => e.emoji)
			}
			return FALLBACK_EMOJIS
		}
		if (EMOJI_LOADED()) {
			return EMOJI_DATA().filter((e) => e.name.toLowerCase().includes(q))
				.slice(0, 80)
				.map((e) => e.emoji)
		}
		return FALLBACK_EMOJIS
	})

	// Collect all emoticons: own + peers
	const ownEmoticonEntries = createMemo(() => {
		const mine = myEmoticons()
		return Object.entries(mine).filter(([name]) => {
			const q = filter().toLowerCase()
			return !q || name.toLowerCase().includes(q)
		})
	})

	const peerEmoticonEntries = createMemo(() => {
		const mine = myEmoticons()
		const result: {name: string; url: AutomergeUrl; peerName: string}[] = []
		const q = filter().toLowerCase()
		for (const [peerName, emoticons] of peerEmoticons()) {
			for (const [name, url] of Object.entries(emoticons)) {
				if (mine[name]) continue // Already own it
				if (q && !name.toLowerCase().includes(q)) continue
				result.push({name, url, peerName})
			}
		}
		return result
	})

	function adoptEmoticon(name: string, url: AutomergeUrl) {
		if (myEmoticons()[name]) return
		const updated = {...myEmoticons(), [name]: url}
		setMyEmoticons(updated)
		const ph = chatProfileHandle()
		if (ph) {
			ph.change((d: any) => {
				if (!d.emoticons) d.emoticons = {}
				d.emoticons[name] = url
			})
		}
		// Also add to chat doc
		handle.change((d: any) => {
			if (!d.docs) d.docs = []
			const existing = d.docs.find((dl: any) => dl.url === url)
			if (!existing) {
				d.docs.push({url, type: "file", name: "emoticon-" + name})
			}
		})
	}

	async function selectEmoji(emoji: string) {
		if (props.targetIdx === null) return
		const d = doc()
		const entry = d?.messages?.[props.targetIdx] as any
		if (!entry) return
		const name = myName()

		if (entry.ref && entry.url) {
			try {
				const repo = (window as any).repo
				if (!repo) return
				const mh = await repo.find(entry.url)
				mh.change((md: any) => {
					if (!md.reactions) md.reactions = {}
					if (!md.reactions[emoji]) md.reactions[emoji] = []
					const arr = md.reactions[emoji]
					const i = arr.indexOf(name)
					if (i >= 0) {
						arr.splice(i, 1)
						if (arr.length === 0) delete md.reactions[emoji]
					} else arr.push(name)
				})
			} catch (e) {
				console.warn("[Chat] emoji picker reaction:", e)
			}
		} else {
			handle.change((d: any) => {
				const msg = d.messages[props.targetIdx!]
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
		props.onClose()
	}

	// Position near anchor
	const style = () => {
		if (!props.anchorEl) return {}
		const rect = props.anchorEl.getBoundingClientRect()
		return {
			position: "fixed" as const,
			top: rect.bottom + 4 + "px",
			right: window.innerWidth - rect.right + "px",
		}
	}

	return (
		<div
			class="chat-emoji-picker-overlay show"
			on:click={props.onClose}
		>
			<div
				class="chat-emoji-picker"
				style={style()}
				on:click={(e) => e.stopPropagation()}
			>
				<input
					class="chat-emoji-picker-search"
					placeholder="Search emoji..."
					value={filter()}
					on:input={(e) => setFilter(e.currentTarget.value)}
					autofocus
				/>

				{/* Quick emojis */}
				<Show when={!filter()}>
					<div class="chat-emoji-grid" style="margin-bottom:6px">
						<For each={QUICK_EMOJIS}>
							{(emoji) => (
								<button on:click={() => selectEmoji(emoji)}>{emoji}</button>
							)}
						</For>
					</div>
				</Show>

				<div class="chat-emoji-picker-scroll">
					{/* Own emoticons */}
					<Show when={ownEmoticonEntries().length > 0}>
						<div class="chat-emoticon-section-label">Your Emoticons</div>
						<div class="chat-emoji-grid chat-emoticon-grid">
							<For each={ownEmoticonEntries()}>
								{([name, url]) => (
									<EmoticonButton name={name} url={url} on:click={() => selectEmoji(":" + name + ":")} />
								)}
							</For>
						</div>
					</Show>

					{/* Peer emoticons */}
					<Show when={peerEmoticonEntries().length > 0}>
						<div class="chat-emoticon-section-label">Peer Emoticons</div>
						<div class="chat-emoji-grid chat-emoticon-grid">
							<For each={peerEmoticonEntries()}>
								{(entry) => (
									<EmoticonButton
										name={entry.name}
										url={entry.url}
										on:click={() => selectEmoji(":" + entry.name + ":")}
										onAdopt={() => adoptEmoticon(entry.name, entry.url)}
									/>
								)}
							</For>
						</div>
					</Show>

					{/* Standard emoji grid */}
					<div class="chat-emoji-grid">
						<For each={emojis()}>
							{(emoji) => (
								<button on:click={() => selectEmoji(emoji)}>
									{typeof emoji === "string" ? emoji : (emoji as any).emoji || emoji}
								</button>
							)}
						</For>
					</div>
				</div>
			</div>
		</div>
	)
}

function EmoticonButton(props: {
	name: string
	url: AutomergeUrl
	onClick: () => void
	onAdopt?: () => void
}) {
	const src = createMemo(() => automergeUrlToServiceWorkerUrl(props.url))

	return (
		<button class="chat-emoticon-btn" on:click={props.onClick} title={":" + props.name + ":"}>
			<Show when={src()}>
				<img src={src()!} alt={props.name} class="chat-emoticon-img" />
			</Show>
			<Show when={props.onAdopt}>
				<span
					class="chat-emoticon-adopt"
					on:click={(e) => {
						e.stopPropagation()
						props.onAdopt!()
					}}
					on:pointerdown={(e) => e.stopPropagation()}
					title={"Adopt :" + props.name + ":"}
				>+</span>
			</Show>
		</button>
	)
}
