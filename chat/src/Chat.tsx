import {
	createSignal,
	createEffect,
	onMount,
	onCleanup,
	createMemo,
} from "solid-js"
import {makeDocumentProjection} from "@automerge/automerge-repo-solid-primitives"
import type {DocHandle} from "@automerge/automerge-repo"
import type {
	ChatDoc,
	ChatProfileDoc,
	DraftDoc,
	PresenceInfo,
	PresencePayload,
	EmoticonInfo,
	PendingFile,
	InlineMessage,
} from "./types"
import {ChatContext} from "./context"
import type {ChatContextValue} from "./context"
import {setTheme, getSavedTheme} from "./theme"
import {loadEmojiData} from "./emoji-data"
import {generateId, parsePatchworkLinks, parseSlashCommand} from "./helpers"
import {SimpleGIFEncoder} from "./gif-encoder"
import {PresenceBar} from "./PresenceBar"
import {MessageList} from "./MessageList"
import {InputArea} from "./InputArea"
import {EmojiPicker} from "./EmojiPicker"
import {getCachedBlobUrl, fetchBlobUrl} from "./resources"

const PRESENCE_TIMEOUT = 30000
const TYPING_TIMEOUT = 3000

export function Chat(props: {
	handle: DocHandle<ChatDoc>
	element: HTMLElement
}) {
	const doc = makeDocumentProjection<ChatDoc>(props.handle)

	// --- User identity ---
	const [myName, setMyName] = createSignal("Anonymous")
	const [myFont, setMyFont] = createSignal<string | null>(null)
	const [myAvatarUrl, setMyAvatarUrl] = createSignal<string | null>(null)
	const [myAvatarBlobUrl, setMyAvatarBlobUrl] = createSignal<string | null>(null)
	const [myColor, setMyColor] = createSignal<string | null>(null)
	const [myEmoticons, setMyEmoticons] = createSignal<Record<string, string>>({})
	const [chatProfileHandle, setChatProfileHandle] = createSignal<DocHandle<ChatProfileDoc> | null>(null)
	let contactHandle: DocHandle<any> | null = null

	// --- Presence ---
	const [presenceMap, setPresenceMap] = createSignal<Map<string, PresenceInfo>>(new Map())
	const [isFocused, setIsFocused] = createSignal(document.hasFocus())
	const peerEmoticons = new Map<string, Record<string, string>>()

	function broadcastPresence(typing: boolean) {
		try {
			const payload: PresencePayload = {
				type: "presence",
				name: myName(),
				typing: !!typing,
				avatarUrl: myAvatarUrl() as any,
				color: myColor() || undefined,
				active: isFocused(),
				timestamp: Date.now(),
			}
			const em = myEmoticons()
			if (Object.keys(em).length > 0) payload.emoticons = em as any
			props.handle.broadcast(payload)
		} catch (e) {}
	}

	// --- Typing ---
	const typingUsers = createMemo(() => {
		const now = Date.now()
		const typers: string[] = []
		for (const [name, info] of presenceMap()) {
			if (name === myName()) continue
			if (info.typing && now - info.timestamp < TYPING_TIMEOUT) typers.push(name)
		}
		return typers
	})

	// --- Reply ---
	const [replyToId, setReplyToId] = createSignal<string | null>(null)
	const [replyText, setReplyText] = createSignal("")

	function setReply(msgId: string, previewText?: string) {
		setReplyToId(msgId)
		if (previewText) {
			setReplyText(previewText)
			return
		}
		// Find message text for reply bar from inline messages
		for (const entry of doc.messages || []) {
			if (!("ref" in entry) || !entry.ref) {
				const inline = entry as InlineMessage
				if (inline.id === msgId) {
					setReplyText(inline.name + ": " + (inline.text || "(attachment)"))
					return
				}
			}
		}
		setReplyText("(replying...)")
	}

	// --- Pending files ---
	const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([])

	function addPendingFile(blob: Blob, name: string, mimeType: string) {
		const entry: PendingFile = {blob, name, mimeType}
		if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
			entry.dataUrl = URL.createObjectURL(blob)
		}
		setPendingFiles(prev => [...prev, entry])
	}

	function removePendingFile(idx: number) {
		setPendingFiles(prev => {
			const next = [...prev]
			const removed = next.splice(idx, 1)
			if (removed[0]?.dataUrl) URL.revokeObjectURL(removed[0].dataUrl)
			return next
		})
	}

	function clearPaste() {
		for (const f of pendingFiles()) {
			if (f.dataUrl) URL.revokeObjectURL(f.dataUrl)
		}
		setPendingFiles([])
	}

	// --- Recording ---
	const [isRecording, setIsRecording] = createSignal(false)
	let mediaRecorder: MediaRecorder | null = null
	let recordingChunks: Blob[] = []
	let recordingStartTime = 0
	let recSendOnStop = false

	// --- GIF ---
	const [gifModeEnabled, setGifModeEnabled] = createSignal(false)
	let gifVideoRef: HTMLVideoElement | undefined
	const gifStreamRef = {current: null as MediaStream | null}

	// --- Cat ears ---
	const catEarsSet = new Set<string>()

	// --- Draft ---
	let draftHandle: DocHandle<DraftDoc> | null = null
	let draftSyncTimer: ReturnType<typeof setTimeout> | null = null
	let draftIsLocal = false
	let inputRef: HTMLTextAreaElement | undefined

	function syncDraftToDoc() {
		if (!draftHandle || !inputRef) return
		const text = inputRef.value
		const current = draftHandle.doc()?.text || ""
		if (text === current) return
		draftIsLocal = true
		draftHandle.change((d: DraftDoc) => {
			d.text = text
		})
		setTimeout(() => {
			draftIsLocal = false
		}, 50)
	}

	function scheduleDraftSync() {
		if (draftSyncTimer) clearTimeout(draftSyncTimer)
		draftSyncTimer = setTimeout(syncDraftToDoc, 300)
	}

	function clearDraft() {
		if (draftSyncTimer) {
			clearTimeout(draftSyncTimer)
			draftSyncTimer = null
		}
		if (!draftHandle) return
		draftIsLocal = true
		draftHandle.change((d: DraftDoc) => {
			d.text = ""
		})
		setTimeout(() => {
			draftIsLocal = false
		}, 50)
	}

	// --- Notifications ---
	const [notificationsEnabled, setNotificationsEnabled] = createSignal(
		localStorage.getItem("chat-notifications-enabled") === "true"
	)
	let notificationAudio: HTMLAudioElement | null = null
	let lastKnownMessageCount = 0
	const [hasUnread, setHasUnread] = createSignal(false)

	async function getNotificationSound(): Promise<HTMLAudioElement | null> {
		if (notificationAudio) return notificationAudio
		try {
			const resp = await fetch(new URL("../3beep.mp3", import.meta.url))
			const blob = await resp.blob()
			notificationAudio = new Audio(URL.createObjectURL(blob))
			notificationAudio.volume = 0.5
			return notificationAudio
		} catch (e) {
			return null
		}
	}

	function showOSNotification(authorName: string, text: string, avatarBlobUrl?: string) {
		if (!notificationsEnabled() || typeof Notification === "undefined") return
		if (Notification.permission !== "granted") return
		try {
			const n = new Notification(baseTitle(), {
				body: authorName + ": " + (text || "").slice(0, 200),
				icon: avatarBlobUrl || undefined,
				tag: chatUrl,
			})
			n.onclick = () => {
				window.focus()
				n.close()
			}
		} catch (e) {}
	}

	async function toggleNotifications() {
		if (typeof Notification === "undefined") return
		if (Notification.permission === "denied") return
		if (!notificationsEnabled()) {
			const perm =
				Notification.permission === "granted"
					? "granted"
					: await Notification.requestPermission()
			if (perm === "granted") {
				setNotificationsEnabled(true)
				localStorage.setItem("chat-notifications-enabled", "true")
			}
		} else {
			setNotificationsEnabled(false)
			localStorage.setItem("chat-notifications-enabled", "false")
		}
	}

	// --- Emoticons ---
	function getAllEmoticons(): Record<string, EmoticonInfo> {
		const all: Record<string, EmoticonInfo> = {}
		const em = myEmoticons()
		for (const [name, url] of Object.entries(em)) {
			all[name] = {url: url as any, owner: myName(), mine: true}
		}
		const chatDoc = doc
		if (chatDoc?.emoticons) {
			for (const [name, entry] of Object.entries(chatDoc.emoticons)) {
				if (!all[name] && entry?.url) {
					all[name] = {
						url: entry.url as any,
						owner: entry.addedBy || "unknown",
						mine: entry.addedBy === myName(),
						fromChat: true,
					}
				}
			}
		}
		for (const [peerName, emoticons] of peerEmoticons) {
			for (const [name, url] of Object.entries(emoticons)) {
				if (!all[name]) all[name] = {url: url as any, owner: peerName, mine: false}
			}
		}
		return all
	}

	async function addEmoticon(name: string, file: File): Promise<string> {
		const blob = await resizeImageToEmoticon(file)
		const isGif = blob.type === "image/gif"
		const ext = isGif ? "gif" : "webp"
		const mime = isGif ? "image/gif" : "image/webp"
		const repo = (window as any).repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await blob.arrayBuffer())
		const fh = await repo.create2({
			content: u8,
			extension: ext,
			mimeType: mime,
			name: name + "." + ext,
			"@patchwork": {type: "file"},
		})
		const url = fh.url
		setMyEmoticons(prev => ({...prev, [name]: url}))
		const cph = chatProfileHandle()
		if (cph) {
			cph.change((d: any) => {
				if (!d.emoticons) d.emoticons = {}
				d.emoticons[name] = url
			})
		}
		props.handle.change((d) => {
			if (!d.emoticons) d.emoticons = {} as any
			;(d.emoticons as any)[name] = {url, addedBy: myName()}
		})
		broadcastPresence(false)
		return url
	}

	function adoptEmoticon(name: string, url: string) {
		if (myEmoticons()[name]) return
		setMyEmoticons(prev => ({...prev, [name]: url}))
		const cph = chatProfileHandle()
		if (cph) {
			cph.change((d: any) => {
				if (!d.emoticons) d.emoticons = {}
				d.emoticons[name] = url
			})
		}
		props.handle.change((d) => {
			if (!d.emoticons) d.emoticons = {} as any
			;(d.emoticons as any)[name] = {url, addedBy: myName()}
		})
		broadcastPresence(false)
	}

	async function resizeStaticImage(file: File | Blob): Promise<Blob> {
		return new Promise((resolve, reject) => {
			const img = new Image()
			img.onload = () => {
				const canvas = document.createElement("canvas")
				canvas.width = 128
				canvas.height = 128
				const ctx = canvas.getContext("2d")!
				const scale = Math.min(128 / img.width, 128 / img.height)
				const w = img.width * scale,
					h = img.height * scale
				ctx.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h)
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
					"image/webp",
					0.85
				)
			}
			img.onerror = reject
			img.src = URL.createObjectURL(file)
		})
	}

	async function resizeAnimatedGif(file: File | Blob): Promise<Blob> {
		const {parseGIF, decompressFrames} = await import("https://esm.sh/gifuct-js@2.1.2" as any)
		const buf = await file.arrayBuffer()
		const gif = parseGIF(buf)
		const frames = decompressFrames(gif, true)
		if (!frames.length) throw new Error("No frames in GIF")
		const srcW = gif.lsd.width,
			srcH = gif.lsd.height
		const size = 128
		const encoder = new SimpleGIFEncoder(size, size, true)
		const srcCanvas = document.createElement("canvas")
		srcCanvas.width = srcW
		srcCanvas.height = srcH
		const srcCtx = srcCanvas.getContext("2d")!
		const dstCanvas = document.createElement("canvas")
		dstCanvas.width = size
		dstCanvas.height = size
		const dstCtx = dstCanvas.getContext("2d")!
		const scale = Math.min(size / srcW, size / srcH)
		const dw = srcW * scale,
			dh = srcH * scale
		const dx = (size - dw) / 2,
			dy = (size - dh) / 2
		for (const frame of frames) {
			const patch = new ImageData(
				new Uint8ClampedArray(frame.patch),
				frame.dims.width,
				frame.dims.height
			)
			srcCtx.putImageData(patch, frame.dims.left, frame.dims.top)
			dstCtx.clearRect(0, 0, size, size)
			dstCtx.drawImage(srcCanvas, dx, dy, dw, dh)
			const resized = dstCtx.getImageData(0, 0, size, size)
			encoder.addFrameData(resized.data, frame.delay || 100)
			if (frame.disposalType === 2) {
				srcCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height)
			}
		}
		const encoded = encoder.encode()!
		return new Blob([encoded as BlobPart], {type: "image/gif"})
	}

	async function resizeImageToEmoticon(file: File | Blob): Promise<Blob> {
		const isGif = file.type === "image/gif"
		if (isGif) {
			try {
				return await resizeAnimatedGif(file)
			} catch (e) {
				console.warn("[Chat] animated gif resize failed, falling back to static:", e)
			}
		}
		return resizeStaticImage(file)
	}

	// --- File/recording creation ---
	async function createFileDoc(blob: Blob, fileName?: string, mimeType?: string): Promise<string> {
		const repo = (window as any).repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await blob.arrayBuffer())
		const ext = fileName ? fileName.split(".").pop()! : (mimeType || "").split("/")[1] || "bin"
		const name = fileName || "file-" + Date.now() + "." + ext
		const fh = await repo.create2({
			content: u8,
			extension: ext,
			mimeType: mimeType || "application/octet-stream",
			name,
			"@patchwork": {type: "file"},
		})
		return fh.url
	}

	async function createRecordingDoc(audioBlob: Blob, duration: number) {
		const repo = (window as any).repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await audioBlob.arrayBuffer())
		const ah = await repo.create2({content: u8})
		const rh = await repo.create2({
			title: "Voice Note",
			audio: ah.url,
			duration,
			"@patchwork": {
				type: "recording",
				suggestedImportUrl: "automerge:2a5Rkw9LkqXfBAQZbcBWjTcf15Mc",
			},
		})
		return {url: rh.url}
	}

	// --- Toggle reaction ---
	function toggleReaction(rawIdx: number, emoji: string, msgHandle?: any) {
		const entry = doc.messages?.[rawIdx]
		if (!entry) return
		if ("ref" in entry && entry.ref && msgHandle) {
			msgHandle.change((d: any) => {
				if (!d.reactions) d.reactions = {}
				if (!d.reactions[emoji]) d.reactions[emoji] = []
				const arr = d.reactions[emoji]
				const i = arr.indexOf(myName())
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete d.reactions[emoji]
				} else arr.push(myName())
			})
		} else {
			props.handle.change((d) => {
				const msg = d.messages[rawIdx] as any
				if (!msg) return
				if (!msg.reactions) msg.reactions = {}
				if (!msg.reactions[emoji]) msg.reactions[emoji] = []
				const arr = msg.reactions[emoji]
				const i = arr.indexOf(myName())
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete msg.reactions[emoji]
				} else arr.push(myName())
			})
		}
	}

	// --- Delete message ---
	function deleteMessage(idx: number) {
		props.handle.change((d) => {
			if (!d.messages || idx < 0 || idx >= d.messages.length) return
			const entry = d.messages[idx] as any
			if (entry.ref && entry.url) {
				// Clean up from store (can't delete from store here, but it's OK)
			}
			d.messages.splice(idx, 1)
		})
	}

	// --- GIF camera ---
	async function startGifCamera() {
		try {
			gifStreamRef.current = await navigator.mediaDevices.getUserMedia({
				video: {width: 80, height: 80, facingMode: "user"},
			})
			if (gifVideoRef) gifVideoRef.srcObject = gifStreamRef.current
		} catch (e) {
			console.warn("[Chat] camera:", e)
			setGifModeEnabled(false)
		}
	}

	function stopGifCamera() {
		if (gifStreamRef.current) {
			gifStreamRef.current.getTracks().forEach((t) => t.stop())
			gifStreamRef.current = null
		}
		if (gifVideoRef) gifVideoRef.srcObject = null
	}

	async function captureGif(): Promise<string | null> {
		if (!gifStreamRef.current || !gifVideoRef?.videoWidth) return null
		const size = 80
		const canvas = document.createElement("canvas")
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext("2d")!
		const encoder = new SimpleGIFEncoder(size, size)
		const frameCount = 10,
			frameDelay = 200
		for (let i = 0; i < frameCount; i++) {
			ctx.drawImage(gifVideoRef, 0, 0, size, size)
			encoder.addFrame(canvas, frameDelay)
			if (i < frameCount - 1) await new Promise((r) => setTimeout(r, frameDelay))
		}
		const data = encoder.encode()
		if (!data) return null
		const blob = new Blob([data as BlobPart], {type: "image/gif"})
		const url = await createFileDoc(blob)
		props.handle.change((d) => {
			if (!d.docs) d.docs = []
			d.docs.push({url: url as any, type: "file", name: "selfie-" + Date.now() + ".gif"})
		})
		return url
	}

	// --- Recording ---
	async function startRec() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({audio: true})
			let mime = "audio/webm;codecs=opus"
			if (!MediaRecorder.isTypeSupported(mime)) {
				mime = "audio/webm"
				if (!MediaRecorder.isTypeSupported(mime)) mime = ""
			}
			recordingChunks = []
			recSendOnStop = false
			mediaRecorder = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined)
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) recordingChunks.push(e.data)
			}
			mediaRecorder.onstop = async () => {
				stream.getTracks().forEach((t) => t.stop())
				const dur = (Date.now() - recordingStartTime) / 1000
				if (!recSendOnStop || dur < 0.5) {
					setIsRecording(false)
					return
				}
				const blob = new Blob(recordingChunks, {
					type: mediaRecorder?.mimeType || "audio/webm",
				})
				try {
					const {url} = await createRecordingDoc(blob, dur)
					props.handle.change((d) => {
						if (!d.docs) d.docs = []
						d.docs.push({url: url as any, type: "recording", name: "voice-" + Date.now()})
					})
					await sendMsg(null, null, null, url, dur)
				} catch (e) {
					console.error("[Chat] voice:", e)
				}
				setIsRecording(false)
			}
			recordingStartTime = Date.now()
			mediaRecorder.start(100)
			setIsRecording(true)
		} catch (e) {
			console.error("[Chat] mic:", e)
		}
	}

	function stopAndSendRec() {
		recSendOnStop = true
		if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop()
	}

	function cancelRec() {
		recSendOnStop = false
		if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop()
	}

	// --- Send ---
	async function sendMsg(
		text: string | null,
		imageUrl: string | null,
		imageName: string | null,
		voiceUrl?: string | null,
		voiceDuration?: number | null,
		gifSelfieUrl?: string | null,
		embeds?: any[] | null,
		action?: boolean,
		overrideFont?: string | null,
		overrideColor?: string | null,
		marquee?: boolean,
		files?: any[] | null
	) {
		const repo = (window as any).repo
		const msgData: any = {
			id: generateId(),
			name: myName(),
			text: text || "",
			timestamp: Date.now(),
		}
		if (overrideFont) msgData.font = overrideFont
		else if (myFont()) msgData.font = myFont()
		if (myAvatarUrl()) msgData.avatarUrl = myAvatarUrl()
		if (replyToId()) msgData.replyTo = replyToId()
		if (imageUrl) {
			msgData.imageUrl = imageUrl
			msgData.imageName = imageName
		}
		if (voiceUrl) {
			msgData.voiceUrl = voiceUrl
			msgData.voiceDuration = voiceDuration
		}
		if (gifSelfieUrl) msgData.gifSelfieUrl = gifSelfieUrl
		if (embeds) msgData.embeds = embeds
		if (action) msgData.action = true
		if (marquee) msgData.marquee = true
		if (overrideColor) msgData.color = overrideColor
		if (files) msgData.files = files

		// Embed emoticon URLs referenced in text
		const allEm = getAllEmoticons()
		const usedEmoticons: Record<string, string> = {}
		const emMatches = (text || "").matchAll(/:([a-zA-Z0-9_-]+):/g)
		for (const m of emMatches) {
			if (allEm[m[1]]) usedEmoticons[m[1]] = allEm[m[1]].url
		}
		if (Object.keys(usedEmoticons).length > 0) msgData.emoticons = usedEmoticons

		const msgHandle = await repo.create2(msgData)
		const msgUrl = msgHandle.url

		// Add to chat doc - the message will be loaded lazily when rendered
		props.handle.change((d) => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: msgUrl, timestamp: msgData.timestamp} as any)
		})

		setReplyToId(null)
	}

	async function sendMessage() {
		if (!inputRef) return
		const text = inputRef.value.trim()

		let imageUrl: string | null = null,
			imageName: string | null = null
		const fileAttachments: any[] = []
		const pf = pendingFiles()
		if (pf.length > 0) {
			for (const f of pf) {
				try {
					const url = await createFileDoc(f.blob, f.name, f.mimeType)
					props.handle.change((d) => {
						if (!d.docs) d.docs = []
						d.docs.push({url: url as any, type: "file", name: f.name})
					})
					if (!imageUrl && f.mimeType.startsWith("image/")) {
						imageUrl = url
						imageName = f.name
					} else {
						fileAttachments.push({url, name: f.name, mimeType: f.mimeType})
					}
				} catch (e) {
					console.error("[Chat] file upload:", e)
				}
			}
			clearPaste()
		}

		const slashCmd = parseSlashCommand(text)
		const sourceText = slashCmd ? slashCmd.text : text
		const patchworkLinks = parsePatchworkLinks(sourceText)
		let cleanText = sourceText
		for (const link of patchworkLinks) {
			cleanText = cleanText.replace(link.originalUrl, "").trim()
		}

		if (!cleanText && !imageUrl && fileAttachments.length === 0 && patchworkLinks.length === 0) return

		let gifUrl: string | null = null
		if (gifModeEnabled()) {
			try {
				gifUrl = await captureGif()
			} catch (e) {}
		}

		await sendMsg(
			cleanText,
			imageUrl,
			imageName,
			null,
			null,
			gifUrl,
			patchworkLinks.length > 0 ? patchworkLinks : null,
			slashCmd?.action || false,
			slashCmd?.overrideFont || null,
			slashCmd?.overrideColor || null,
			slashCmd?.marquee || false,
			fileAttachments.length > 0 ? fileAttachments : null
		)

		inputRef.value = ""
		inputRef.style.height = "auto"
		inputRef.dispatchEvent(new Event("input", {bubbles: true}))
		inputRef.focus()
		clearDraft()
	}

	// --- Emoji picker ---
	const [emojiPickerState, setEmojiPickerState] = createSignal<{
		open: boolean
		msgIndex: number
		anchorRect: DOMRect | null
	}>({open: false, msgIndex: -1, anchorRect: null})

	function openEmojiPicker(msgIndex: number, anchorEl: HTMLElement) {
		setEmojiPickerState({
			open: true,
			msgIndex,
			anchorRect: anchorEl.getBoundingClientRect(),
		})
	}

	function closeEmojiPicker() {
		setEmojiPickerState({open: false, msgIndex: -1, anchorRect: null})
	}

	// --- Favicon / title ---
	let originalFaviconHref: string | null = null
	let faviconWithDot: string | null = null
	const chatUrl = props.handle.url

	const baseTitle = createMemo(() => doc.title || "Chat")

	function setFaviconUnread(unread: boolean) {
		let link =
			document.querySelector('link[rel="icon"]') ||
			document.querySelector('link[rel="shortcut icon"]')
		if (!link) {
			link = document.createElement("link") as HTMLLinkElement
			;(link as HTMLLinkElement).rel = "icon"
			document.head.appendChild(link)
		}
		if (!originalFaviconHref && (link as HTMLLinkElement).href)
			originalFaviconHref = (link as HTMLLinkElement).href

		if (!unread) {
			if (originalFaviconHref) (link as HTMLLinkElement).href = originalFaviconHref
			faviconWithDot = null
			return
		}
		if (faviconWithDot) {
			;(link as HTMLLinkElement).href = faviconWithDot
			return
		}

		const size = 64
		const canvas = document.createElement("canvas")
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext("2d")!

		function drawDot() {
			ctx.beginPath()
			ctx.arc(size - 10, 10, 10, 0, Math.PI * 2)
			ctx.fillStyle = "#ed4245"
			ctx.fill()
			faviconWithDot = canvas.toDataURL("image/png")
			;(link as HTMLLinkElement).href = faviconWithDot!
		}

		if (originalFaviconHref) {
			const img = new Image()
			img.crossOrigin = "anonymous"
			img.onload = () => {
				ctx.drawImage(img, 0, 0, size, size)
				drawDot()
			}
			img.onerror = () => drawDot()
			img.src = originalFaviconHref
		} else {
			drawDot()
		}
	}

	function markReadIfVisible() {
		const cph = chatProfileHandle()
		if (!cph || !isFocused() || document.hidden) return
		if (!messagesAreaRef) return
		const atBottom = messagesAreaRef.scrollHeight - messagesAreaRef.scrollTop - messagesAreaRef.clientHeight < 40
		if (!atBottom) return
		const d = doc
		if (!d?.messages?.length) return
		const lastEntry = d.messages[d.messages.length - 1]
		const lastTimestamp = (lastEntry as any).timestamp || ((lastEntry as any).ref && Date.now())
		if (!lastTimestamp) return
		const profile = cph.doc()
		const current = profile?.readPositions?.[chatUrl]
		if (current && current >= lastTimestamp) return
		cph.change((d: any) => {
			if (!d.readPositions) d.readPositions = {}
			d.readPositions[chatUrl] = lastTimestamp
		})
		if (hasUnread()) {
			setHasUnread(false)
		}
	}

	// Update title reactively
	createEffect(() => {
		const typers = typingUsers()
		const base = baseTitle()
		const unread = hasUnread()
		let title = base
		if (typers.length > 0) {
			title = typers.join(", ") + (typers.length === 1 ? " is" : " are") + " typing\u2026 \u2014 " + base
		}
		if (unread) title = "* " + title
		document.title = title
		setFaviconUnread(unread)
	})

	// --- Root ref ---
	let rootRef: HTMLDivElement | undefined
	let messagesAreaRef: HTMLDivElement | undefined

	// --- Init ---
	onMount(() => {
		loadEmojiData()

		// Apply saved theme
		const saved = getSavedTheme()
		if (saved && rootRef) setTheme(rootRef, saved)

		// Resolve account
		resolveAccount()

		// Presence interval
		const presenceInterval = setInterval(() => {
			broadcastPresence(false)
			const now = Date.now()
			setPresenceMap((prev) => {
				const next = new Map(prev)
				for (const [n, info] of next) {
					if (now - info.timestamp > PRESENCE_TIMEOUT) next.delete(n)
				}
				return next
			})
		}, 10000)

		// Ephemeral messages
		const onEphemeralMessage = (data: any) => {
			const msg = data.message
			if (msg?.type === "presence") {
				setPresenceMap((prev) => {
					const next = new Map(prev)
					next.set(msg.name, {
						timestamp: msg.timestamp,
						typing: msg.typing,
						avatarUrl: msg.avatarUrl,
						color: msg.color,
						active: msg.active,
					})
					return next
				})
				if (msg.emoticons) peerEmoticons.set(msg.name, msg.emoticons)
			}
		}
		props.handle.on("ephemeral-message", onEphemeralMessage)

		// Document changes for notifications
		const onChange = () => {
			const d = props.handle.doc()
			const count = d?.messages?.length || 0
			if (count > lastKnownMessageCount && lastKnownMessageCount > 0) {
				const newEntries = (d?.messages || []).slice(lastKnownMessageCount)
				// For ref messages we assume they're from others (we just posted them ourselves
				// and the sendMsg path already created them, so if we see a new ref entry
				// that we didn't create, it's from someone else). For inline messages, check name.
				const fromOther = newEntries.some((e: any) => {
					if (e.ref && e.url) return true // assume from other (our own are already counted)
					return e.name !== myName()
				})
				if (fromOther) {
					if (!isFocused() || document.hidden) {
						setHasUnread(true)
						getNotificationSound().then((audio) => {
							if (audio) {
								audio.currentTime = 0
								audio.play().catch(() => {})
							}
						})
						// OS notification - for inline messages we have the data,
						// for ref messages we load it asynchronously
						const lastOther = [...newEntries].reverse().find((e: any) => {
							if (e.ref && e.url) return true
							return e.name !== myName()
						}) as any
						if (lastOther) {
							if (lastOther.ref && lastOther.url) {
								// Load the ref message doc for notification
								const repo = (window as any).repo
								if (repo) {
									repo.find(lastOther.url).then((handle: any) => {
										const md = handle.doc()
										if (md && md.name !== myName()) {
											const avUrl = md.avatarUrl
											const avBlob = avUrl ? getCachedBlobUrl(avUrl) : undefined
											showOSNotification(md.name, md.text || "", avBlob)
										}
									}).catch(() => {})
								}
							} else {
								const avUrl = lastOther.avatarUrl
								const avBlob = avUrl ? getCachedBlobUrl(avUrl) : undefined
								showOSNotification(lastOther.name || "Someone", lastOther.text || "", avBlob)
							}
						}
					} else {
						markReadIfVisible()
					}
				}
			}
			lastKnownMessageCount = count
		}
		props.handle.on("change", onChange)

		// Focus/blur handlers
		const onVisible = () => {
			setIsFocused(!document.hidden)
			broadcastPresence(false)
			if (!document.hidden) markReadIfVisible()
		}
		const onFocus = () => {
			setIsFocused(true)
			broadcastPresence(false)
			markReadIfVisible()
		}
		const onBlur = () => {
			setIsFocused(false)
			broadcastPresence(false)
		}
		document.addEventListener("visibilitychange", onVisible)
		window.addEventListener("focus", onFocus)
		window.addEventListener("blur", onBlur)

		// Init message count
		const initDoc = props.handle.doc()
		lastKnownMessageCount = initDoc?.messages?.length || 0

		setTimeout(() => broadcastPresence(false), 500)

		onCleanup(() => {
			props.handle.off("change", onChange)
			props.handle.off("ephemeral-message", onEphemeralMessage)
			if (draftSyncTimer) clearTimeout(draftSyncTimer)
			syncDraftToDoc()
			if (draftHandle) draftHandle.removeAllListeners("change")
			clearInterval(presenceInterval)
			if (mediaRecorder && mediaRecorder.state !== "inactive") {
				recSendOnStop = false
				mediaRecorder.stop()
			}
			stopGifCamera()
			document.removeEventListener("visibilitychange", onVisible)
			window.removeEventListener("focus", onFocus)
			window.removeEventListener("blur", onBlur)
			setFaviconUnread(false)
		})
	})

	async function resolveAccount() {
		try {
			const repo = (window as any).repo
			if (!repo) return
			const adh = (window as any).accountDocHandle
			if (!adh) return
			const ad = adh.doc()
			if (!ad?.contactUrl) return
			contactHandle = await repo.find(ad.contactUrl)
			const cd = contactHandle!.doc() as any
			if (!cd) return
			if (cd.name) setMyName(cd.name)

			if (cd.chatProfileUrl) {
				setChatProfileHandle(await repo.find(cd.chatProfileUrl))
			} else {
				const initialProfile: any = {readPositions: {}}
				if (cd.chat?.font) initialProfile.font = cd.chat.font
				const cph = await repo.create2(initialProfile)
				setChatProfileHandle(cph)
				contactHandle!.change((d: any) => {
					d.chatProfileUrl = cph.url
					delete d.chat
				})
			}

			const cph = chatProfileHandle()
			const profile = cph?.doc() as any
			if (profile?.font) setMyFont(profile.font)
			if (profile?.emoticons) setMyEmoticons({...profile.emoticons})

			if (cd.avatarUrl) {
				setMyAvatarUrl(cd.avatarUrl)
				const blobUrl = await fetchBlobUrl(cd.avatarUrl)
				if (blobUrl) setMyAvatarBlobUrl(blobUrl)
			}
			if (cd.color) setMyColor(cd.color)

			broadcastPresence(false)

			// Check initial unread
			const chatDoc = doc
			if (chatDoc?.messages?.length) {
				const lastMsg = chatDoc.messages[chatDoc.messages.length - 1] as any
				const lastRead = cph?.doc()?.readPositions?.[chatUrl] || 0
				if ((lastMsg.timestamp || 0) > lastRead) setHasUnread(true)
			}
			markReadIfVisible()

			// Init draft
			await initDraftDoc()
		} catch (e) {
			console.warn("[Chat] resolve account:", e)
		}
	}

	async function initDraftDoc() {
		const cph = chatProfileHandle()
		if (!cph) return
		const repo = (window as any).repo
		if (!repo) return
		const profile = cph.doc() as any
		const existingUrl = profile?.drafts?.[chatUrl]
		if (existingUrl) {
			try {
				draftHandle = await repo.find(existingUrl)
			} catch (e) {}
		}
		if (!draftHandle) {
			draftHandle = await repo.create2({text: ""})
			cph.change((d: any) => {
				if (!d.drafts) d.drafts = {}
				d.drafts[chatUrl] = draftHandle!.url
			})
		}
		const saved = draftHandle!.doc()?.text
		if (saved && inputRef && !inputRef.value) {
			inputRef.value = saved
			inputRef.style.height = "auto"
			inputRef.style.height = Math.min(inputRef.scrollHeight, 120) + "px"
		}
		draftHandle!.on("change", () => {
			if (draftIsLocal) return
			const remote = draftHandle!.doc()?.text || ""
			if (inputRef && remote !== inputRef.value) {
				const pos = inputRef.selectionStart
				inputRef.value = remote
				inputRef.selectionStart = inputRef.selectionEnd = Math.min(pos, remote.length)
				inputRef.style.height = "auto"
				inputRef.style.height = Math.min(inputRef.scrollHeight, 120) + "px"
			}
		})
	}

	// --- Ensure position context ---
	if (getComputedStyle(props.element).position === "static") {
		props.element.style.position = "relative"
	}

	// --- Context value ---
	const contextValue: ChatContextValue = {
		handle: props.handle,
		repo: (window as any).repo,
		myName,
		myFont,
		myAvatarUrl,
		myAvatarBlobUrl,
		myColor,
		chatUrl,
		getAllEmoticons,
		addEmoticon,
		adoptEmoticon,
		myEmoticons,
		presenceMap,
		isFocused,
		broadcastPresence,
		toggleReaction,
		replyToId,
		setReplyToId,
		setReply,
		pendingFiles,
		setPendingFiles,
		addPendingFile,
		removePendingFile,
		clearPaste,
		scheduleDraftSync,
		clearDraft,
		sendMessage,
		isRecording,
		startRec,
		stopAndSendRec,
		cancelRec,
		gifModeEnabled,
		setGifModeEnabled,
		gifVideoRef,
		gifStreamRef,
		catEarsSet,
		deleteMessage,
		chatProfileHandle,
		rootRef,
		openEmojiPicker,
		notificationsEnabled,
		toggleNotifications,
		createFileDoc,
	}

	// Drag-and-drop state
	const [dragCounter, setDragCounter] = createSignal(0)

	return (
		<ChatContext.Provider value={contextValue}>
			<div
				class="chat-root"
				ref={(el) => {
					rootRef = el
					contextValue.rootRef = el
					const saved = getSavedTheme()
					if (saved) setTheme(el, saved)
				}}
				on:dragenter={(e) => {
					e.preventDefault()
					setDragCounter((c) => c + 1)
				}}
				on:dragleave={(e) => {
					e.preventDefault()
					setDragCounter((c) => {
						const next = c - 1
						return next < 0 ? 0 : next
					})
				}}
				on:dragover={(e) => e.preventDefault()}
				on:drop={(e) => {
					e.preventDefault()
					setDragCounter(0)
					if (e.dataTransfer?.files?.length) {
						for (const file of Array.from(e.dataTransfer.files)) {
							addPendingFile(file, file.name, file.type || "application/octet-stream")
						}
					}
				}}
			>
				<PresenceBar />
				<MessageList
					entries={doc.messages || []}
					ref={(el) => (messagesAreaRef = el)}
					onScroll={() => markReadIfVisible()}
				/>
				<div class="chat-typing-bar">
					{typingUsers().length > 0
						? typingUsers().join(", ") +
							(typingUsers().length === 1 ? " is" : " are") +
							" typing..."
						: ""}
				</div>
				<InputArea
					inputRef={(el) => {
						inputRef = el
						contextValue.gifVideoRef = undefined // will set from InputArea
					}}
					replyText={replyText()}
					startGifCamera={startGifCamera}
					stopGifCamera={stopGifCamera}
				/>
				<div class={"chat-drop-overlay" + (dragCounter() > 0 ? " show" : "")}>
					Drop files here
				</div>
				<EmojiPicker
					state={emojiPickerState()}
					onClose={closeEmojiPicker}
					onSelectEmoji={(emoji) => {
						const st = emojiPickerState()
						if (st.msgIndex >= 0) toggleReaction(st.msgIndex, emoji)
						closeEmojiPicker()
					}}
				/>
			</div>
		</ChatContext.Provider>
	)
}
