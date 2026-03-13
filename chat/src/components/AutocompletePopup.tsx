import {createSignal, createMemo, createEffect, For, Show} from "solid-js"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {EMOJI_ALIASES, EMOJI_DATA, EMOJI_LOADED} from "../lib/emoji-data"
import {SLASH_COMMANDS} from "../lib/slash-commands"
import type {AutomergeUrl} from "@automerge/automerge-repo"

export interface AutocompleteItem {
	display: string // The text to insert (e.g. ":catjam:" or emoji char)
	label: string // Display label
	desc: string // Description/category
	emoji?: string // Emoji character or undefined for emoticon
	url?: AutomergeUrl // For emoticon images
	isCommand?: boolean
	cmd?: string
}

function fuzzyMatch(query: string, target: string): boolean {
	const q = query.replace(/[-_]/g, "").toLowerCase()
	const t = target.replace(/[-_]/g, "").toLowerCase()
	let qi = 0
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) qi++
	}
	return qi === q.length
}

function fuzzyScore(query: string, target: string): number {
	const q = query.toLowerCase()
	const t = target.replace(/[-_]/g, " ").toLowerCase()
	if (t.startsWith(q)) return 0
	if (t.includes(q)) return 1
	return 2
}

function getAllEmoticons(
	myEmoticons: Record<string, AutomergeUrl>,
	peerEmoticons: Record<string, Record<string, AutomergeUrl>>
): {name: string; url: AutomergeUrl}[] {
	const seen = new Set<string>()
	const result: {name: string; url: AutomergeUrl}[] = []
	for (const [name, url] of Object.entries(myEmoticons)) {
		if (!seen.has(name)) {
			seen.add(name)
			result.push({name, url})
		}
	}
	for (const peerMap of Object.values(peerEmoticons)) {
		for (const [name, url] of Object.entries(peerMap)) {
			if (!seen.has(name)) {
				seen.add(name)
				result.push({name, url})
			}
		}
	}
	return result
}

function searchEmoji(
	query: string,
	myEmoticons: Record<string, AutomergeUrl>,
	peerEmoticons: Record<string, Record<string, AutomergeUrl>>
): AutocompleteItem[] {
	const results: AutocompleteItem[] = []
	const seenEmoji = new Set<string>()

	const allEmoticons = getAllEmoticons(myEmoticons, peerEmoticons)
	for (const {name, url} of allEmoticons) {
		if (fuzzyMatch(query, name)) {
			results.push({
				display: `:${name}:`,
				label: `:${name}:`,
				desc: "custom",
				url,
			})
		}
	}

	for (const [alias, emoji] of Object.entries(EMOJI_ALIASES)) {
		if (seenEmoji.has(emoji)) continue
		if (fuzzyMatch(query, alias)) {
			seenEmoji.add(emoji)
			results.push({
				display: emoji,
				label: `:${alias}:`,
				desc: "",
				emoji,
			})
		}
	}

	if (EMOJI_LOADED()) {
		for (const entry of EMOJI_DATA()) {
			if (seenEmoji.has(entry.emoji)) continue
			if (fuzzyMatch(query, entry.name)) {
				seenEmoji.add(entry.emoji)
				results.push({
					display: entry.emoji,
					label: entry.name,
					desc: entry.group,
					emoji: entry.emoji,
				})
			}
			if (results.length >= 12) break
		}
	}

	results.sort((a, b) => fuzzyScore(query, a.label) - fuzzyScore(query, b.label))
	return results.slice(0, 12)
}

export interface AutocompleteHandle {
	handleKey: (key: string, ctrl: boolean) => boolean
}

