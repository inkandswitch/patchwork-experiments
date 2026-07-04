import {createSignal, createEffect, onMount, onCleanup, Show} from "solid-js"
import {createFileDoc} from "../lib/file-helpers"
import {SVG_ICONS} from "../lib/svg-icons"
import {SimpleGIFEncoder} from "../lib/gif-encoder"
import type {SlotContextValue} from "../slot-context"
import {setRepo} from "../lib/repo"

// The `gifSelfie` feature's `input-actions` slot: the camera toggle button. When
// GIF mode is on it shows a live camera preview and, via the InputArea `caps`
// pre-send hook, captures a short GIF and injects `gifSelfieUrl` into the outgoing
// message. Registers a content-check so an otherwise-empty send still fires while
// GIF mode is on.
export function GifActions(props: {ctx: SlotContextValue; caps: any}) {
	const {handle} = props.ctx.chat
	setRepo(props.ctx.chat.repo) // seed this bundle's repo singleton (file-helpers uses it)
	let gifVideoRef!: HTMLVideoElement
	let gifStream: MediaStream | null = null
	const [gifModeEnabled, setGifModeEnabled] = createSignal(false)
	const [gifCapturing, setGifCapturing] = createSignal(false)
	const [gifProgress, setGifProgress] = createSignal(0)

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
			gifStream.getTracks().forEach((t) => t.stop())
			gifStream = null
		}
		if (gifVideoRef) gifVideoRef.srcObject = null
	}

	createEffect(() => {
		if (gifModeEnabled()) startGifCamera()
		else stopGifCamera()
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
			await new Promise((r) => setTimeout(r, frameDelay))
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

	onMount(() => {
		const offPreSend = props.caps?.registerPreSend?.(async (msg: any) => {
			if (gifModeEnabled()) {
				const url = await captureGif()
				if (url) msg.gifSelfieUrl = url
			}
		})
		const offCheck = props.caps?.registerContentCheck?.(() => gifModeEnabled())
		onCleanup(() => {
			offPreSend?.()
			offCheck?.()
		})
	})

	onCleanup(stopGifCamera)

	return (
		<button
			class="chat-gif-toggle"
			classList={{active: gifModeEnabled(), recording: gifCapturing()}}
			title="Toggle GIF selfie mode"
			on:click={() => setGifModeEnabled(!gifModeEnabled())}
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
	)
}
