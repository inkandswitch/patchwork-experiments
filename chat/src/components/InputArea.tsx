import {createSignal, createEffect, onMount, onCleanup, Show, For, Index} from "solid-js"
import {useChat} from "../context/ChatContext"
import {useIdentity} from "../context/IdentityContext"
import {usePresence} from "../context/PresenceContext"
import {generateId, formatDuration} from "../lib/helpers"
import {createFileDoc, createRecordingDoc} from "../lib/file-helpers"
import {parseSlashCommand} from "../lib/slash-commands"
import {SVG_ICONS} from "../lib/svg-icons"
import {cmPromise} from "../lib/codemirror-setup"
import {SimpleGIFEncoder} from "../lib/gif-encoder"
import {ensureFontLoaded} from "../lib/blob-cache"
import {AutocompletePopup, type AutocompleteItem, type AutocompleteHandle} from "./AutocompletePopup"
import type {ChatMessage} from "../types"

type PendingFile = {blob: Blob; dataUrl?: string; name: string; mimeType: string}
type PendingEmbed = {url: string; toolId?: string; name?: string; type?: string}

export function InputArea(props: {
	replyToId: string | null
	onClearReply: () => void
	onReply: (msgId: string) => void
	onShowFontDialog?: () => void
	onShowEmoticonDialog?: () => void
	onToggleSidebar?: () => void
	onComputerCommand?: (sub: string) => void
	onCallCommand?: () => void
	onModelCommand?: () => void
	onPinCommand?: (arg: string) => void
	pendingFiles: PendingFile[]
	setPendingFiles: (fn: (prev: PendingFile[]) => PendingFile[]) => void
	pendingEmbeds: PendingEmbed[]
	setPendingEmbeds: (fn: (prev: PendingEmbed[]) => PendingEmbed[]) => void
}) {
	let inputWrapRef!: HTMLDivElement
	let inputRowRef!: HTMLDivElement
	let gifVideoRef!: HTMLVideoElement
	let recBarsRef!: HTMLDivElement
	const [cmView, setCmView] = createSignal<any>(null)
	const {handle, doc, repo} = useChat()
	const {myName, myFont, myAvatarUrl, myEmoticons, myFonts, chatProfileHandle} = useIdentity()
	const {broadcastPresence, peerFonts} = usePresence()

	const pendingFiles = () => props.pendingFiles
	const setPendingFiles = (fn: (prev: PendingFile[]) => PendingFile[]) => props.setPendingFiles(fn)
	const pendingEmbeds = () => props.pendingEmbeds
	const setPendingEmbeds = (fn: (prev: PendingEmbed[]) => PendingEmbed[]) => props.setPendingEmbeds(fn)
	const [gifModeEnabled, setGifModeEnabled] = createSignal(false)
	const [gifCapturing, setGifCapturing] = createSignal(false)
	const [gifProgress, setGifProgress] = createSignal(0)
	const [inputText, setInputText] = createSignal("")
	const [cursorPos, setCursorPos] = createSignal(0)

	// Voice recording state
	const [isRecording, setIsRecording] = createSignal(false)
	const [recElapsed, setRecElapsed] = createSignal(0)
	let mediaRecorder: MediaRecorder | null = null
	let recStream: MediaStream | null = null
	let recAnalyser: AnalyserNode | null = null
	let recAnimFrame: number | null = null
	let recTimerInterval: number | null = null
	let recordingChunks: Blob[] = []
	let recStartTime = 0
	let recSendOnStop = false

	// GIF camera state
	let gifStream: MediaStream | null = null

	// Autocomplete handle
	let acHandle: AutocompleteHandle | null = null

	// Draft sync
	let draftHandle: any = null
	let draftSyncTimer: any = null
	let draftIsLocal = false

	function onDraftRemoteChange() {
		if (draftIsLocal) return
		const remote = draftHandle?.doc()?.text || ""
		if (remote !== getInputValue()) {
			setInputValue(remote)
		}
	}

	function getInputValue(): string {
		const cm = cmView()
		return cm ? cm.state.doc.toString() : ""
	}

	function setInputValue(text: string) {
		const cm = cmView()
		if (!cm) return
		cm.dispatch({
			changes: {from: 0, to: cm.state.doc.length, insert: text},
		})
	}

	function focusInput() {
		cmView()?.focus()
	}

	function updateInputState() {
		const cm = cmView()
		if (!cm) return
		setInputText(cm.state.doc.toString())
		setCursorPos(cm.state.selection.main.head)
	}

	// ---- GIF Camera ----
	async function startGifCamera() {
		try {
			gifStream = await navigator.mediaDevices.getUserMedia({
				video: {width: 320, height: 320, facingMode: "user"},
			})
			if (gifVideoRef) {
				gifVideoRef.srcObject = gifStream
				gifVideoRef.play()
			}
		} catch (e) {
			console.warn("[Chat] camera:", e)
			setGifModeEnabled(false)
		}
	}

	function stopGifCamera() {
		if (gifStream) {
			gifStream.getTracks().forEach(t => t.stop())
			gifStream = null
		}
		if (gifVideoRef) gifVideoRef.srcObject = null
	}

	createEffect(() => {
		if (gifModeEnabled()) startGifCamera()
		else stopGifCamera()
	})

	onCleanup(() => {
		stopGifCamera()
		cleanupRecording()
		if (draftHandle) {
			try { draftHandle.off("change", onDraftRemoteChange) } catch {}
		}
		if (draftSyncTimer) { clearTimeout(draftSyncTimer); draftSyncTimer = null }
	})

	async function captureGif(): Promise<string | null> {
		if (!gifStream || !gifVideoRef) return null
		setGifCapturing(true)
		setGifProgress(0)

		const canvas = document.createElement("canvas")
		canvas.width = 160
		canvas.height = 160
		const ctx = canvas.getContext("2d")!
		const encoder = new SimpleGIFEncoder(160, 160)
		const frameCount = 15
		const frameDelay = 133

		for (let i = 0; i < frameCount; i++) {
			const vw = gifVideoRef.videoWidth
			const vh = gifVideoRef.videoHeight
			const size = Math.min(vw, vh)
			const sx = (vw - size) / 2
			const sy = (vh - size) / 2
			ctx.drawImage(gifVideoRef, sx, sy, size, size, 0, 0, 160, 160)
			encoder.addFrame(canvas, frameDelay)
			setGifProgress((i + 1) / frameCount)
			await new Promise(r => setTimeout(r, frameDelay))
		}

		const data = encoder.encode()
		setGifCapturing(false)
		setGifProgress(0)

		if (!data) return null
		const blob = new Blob([data], {type: "image/gif"})
		try {
			const url = await createFileDoc(blob, "selfie-" + Date.now() + ".gif", "image/gif")
			handle.change((d: any) => {
				if (!d.docs) d.docs = []
				d.docs.push({url, type: "file", name: "GIF Selfie"})
			})
			return url
		} catch (e) {
			console.error("[Chat] GIF save:", e)
			return null
		}
	}

	// ---- Voice Recording ----
	function cleanupRecording() {
		if (recAnimFrame) cancelAnimationFrame(recAnimFrame)
		if (recTimerInterval) clearInterval(recTimerInterval)
		if (recStream) recStream.getTracks().forEach(t => t.stop())
		mediaRecorder = null
		recStream = null
		recAnalyser = null
		recAnimFrame = null
		recTimerInterval = null
		recordingChunks = []
	}

	async function startRecording() {
		try {
			recStream = await navigator.mediaDevices.getUserMedia({audio: true})
		} catch (e) {
			console.warn("[Chat] mic access denied:", e)
			return
		}

		let mimeType: string | undefined
		if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
			mimeType = "audio/webm;codecs=opus"
		} else if (MediaRecorder.isTypeSupported("audio/webm")) {
			mimeType = "audio/webm"
		}

		recordingChunks = []
		recSendOnStop = false
		recStartTime = Date.now()

		mediaRecorder = new MediaRecorder(recStream, mimeType ? {mimeType} : undefined)
		mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) recordingChunks.push(e.data)
		}
		mediaRecorder.onstop = async () => {
			const duration = (Date.now() - recStartTime) / 1000
			if (recStream) recStream.getTracks().forEach(t => t.stop())
			recStream = null
			setIsRecording(false)

			if (!recSendOnStop || duration < 0.5) {
				recordingChunks = []
				return
			}

			const blob = new Blob(recordingChunks, {type: mimeType || "audio/webm"})
			recordingChunks = []

			try {
				const {url} = await createRecordingDoc(blob, duration)
				handle.change((d: any) => {
					if (!d.docs) d.docs = []
					d.docs.push({url, type: "recording", name: "Voice Note"})
				})
				sendVoiceMessage(url, duration)
			} catch (e) {
				console.error("[Chat] voice save:", e)
			}
		}

		mediaRecorder.start()
		setIsRecording(true)
		setRecElapsed(0)

		recTimerInterval = window.setInterval(() => {
			setRecElapsed((Date.now() - recStartTime) / 1000)
		}, 500)

		// Audio visualizer
		try {
			const audioCtx = new AudioContext()
			const source = audioCtx.createMediaStreamSource(recStream)
			recAnalyser = audioCtx.createAnalyser()
			recAnalyser.fftSize = 64
			source.connect(recAnalyser)
			animateRecViz()
		} catch (e) {
			console.warn("[Chat] visualizer:", e)
		}
	}

	function animateRecViz() {
		if (!recAnalyser || !recBarsRef) return
		const data = new Uint8Array(recAnalyser.frequencyBinCount)
		recAnalyser.getByteFrequencyData(data)
		const bars = recBarsRef.children
		for (let i = 0; i < Math.min(bars.length, data.length); i++) {
			const h = Math.max(3, (data[i] / 255) * 22)
			;(bars[i] as HTMLElement).style.height = h + "px"
		}
		recAnimFrame = requestAnimationFrame(animateRecViz)
	}

	function cancelRecording() {
		recSendOnStop = false
		if (recAnimFrame) cancelAnimationFrame(recAnimFrame)
		recAnimFrame = null
		if (recTimerInterval) clearInterval(recTimerInterval)
		recTimerInterval = null
		if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop()
	}

	function stopAndSendRecording() {
		recSendOnStop = true
		if (recAnimFrame) cancelAnimationFrame(recAnimFrame)
		recAnimFrame = null
		if (recTimerInterval) clearInterval(recTimerInterval)
		recTimerInterval = null
		if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop()
	}

	function toggleRecording() {
		if (isRecording()) stopAndSendRecording()
		else startRecording()
	}

	function sendVoiceMessage(voiceUrl: string, duration: number) {
		const msgData: any = {
			id: generateId(),
			name: myName(),
			text: "",
			timestamp: Date.now(),
			voiceUrl,
			voiceDuration: duration,
		}
		if (myFont()) msgData.font = myFont()
		const av = myAvatarUrl()
		if (av) msgData.avatarUrl = av

		repo.create2(msgData).then((msgHandle: any) => {
			handle.change((d: any) => {
				if (!d.messages) d.messages = []
				d.messages.push({ref: true, url: msgHandle.url, timestamp: msgData.timestamp})
			})
		})
	}

	// ---- Draft sync ----
	function syncDraftToDoc() {
		if (!draftHandle) return
		const text = getInputValue()
		const current = draftHandle.doc()?.text || ""
		if (text === current) return
		draftIsLocal = true
		draftHandle.change((d: any) => { d.text = text })
		setTimeout(() => { draftIsLocal = false }, 50)
	}

	function scheduleDraftSync() {
		if (draftSyncTimer) clearTimeout(draftSyncTimer)
		draftSyncTimer = setTimeout(syncDraftToDoc, 300)
	}

	function clearDraft() {
		if (draftSyncTimer) { clearTimeout(draftSyncTimer); draftSyncTimer = null }
		if (!draftHandle) return
		draftIsLocal = true
		draftHandle.change((d: any) => { d.text = "" })
		setTimeout(() => { draftIsLocal = false }, 50)
	}

	async function initDraftDoc() {
		const chatProfileH = chatProfileHandle()
		if (!chatProfileH) return
		const chatUrl = handle.url
		const profile = chatProfileH.doc() as any
		const existingUrl = profile?.drafts?.[chatUrl]
		if (existingUrl) {
			try { draftHandle = await repo.find(existingUrl) } catch (e) {
				console.warn("[Chat] draft doc find:", e)
			}
		}
		if (!draftHandle) {
			draftHandle = await repo.create2({text: ""})
			chatProfileH.change((d: any) => {
				if (!d.drafts) d.drafts = {}
				d.drafts[chatUrl] = draftHandle.url
			})
		}
		// Restore draft into editor
		const saved = draftHandle.doc()?.text
		if (saved && !getInputValue()) {
			setInputValue(saved)
		}
		// Listen for remote changes (other device)
		draftHandle.on("change", onDraftRemoteChange)
	}

	// ---- CodeMirror ----
	onMount(async () => {
		try {
			const cm = await cmPromise
			const {EditorView, keymap} = cm
			const placeholderText = "Message " + (doc()?.title || "chat")

			setCmView(new EditorView({
				doc: "",
				extensions: [
					EditorView.theme({
						"&": {background: "transparent"},
						".cm-content": {
							maxHeight: "120px",
							caretColor: "var(--text-primary)",
							color: "var(--text-primary)",
							fontFamily: "inherit",
							fontSize: "15px",
							padding: "8px 12px",
						},
						".cm-scroller": {maxHeight: "120px", overflow: "auto"},
						".cm-line": {padding: "0"},
						"&.cm-focused": {outline: "none"},
						".cm-placeholder": {color: "var(--text-muted)"},
					}),
					EditorView.lineWrapping,
					EditorView.contentAttributes.of({"aria-label": placeholderText}),
					keymap.of([
						{
							key: "Enter",
							run: () => {
								if (acHandle?.handleKey("Enter", false)) return true
								sendMessage()
								return true
							},
						},
						{key: "Tab", run: () => acHandle?.handleKey("Tab", false) || false},
						{key: "Shift-Enter", run: () => false},
						{key: "ArrowDown", run: () => acHandle?.handleKey("ArrowDown", false) || false},
						{key: "ArrowUp", run: () => acHandle?.handleKey("ArrowUp", false) || false},
						{key: "Escape", run: () => acHandle?.handleKey("Escape", false) || false},
					]),
					EditorView.updateListener.of((update) => {
						if (update.docChanged || update.selectionSet) updateInputState()
						if (update.docChanged) {
							broadcastPresence(true)
							scheduleDraftSync()
						}
					}),
				],
				parent: inputWrapRef,
			}))

			// Initialize draft sync after CodeMirror is ready
			initDraftDoc()
		} catch (e) {
			console.error("[Chat] CodeMirror init failed:", e)
		}
	})

	// Keep input font in sync with user's chosen font
	createEffect(() => {
		const font = myFont()
		const cm = cmView()
		if (cm) {
			if (font) {
				ensureFontLoaded(font, myFonts(), peerFonts())
			}
			const contentEl = cm.contentDOM as HTMLElement
			if (contentEl) contentEl.style.fontFamily = font || ""
		}
	})

	// ---- Patchwork URL parsing ----
	const TINY_PW_RE = /https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/g
	function parsePatchworkLinks(text: string): {docUrl: string; title: string; type: string; toolId: string; originalUrl: string}[] {
		const links: {docUrl: string; title: string; type: string; toolId: string; originalUrl: string}[] = []
		let match
		while ((match = TINY_PW_RE.exec(text)) !== null) {
			try {
				const parsed = new URL(match[0])
				if (parsed.hash) {
					const params = new URLSearchParams(parsed.hash.slice(1))
					const docId = params.get("doc")
					if (docId) {
						links.push({
							docUrl: "automerge:" + docId,
							title: params.get("title")
								? decodeURIComponent(params.get("title")!.replace(/\+/g, " "))
								: "",
							type: params.get("type") || "",
							toolId: params.get("tool") || "",
							originalUrl: match[0],
						})
					}
				}
			} catch {}
		}
		TINY_PW_RE.lastIndex = 0
		return links
	}

	// ---- Send ----
	async function sendMessage() {
		const text = getInputValue().trim()
		if (!text && pendingFiles().length === 0 && pendingEmbeds().length === 0 && !gifModeEnabled()) return

		// Slash commands that don't send messages
		const lc = text.toLowerCase()
		if (lc === "/addfont" || lc.startsWith("/addfont ")) {
			setInputValue("")
			props.onShowFontDialog?.()
			return
		}
		if (lc === "/emoticon" || lc.startsWith("/emoticon ")) {
			setInputValue("")
			props.onShowEmoticonDialog?.()
			return
		}
		if (lc === "/computer" || lc.startsWith("/computer ")) {
			setInputValue("")
			const sub = text.slice("/computer".length).trim().toLowerCase()
			props.onComputerCommand?.(sub || "invite")
			return
		}
		if (lc === "/call") {
			setInputValue("")
			props.onCallCommand?.()
			return
		}
		if (lc === "/model" || lc === "/or" || lc === "/openrouter" || lc === "/ollama" ||
			lc.startsWith("/openrouter ") || lc.startsWith("/or ") || lc.startsWith("/provider")) {
			setInputValue("")
			props.onModelCommand?.()
			return
		}
		if (lc.startsWith("/pin ") || lc === "/pin") {
			setInputValue("")
			const arg = text.slice(5).trim()
			props.onPinCommand?.(arg)
			return
		}

		// Upload pending files
		let imageUrl: string | null = null
		let imageName: string | null = null
		const fileAttachments: {url: string; name: string; mimeType: string}[] = []

		for (const pf of pendingFiles()) {
			try {
				const url = await createFileDoc(pf.blob, pf.name, pf.mimeType)
				handle.change((d: any) => {
					if (!d.docs) d.docs = []
					d.docs.push({url, type: "file", name: pf.name})
				})
				if (!imageUrl && pf.mimeType.startsWith("image/")) {
					imageUrl = url
					imageName = pf.name
				} else {
					fileAttachments.push({url, name: pf.name, mimeType: pf.mimeType})
				}
			} catch (e) {
				console.error("[Chat] file upload:", e)
			}
		}
		setPendingFiles(() => [])

		// GIF selfie capture
		let gifSelfieUrl: string | null = null
		if (gifModeEnabled()) {
			gifSelfieUrl = await captureGif()
		}

		const slashCmd = parseSlashCommand(text)
		const sourceText = slashCmd ? slashCmd.text : text

		// Extract patchwork doc links from text and strip them
		const patchworkLinks = parsePatchworkLinks(sourceText)
		let msgText = sourceText
		for (const link of patchworkLinks) {
			msgText = msgText.replace(link.originalUrl, "").trim()
		}

		// Merge patchwork links + pending embeds
		const allEmbeds = [
			...patchworkLinks.map(l => ({url: l.docUrl, toolId: l.toolId, name: l.title, type: l.type})),
			...pendingEmbeds(),
		]

		const msgData: any = {
			id: generateId(),
			name: myName(),
			text: msgText || "",
			timestamp: Date.now(),
		}

		if (slashCmd?.overrideFont) msgData.font = slashCmd.overrideFont
		else if (myFont()) msgData.font = myFont()
		const avatarUrl = myAvatarUrl()
		if (avatarUrl) msgData.avatarUrl = avatarUrl
		if (props.replyToId) msgData.replyTo = props.replyToId
		if (imageUrl) {
			msgData.imageUrl = imageUrl
			msgData.imageName = imageName
		}
		if (gifSelfieUrl) msgData.gifSelfieUrl = gifSelfieUrl
		if (slashCmd?.marquee) msgData.marquee = true
		if (slashCmd?.action) msgData.action = true
		if (slashCmd?.overrideColor) msgData.color = slashCmd.overrideColor
		if (fileAttachments.length > 0) msgData.files = fileAttachments

		// Add embeds (from patchwork links in text + pending embeds from drag/drop)
		if (allEmbeds.length > 0) {
			msgData.embeds = allEmbeds.map(e => ({
				docUrl: e.url,
				toolId: e.toolId,
				title: e.name,
				type: e.type,
			}))
			// Also add to chat docs list
			for (const e of allEmbeds) {
				handle.change((d: any) => {
					if (!d.docs) d.docs = []
					if (!d.docs.find((dl: any) => dl.url === e.url)) {
						d.docs.push({url: e.url, type: e.type || "unknown", name: e.name || "doc"})
					}
				})
			}
			setPendingEmbeds(() => [])
		}

		if (!msgText && !imageUrl && !gifSelfieUrl && fileAttachments.length === 0 && allEmbeds.length === 0) return

		// Embed emoticon URLs referenced in text
		const usedEmoticons: Record<string, string> = {}
		const emMatches = (msgText || "").matchAll(/:([a-zA-Z0-9_-]+):/g)
		const em = myEmoticons()
		for (const m of emMatches) {
			const name = m[1]
			if (em[name]) usedEmoticons[name] = em[name]
		}
		if (Object.keys(usedEmoticons).length > 0) msgData.emoticons = usedEmoticons

		const msgHandle = await repo.create2(msgData)
		handle.change((d: any) => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: msgHandle.url, timestamp: msgData.timestamp})
		})

		setInputValue("")
		clearDraft()
		focusInput()
		props.onClearReply()
	}

	function handleAutocomplete(item: AutocompleteItem, colonStart: number) {
		const cm = cmView()
		if (!cm) return
		if (item.isCommand) {
			cm.dispatch({
				changes: {from: 0, to: cm.state.doc.length, insert: item.display},
				selection: {anchor: item.display.length},
			})
		} else {
			const cursor = cm.state.selection.main.head
			const replacement = item.display + " "
			cm.dispatch({
				changes: {from: colonStart, to: cursor, insert: replacement},
				selection: {anchor: colonStart + replacement.length},
			})
		}
		updateInputState()
	}

	function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items
		if (!items) return
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				e.preventDefault()
				const blob = item.getAsFile()
				if (!blob) continue
				const reader = new FileReader()
				reader.onload = () => {
					setPendingFiles(prev => [
						...prev,
						{
							blob,
							dataUrl: reader.result as string,
							name: "paste-" + Date.now() + "." + (blob.type.split("/")[1] || "png"),
							mimeType: blob.type,
						},
					])
				}
				reader.readAsDataURL(blob)
			}
		}
	}

	return (
		<div class="chat-input-wrapper">
			{/* Reply bar */}
			<Show when={props.replyToId}>
				<div class="chat-reply-bar show">
					<span>Replying to message</span>
					<span class="chat-reply-bar-text" />
					<button
						class="chat-reply-bar-close"
						innerHTML={SVG_ICONS.close}
						onClick={props.onClearReply}
					/>
				</div>
			</Show>

			{/* Paste preview */}
			<Show when={pendingFiles().length > 0}>
				<div class="chat-paste-preview show">
					<For each={pendingFiles()}>
						{(f) =>
							f.dataUrl ? (
								<img src={f.dataUrl} style="max-height:50px;border-radius:4px" />
							) : (
								<div class="chat-paste-file">
									<span class="chat-paste-file-name">{f.name}</span>
								</div>
							)
						}
					</For>
					<button
						class="chat-paste-preview-close"
						innerHTML={SVG_ICONS.close}
						onClick={() => setPendingFiles(() => [])}
					/>
				</div>
			</Show>

			{/* Pending embeds */}
			<Show when={pendingEmbeds().length > 0}>
				<div class="chat-paste-preview show">
					<Index each={pendingEmbeds()}>
						{(e, i) => (
							<div class="chat-paste-embed">
								<span class="chat-paste-embed-name">{e().name || e().url.slice(0, 20) + "..."}</span>
								<button
									class="chat-paste-embed-remove"
									innerHTML={SVG_ICONS.close}
									onClick={() => setPendingEmbeds(prev => prev.filter((_, j) => j !== i))}
								/>
							</div>
						)}
					</Index>
					<button
						class="chat-paste-preview-close"
						innerHTML={SVG_ICONS.close}
						onClick={() => setPendingEmbeds(() => [])}
					/>
				</div>
			</Show>

			{/* Autocomplete popup */}
			<AutocompletePopup
				inputText={inputText()}
				cursorPos={cursorPos()}
				anchorEl={inputWrapRef}
				onComplete={handleAutocomplete}
				onClose={() => {}}
				onHandle={(h) => { acHandle = h }}
			/>

			{/* Recording bar — replaces input row when recording */}
			<Show when={isRecording()}>
				<div class="chat-recording-bar">
					<span class="chat-recording-dot" />
					<span class="chat-recording-time">{formatDuration(recElapsed())}</span>
					<div class="chat-recording-viz" ref={recBarsRef}>
						{Array.from({length: 32}, () => (
							<div class="chat-recording-viz-bar" />
						))}
					</div>
					<button class="chat-recording-cancel" onClick={cancelRecording}>Cancel</button>
					<button class="chat-recording-send" onClick={stopAndSendRecording}>
						<span innerHTML={SVG_ICONS.send} />
					</button>
				</div>
			</Show>

			{/* Input row — hidden when recording */}
			<div
				ref={inputRowRef}
				class="chat-input-row"
				classList={{processing: gifCapturing()}}
				style={{display: isRecording() ? "none" : undefined}}
				onPaste={handlePaste}
			>
				<button
					class="chat-gif-toggle"
					classList={{active: gifModeEnabled(), recording: gifCapturing()}}
					title="Toggle GIF selfie mode"
					onClick={() => setGifModeEnabled(!gifModeEnabled())}
				>
					<span class="chat-gif-icon" innerHTML={SVG_ICONS.camera} />
					<video ref={gifVideoRef} muted playsinline />
					<Show when={gifCapturing()}>
						<svg class="chat-gif-progress" viewBox="0 0 36 36">
							<circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
							<circle
								cx="18" cy="18" r="16" fill="none" stroke="var(--accent)" stroke-width="2"
								stroke-linecap="round"
								stroke-dasharray={`${2 * Math.PI * 16}`}
								stroke-dashoffset={`${2 * Math.PI * 16 * (1 - gifProgress())}`}
								transform="rotate(-90 18 18)"
							/>
						</svg>
					</Show>
				</button>

				<div
				ref={inputWrapRef}
				class="chat-input-wrap"
				onDragOver={(e) => {
					e.preventDefault()
					if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
				}}
				onDrop={(e) => {
					const dt = e.dataTransfer
					if (!dt) return
					const dndData = dt.getData("text/x-patchwork-dnd")
					const urlsData = dt.getData("text/x-patchwork-urls")
					if (!dndData && !urlsData) return
					e.preventDefault()
					e.stopPropagation()
					let items: {url: string; type?: string; name?: string; toolId?: string}[] | null = null
					if (dndData) {
						try {
							const parsed = JSON.parse(dndData)
							if (parsed.items?.length) items = parsed.items
						} catch {}
					}
					if (!items && urlsData) {
						try {
							const urls = JSON.parse(urlsData)
							if (Array.isArray(urls)) items = urls.map((u: string) => ({url: u}))
						} catch {}
					}
					if (items) {
						for (const item of items) {
							if (!item.url) continue
							if (pendingEmbeds().some(pe => pe.url === item.url)) continue
							setPendingEmbeds(prev => [...prev, item])
						}
						focusInput()
					}
				}}
			/>

				<button
					class="chat-input-btn"
					classList={{recording: isRecording()}}
					title={isRecording() ? "Stop recording" : "Record voice"}
					innerHTML={isRecording() ? SVG_ICONS.micStop : SVG_ICONS.mic}
					onClick={toggleRecording}
				/>
				<button
					class="chat-input-btn"
					title="Send"
					innerHTML={SVG_ICONS.send}
					onClick={sendMessage}
				/>
			</div>
		</div>
	)
}