export function AutocompletePopup(props: {
	inputText: string
	cursorPos: number
	anchorEl: HTMLElement | null
	onComplete: (item: AutocompleteItem, colonStart: number) => void
	onClose: () => void
	onHandle?: (handle: AutocompleteHandle) => void
}) {
	const {myEmoticons} = useIdentity()
	const {peerEmoticons} = usePresence()
	let listRef!: HTMLDivElement
	const [activeIndex, setActiveIndex] = createSignal(0)

	const state = createMemo(() => {
		const text = props.inputText
		const pos = props.cursorPos

		// Slash command autocomplete
		if (text.startsWith("/") && !text.includes(" ")) {
			const query = text.slice(1).toLowerCase()
			const items: AutocompleteItem[] = SLASH_COMMANDS.filter(cmd => {
				const name = cmd.cmd.slice(1)
				return name.startsWith(query) || (cmd.aliases || []).some(a => a.slice(1).startsWith(query))
			}).map(cmd => ({
				display: cmd.cmd + " ",
				label: cmd.usage,
				desc: cmd.desc,
				isCommand: true,
				cmd: cmd.cmd,
			}))
			if (items.length > 0) {
				return {mode: "command" as const, items, colonStart: 0}
			}
		}

		// Emoji/emoticon trigger
		const before = text.slice(0, pos)
		const match = before.match(/(^|[\s:{\[(])(:([a-zA-Z0-9_+-]+))$/)
		if (match && match[3].length >= 1) {
			const query = match[3]
			const colonStart = before.length - match[2].length
			const items = searchEmoji(query, myEmoticons(), Object.fromEntries(peerEmoticons()))
			if (items.length > 0) {
				return {mode: "emoji" as const, items, colonStart}
			}
		}

		return {mode: null as null, items: [] as AutocompleteItem[], colonStart: 0}
	})

	const items = () => state().items
	const mode = () => state().mode
	const colonStart = () => state().colonStart

	// Reset active index when items change
	createEffect(() => {
		items()
		setActiveIndex(0)
	})

	function selectItem(idx: number) {
		const item = items()[idx]
		if (!item) return
		props.onComplete(item, colonStart())
	}

	function scrollToActive() {
		const el = listRef?.children[activeIndex()] as HTMLElement
		if (el) el.scrollIntoView({block: "nearest"})
	}

	function handleKey(key: string, ctrl: boolean): boolean {
		if (!mode()) return false
		const list = items()
		if (!list.length) return false

		if (key === "ArrowDown" || (ctrl && key === "n")) {
			setActiveIndex(i => (i + 1) % list.length)
			scrollToActive()
			return true
		}
		if (key === "ArrowUp" || (ctrl && key === "p")) {
			setActiveIndex(i => (i - 1 + list.length) % list.length)
			scrollToActive()
			return true
		}
		if (key === "Enter" || key === "Tab") {
			selectItem(activeIndex())
			return true
		}
		if (key === "Escape") {
			props.onClose()
			return true
		}
		return false
	}

	// Expose handle to parent (once, since handleKey is stable)
	props.onHandle?.({handleKey})

	function emoticonImgSrc(url: AutomergeUrl): string {
		return "/" + encodeURIComponent(url) + "/"
	}

	return (
		<Show when={mode()}>
			<div class="chat-autocomplete show" ref={listRef}>
				<For each={items()}>
					{(item, idx) => (
						<div
							class="chat-autocomplete-item"
							classList={{active: idx() === activeIndex()}}
							onPointerDown={(e) => {
								e.preventDefault()
								selectItem(idx())
							}}
							onPointerEnter={() => setActiveIndex(idx())}
						>
							{item.isCommand ? (
								<>
									<span class="chat-autocomplete-item-cmd">{item.label}</span>
									<span class="chat-autocomplete-item-desc">{item.desc}</span>
								</>
							) : (
								<>
									<span class="chat-autocomplete-item-emoji">
										{item.url ? (
											<img src={emoticonImgSrc(item.url)} style="width:24px;height:24px" />
										) : (
											item.emoji || item.display
										)}
									</span>
									<span class="chat-autocomplete-item-name">{item.label}</span>
									<span class="chat-autocomplete-item-desc">{item.desc}</span>
								</>
							)}
						</div>
					)}
				</For>
			</div>
		</Show>
	)
}
