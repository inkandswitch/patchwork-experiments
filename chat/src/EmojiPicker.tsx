import {Show, For, createSignal, createMemo} from "solid-js"
import {useChatContext} from "./context"
import {useBlobUrl} from "./resources"
import {EMOJI_DATA, EMOJI_LOADED, FALLBACK_EMOJIS} from "./emoji-data"

export function EmojiPicker(props: {
	state: {open: boolean; msgIndex: number; anchorRect: DOMRect | null}
	onClose: () => void
	onSelectEmoji: (emoji: string) => void
}) {
	const ctx = useChatContext()
	const [filter, setFilter] = createSignal("")
	const [showAddDialog, setShowAddDialog] = createSignal(false)

	const allEmoticons = () => ctx.getAllEmoticons()

	const filteredEmoticons = createMemo(() => {
		const all = allEmoticons()
		const names = Object.keys(all)
		const q = filter().toLowerCase()
		return q ? names.filter((n) => n.toLowerCase().includes(q)) : names
	})

	const filteredEmojis = createMemo(() => {
		const q = filter().toLowerCase()
		if (EMOJI_LOADED) {
			return q
				? EMOJI_DATA.filter((e) => e.name.includes(q) || e.emoji === q)
				: EMOJI_DATA
		}
		const fallback = q
			? FALLBACK_EMOJIS.filter((e) => e.includes(filter()))
			: FALLBACK_EMOJIS
		return fallback.map((e) => ({emoji: e, name: "", group: ""}))
	})

	const pickerStyle = () => {
		const rect = props.state.anchorRect
		if (!rect || !ctx.rootRef) return {}
		const rootRect = ctx.rootRef.getBoundingClientRect()
		const pickerWidth = 280
		let left = rect.left + rect.width / 2 - rootRect.left - pickerWidth / 2
		if (left + pickerWidth > rootRect.width - 8) left = rootRect.width - pickerWidth - 8
		if (left < 8) left = 8

		const spaceAbove = rect.top - rootRect.top
		if (spaceAbove >= 320 + 4) {
			return {
				left: left + "px",
				bottom: rootRect.bottom - rect.top + 4 + "px",
				top: "auto",
				right: "auto",
			}
		}
		return {
			left: left + "px",
			top: rect.bottom - rootRect.top + 4 + "px",
			bottom: "auto",
			right: "auto",
		}
	}

	return (
		<div
			class={"chat-emoji-picker-overlay" + (props.state.open ? " show" : "")}
			on:click={(e) => {
				if (e.target === e.currentTarget) props.onClose()
			}}
		>
			<div class="chat-emoji-picker" style={pickerStyle()}>
				<Show when={!showAddDialog()} fallback={
					<EmoticonAddDialog onBack={() => setShowAddDialog(false)} />
				}>
					<input
						class="chat-emoji-picker-search"
						placeholder="Search emoji by name..."
						value={filter()}
						on:input={(e) => setFilter(e.currentTarget.value)}
						ref={(el) => setTimeout(() => el.focus(), 0)}
					/>

					{/* Emoticon section */}
					<Show when={filteredEmoticons().length > 0 || !filter()}>
						<div class="chat-emoticon-section">
							<div class="chat-emoticon-section-header">
								<span>Emoticons</span>
								<button
									class="chat-emoticon-add-btn"
									on:click={(e) => {
										e.stopPropagation()
										setShowAddDialog(true)
									}}
								>
									+ Add
								</button>
							</div>
							<div class="chat-emoticon-grid">
								<For each={filteredEmoticons()}>
									{(name) => {
										const info = () => allEmoticons()[name]
										return (
											<EmoticonButton
												name={name}
												info={info()}
												onSelect={() => {
													props.onSelectEmoji(":" + name + ":")
												}}
											/>
										)
									}}
								</For>
							</div>
						</div>
					</Show>

					{/* Emoji grid */}
					<div class="chat-emoji-grid">
						<For each={filteredEmojis()}>
							{(entry) => (
								<button
									title={entry.name}
									on:click={(e) => {
										e.stopPropagation()
										props.onSelectEmoji(entry.emoji)
									}}
								>
									{entry.emoji}
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>
		</div>
	)
}

function EmoticonButton(props: {
	name: string
	info: {url: string; owner: string; mine: boolean}
	onSelect: () => void
}) {
	const ctx = useChatContext()
	const blobUrl = useBlobUrl(() => props.info.url)

	return (
		<button
			title={
				":" +
				props.name +
				":" +
				(props.info.mine ? "" : " (by " + props.info.owner + ")")
			}
			on:click={(e) => {
				e.stopPropagation()
				props.onSelect()
			}}
		>
			<Show when={blobUrl()}>
				<img src={blobUrl()!} />
			</Show>
			<Show when={!props.info.mine}>
				<button
					class="chat-emoticon-adopt"
					title="Adopt this emoticon"
					on:click={(e) => {
						e.stopPropagation()
						ctx.adoptEmoticon(props.name, props.info.url)
					}}
				>
					+
				</button>
			</Show>
		</button>
	)
}

function EmoticonAddDialog(props: {onBack: () => void}) {
	const ctx = useChatContext()
	const [name, setName] = createSignal("")
	const [previewUrl, setPreviewUrl] = createSignal<string | null>(null)
	const [selectedFile, setSelectedFile] = createSignal<File | null>(null)
	const [saving, setSaving] = createSignal(false)

	const isValid = () => /^[a-zA-Z0-9_-]+$/.test(name()) && selectedFile() !== null

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement
		if (input.files?.[0]) {
			setSelectedFile(input.files[0])
			setPreviewUrl(URL.createObjectURL(input.files[0]))
		}
	}

	async function handleSave() {
		if (!name() || !selectedFile()) return
		setSaving(true)
		try {
			await ctx.addEmoticon(name(), selectedFile()!)
			props.onBack()
		} catch (e) {
			console.error("[Chat] add emoticon:", e)
		}
		setSaving(false)
	}

	return (
		<div class="chat-emoticon-dialog">
			<input
				type="text"
				placeholder="Emoticon name (e.g. catjam)"
				value={name()}
				on:input={(e) => setName(e.currentTarget.value)}
				ref={(el) => setTimeout(() => el.focus(), 0)}
			/>
			<div class="chat-emoticon-dialog-preview">
				<Show when={previewUrl()} fallback={<>?</>}>
					<img src={previewUrl()!} />
				</Show>
			</div>
			<input
				type="file"
				accept="image/*"
				style="font-size:13px;color:var(--text-secondary)"
				on:change={handleFileChange}
			/>
			<div class="chat-emoticon-dialog-btns">
				<button class="cancel-btn" on:click={(e) => {
					e.stopPropagation()
					props.onBack()
				}}>
					Cancel
				</button>
				<button
					class="save-btn"
					disabled={!isValid() || saving()}
					on:click={(e) => {
						e.stopPropagation()
						handleSave()
					}}
				>
					{saving() ? "..." : "Add"}
				</button>
			</div>
		</div>
	)
}
