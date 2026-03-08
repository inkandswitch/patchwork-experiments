import {createSignal, For, Show} from "solid-js"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {createFileDoc} from "../lib/file-helpers"
import {loadBlobUrl} from "../lib/blob-cache"
import type {AutomergeUrl} from "@automerge/automerge-repo"

export function FontAddDialog(props: {
	onClose: () => void
}) {
	const {handle} = useChat()
	const {myFonts, setMyFonts, chatProfileHandle, myName, myFont} = useIdentity()
	const {broadcastPresence} = usePresence()
	let fileInputRef!: HTMLInputElement

	const [selectedFile, setSelectedFile] = createSignal<File | null>(null)
	const [fontName, setFontName] = createSignal("")
	const [previewLoaded, setPreviewLoaded] = createSignal(false)
	const [saving, setSaving] = createSignal(false)
	const [confirmRemove, setConfirmRemove] = createSignal<string | null>(null)

	const isValid = () => {
		return selectedFile() && /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(fontName())
	}

	const existingFonts = () => Object.entries(myFonts())

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement
		const file = input.files?.[0]
		if (!file) return
		setSelectedFile(file)
		// Auto-fill name from filename
		const name = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]/g, " ")
		setFontName(name)
		setPreviewLoaded(false)

		// Load preview
		loadPreview(file, name)
	}

	async function loadPreview(file: File, name: string) {
		try {
			const ab = await file.arrayBuffer()
			const face = new FontFace("preview-" + name, ab)
			await face.load()
			document.fonts.add(face)
			setPreviewLoaded(true)
		} catch (e) {
			console.warn("[Chat] font preview:", e)
		}
	}

	async function save() {
		const file = selectedFile()
		const name = fontName().trim()
		if (!file || !name) return
		setSaving(true)

		try {
			const ext = file.name.split(".").pop() || "woff2"
			const mimeType = "font/" + ext
			const url = await createFileDoc(file, name + "." + ext, mimeType)

			const fonts = {...myFonts()}
			fonts[name] = url as AutomergeUrl
			setMyFonts(fonts)

			// Update chat profile doc
			const profile = chatProfileHandle()
			if (profile) {
				profile.change((d: any) => {
					if (!d.fonts) d.fonts = {}
					d.fonts[name] = url
				})
			}

			// Add to chat doc
			handle.change((d: any) => {
				if (!d.fonts) d.fonts = {}
				d.fonts[name] = {url, addedBy: myName()}
			})

			// Load font immediately
			try {
				const blobUrl = await loadBlobUrl(url as AutomergeUrl)
				if (blobUrl) {
					const resp = await fetch(blobUrl)
					const ab = await resp.arrayBuffer()
					const face = new FontFace(name, ab)
					await face.load()
					document.fonts.add(face)
				}
			} catch (e) {
				console.warn("[Chat] font load:", e)
			}

			broadcastPresence(false)
		} catch (e) {
			console.error("[Chat] font save:", e)
		}

		setSaving(false)
		props.onClose()
	}

	function removeFont(name: string) {
		if (confirmRemove() !== name) {
			setConfirmRemove(name)
			setTimeout(() => setConfirmRemove(null), 3000)
			return
		}

		const fonts = {...myFonts()}
		delete fonts[name]
		setMyFonts(fonts)

		const profile = chatProfileHandle()
		if (profile) {
			profile.change((d: any) => {
				if (d.fonts) delete d.fonts[name]
			})
		}

		handle.change((d: any) => {
			if (d.fonts?.[name]?.addedBy === myName()) {
				delete d.fonts[name]
			}
		})

		broadcastPresence(false)
		setConfirmRemove(null)
	}

	return (
		<div class="chat-font-dialog" onClick={(e) => e.stopPropagation()}>
			<div class="chat-font-dialog-header">
				<span>Manage Fonts</span>
				<button class="chat-font-dialog-close" onClick={props.onClose}>&times;</button>
			</div>

			<div class="chat-font-dialog-body">
				{/* Existing fonts list */}
				<Show when={existingFonts().length > 0}>
					<div class="chat-font-dialog-list">
						<For each={existingFonts()}>
							{([name]) => (
								<div class="chat-font-dialog-item">
									<span style={`font-family:'${name}',sans-serif`}>{name}</span>
									<button
										class="chat-font-dialog-remove"
										onClick={() => removeFont(name)}
										title="Remove font"
									>
										{confirmRemove() === name ? "?" : "\u00d7"}
									</button>
								</div>
							)}
						</For>
					</div>
				</Show>

				{/* File upload */}
				<input
					ref={fileInputRef}
					type="file"
					accept=".woff2,.woff,.ttf,.otf,font/*"
					style="display:none"
					onChange={handleFileSelect}
				/>
				<button
					class="chat-font-dialog-choose"
					onClick={() => fileInputRef.click()}
				>
					{selectedFile() ? selectedFile()!.name : "Choose .woff2 file..."}
				</button>

				<Show when={selectedFile()}>
					<input
						class="chat-font-dialog-name"
						placeholder="Font name"
						value={fontName()}
						onInput={(e) => setFontName(e.currentTarget.value)}
						pattern="[a-zA-Z0-9][a-zA-Z0-9 _-]*"
					/>

					<Show when={previewLoaded()}>
						<div
							class="chat-font-dialog-preview"
							style={`font-family:'preview-${fontName()}',sans-serif`}
						>
							The quick brown fox jumps over the lazy dog
						</div>
					</Show>
				</Show>
			</div>

			<div class="chat-font-dialog-footer">
				<button onClick={props.onClose}>Cancel</button>
				<button
					class="chat-font-dialog-save"
					disabled={!isValid() || saving()}
					onClick={save}
				>
					{saving() ? "..." : "Add Font"}
				</button>
			</div>
		</div>
	)
}
