import {createSignal, Show, onCleanup} from "solid-js"
import {generateId, formatDuration} from "../lib/helpers"
import {createRecordingDoc} from "../lib/file-helpers"
import {SVG_ICONS} from "../lib/svg-icons"
import type {SlotContextValue} from "../slot-context"
import {setRepo} from "../lib/repo"

// The `voice` feature's `input-actions` slot: the mic button plus the recording-
// mode UI (rendered as an overlay over the input row). Self-contained — owns all
// its media state and sends its own voice message via the SlotContext. `caps` is
// the InputArea capabilities object (unused by voice; it sends independently).
export function VoiceActions(props: {ctx: SlotContextValue; caps?: any}) {
	const {handle, repo} = props.ctx.chat
	setRepo(repo) // seed this bundle's repo singleton (file-helpers uses it)
	const {myName, myFont, myAvatarUrl, myContactUrl} = props.ctx.identity

	const [isRecording, setIsRecording] = createSignal(false)
	const [recElapsed, setRecElapsed] = createSignal(0)
	let recBarsRef!: HTMLDivElement
	let mediaRecorder: MediaRecorder | null = null
	let recStream: MediaStream | null = null
	let recAnalyser: AnalyserNode | null = null
	let recAnimFrame: number | null = null
	let recTimerInterval: number | null = null
	let recordingChunks: Blob[] = []
	let recStartTime = 0
	let recSendOnStop = false

	function cleanupRecording() {
		if (recAnimFrame) cancelAnimationFrame(recAnimFrame)
		if (recTimerInterval) clearInterval(recTimerInterval)
		if (recStream) recStream.getTracks().forEach((t) => t.stop())
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
			if (recStream) recStream.getTracks().forEach((t) => t.stop())
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
		const cu = myContactUrl()
		if (cu) msgData.contactUrl = cu

		repo.create2(msgData).then((msgHandle: any) => {
			handle.change((d: any) => {
				if (!d.messages) d.messages = []
				d.messages.push({ref: true, url: msgHandle.url, timestamp: msgData.timestamp})
			})
		})
	}

	onCleanup(cleanupRecording)

	return (
		<>
			<button
				class="chat-input-btn"
				classList={{recording: isRecording()}}
				title={isRecording() ? "Stop recording" : "Record voice"}
				innerHTML={isRecording() ? SVG_ICONS.micStop : SVG_ICONS.mic}
				on:click={toggleRecording}
			/>
			<Show when={isRecording()}>
				<div class="chat-recording-bar chat-recording-overlay">
					<span class="chat-recording-dot" />
					<span class="chat-recording-time">{formatDuration(recElapsed())}</span>
					<div class="chat-recording-viz" ref={recBarsRef}>
						{Array.from({length: 32}, () => (
							<div class="chat-recording-viz-bar" />
						))}
					</div>
					<button class="chat-recording-cancel" on:click={cancelRecording}>Cancel</button>
					<button class="chat-recording-send" on:click={stopAndSendRecording}>
						<span innerHTML={SVG_ICONS.send} />
					</button>
				</div>
			</Show>
		</>
	)
}
