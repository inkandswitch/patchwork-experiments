import {createSignal, For, Show} from "solid-js"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {createFileDoc} from "../lib/file-helpers"
import type {AutomergeUrl} from "@automerge/automerge-repo"

interface EmoticonEntry {
	file: File
	name: string
	previewUrl?: string
}

function nameFromFilename(filename: string): string {
	return filename
		.replace(/\.[^.]+$/, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.toLowerCase()
		.replace(/^_+|_+$/g, "")
}

async function resizeImage(
	file: File,
	size: number
): Promise<Blob> {
	// Check if it's a GIF — if so we just pass through
	// (proper GIF re-encoding would need gifuct-js which is a CDN dep)
	if (file.type === "image/gif") {
		return file
	}

	const bitmap = await createImageBitmap(file)
	const canvas = document.createElement("canvas")
	canvas.width = size
	canvas.height = size
	const ctx = canvas.getContext("2d")!
	// Draw centered/cropped
	const sw = bitmap.width
	const sh = bitmap.height
	const s = Math.min(sw, sh)
	const sx = (sw - s) / 2
	const sy = (sh - s) / 2
	ctx.drawImage(bitmap, sx, sy, s, s, 0, 0, size, size)
	bitmap.close()

	return new Promise(resolve => {
		canvas.toBlob(
			blob => resolve(blob || new Blob()),
			"image/webp",
			0.85
		)
	})
}

export function EmoticonAddDialog(props: {
	onClose: () => void
}) {
	const {handle} = useChat()
	const {myEmoticons, setMyEmoticons, chatProfileHandle, myName} = useIdentity()
	const {broadcastPresence} = usePresence()
	let fileInputRef!: HTMLInputElement

	const [entries, setEntries] = createSignal<EmoticonEntry[]>([])
	const [currentIdx, setCurrentIdx] = createSignal(0)
	const [saving, setSaving] = createSignal(false)

	const current = () => entries()[currentIdx()] || null
	const isValid = () => {
		const e = entries()
		return e.length > 0 && e.every(entry => /^[a-zA-Z0-9_-]+$/.test(entry.name))
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement
		const files = input.files
		if (!files || files.length === 0) return

		const newEntries: EmoticonEntry[] = []
		for (const file of files) {
			const entry: EmoticonEntry = {
				file,
				name: nameFromFilename(file.name),
			}
			// Create preview URL
			entry.previewUrl = URL.createObjectURL(file)
			newEntries.push(entry)
		}
		setEntries(newEntries)
		setCurrentIdx(0)
	}

	function updateName(name: string) {
		setEntries(prev => {
			const copy = [...prev]
			const idx = currentIdx()
			if (copy[idx]) copy[idx] = {...copy[idx], name}
			return copy
		})
	}

	async function save() {
		if (!isValid()) return
		setSaving(true)

		try {
			const profile = chatProfileHandle()
			const em = {...myEmoticons()}

			for (const entry of entries()) {
				const resized = await resizeImage(entry.file, 128)
				const ext = entry.file.type === "image/gif" ? "gif" : "webp"
				const mimeType = entry.file.type === "image/gif" ? "image/gif" : "image/webp"
				const url = await createFileDoc(resized, entry.name + "." + ext, mimeType)

				em[entry.name] = url as AutomergeUrl

				// Update chat profile doc
				if (profile) {
					profile.change((d: any) => {
						if (!d.emoticons) d.emoticons = {}
						d.emoticons[entry.name] = url
					})
				}

				// Add to chat doc
				handle.change((d: any) => {
					if (!d.emoticons) d.emoticons = {}
					d.emoticons[entry.name] = {url, addedBy: myName()}
				})
			}

			setMyEmoticons(em)
			broadcastPresence(false)
		} catch (e) {
			console.error("[Chat] emoticon save:", e)
		}

		setSaving(false)
		props.onClose()
	}

	return (
		<div class="chat-emoticon-dialog" onClick={(e) => e.stopPropagation()}>
			<div class="chat-emoticon-dialog-header">
				<span>Add Emoticon</span>
				<button class="chat-emoticon-dialog-close" onClick={props.onClose}>&times;</button>
			</div>

			<div class="chat-emoticon-dialog-body">
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					multiple
					style="display:none"
					onChange={handleFileSelect}
				/>

				<div
					class="chat-emoticon-dialog-preview"
					onClick={() => fileInputRef.click()}
					title="Click to choose image"
				>
					<Show
						when={current()?.previewUrl}
						fallback={<span style="font-size:40px;color:var(--text-muted)">?</span>}
					>
						<img src={current()!.previewUrl} style="width:128px;height:128px;object-fit:cover;border-radius:6px" />
					</Show>
				</div>

				<Show when={entries().length > 1}>
					<div class="chat-emoticon-dialog-nav">
						<button
							onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
							disabled={currentIdx() === 0}
						>
							&#8249; Prev
						</button>
						<span>{currentIdx() + 1} / {entries().length}</span>
						<button
							onClick={() => setCurrentIdx(i => Math.min(entries().length - 1, i + 1))}
							disabled={currentIdx() >= entries().length - 1}
						>
							Next &#8250;
						</button>
					</div>
				</Show>

				<Show when={current()}>
					<input
						class="chat-emoticon-dialog-name"
						placeholder="emoticon_name"
						value={current()!.name}
						onInput={(e) => updateName(e.currentTarget.value)}
						pattern="[a-zA-Z0-9_-]+"
					/>
				</Show>
			</div>

			<div class="chat-emoticon-dialog-footer">
				<button onClick={props.onClose}>Cancel</button>
				<button
					class="chat-emoticon-dialog-save"
					disabled={!isValid() || saving()}
					onClick={save}
				>
					{saving() ? "..." : entries().length > 1 ? `Add ${entries().length}` : "Add"}
				</button>
			</div>
		</div>
	)
}
