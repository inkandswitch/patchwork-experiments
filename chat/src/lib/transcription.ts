import type {AutomergeUrl} from "@automerge/automerge-repo"
import moonshineWorkerUrl from "../workers/moonshine-worker.js?worker&url"

let worker: Worker | null = null
let ready = false
const pendingTranscriptions = new Set<string>()
const resultCallbacks = new Map<string, (text: string) => void>()

function initWorker() {
	if (worker) return
	try {
		worker = new Worker(moonshineWorkerUrl, {type: "module"})
		worker.onmessage = (e) => {
			const msg = e.data
			if (msg.type === "ready") {
				ready = true
			} else if (msg.type === "result") {
				const url = msg._msgUrl
				pendingTranscriptions.delete(url)
				const cb = resultCallbacks.get(url)
				if (cb) {
					cb(msg.text)
					resultCallbacks.delete(url)
				}
				// Also save to recording doc
				saveTranscription(url as AutomergeUrl, msg.text)
			}
		}
	} catch (e) {
		console.warn("[Chat] moonshine worker init:", e)
	}
}

async function saveTranscription(recordingUrl: AutomergeUrl, text: string) {
	try {
		const repo = (window as any).repo
		if (!repo) return
		const rh = await repo.find(recordingUrl)
		rh.change((d: any) => {
			d.transcription = text
		})
	} catch (e) {
		console.warn("[Chat] save transcription:", e)
	}
}

export async function transcribeVoiceNote(
	voiceUrl: AutomergeUrl,
	onResult?: (text: string) => void
): Promise<void> {
	if (pendingTranscriptions.has(voiceUrl)) return

	// Check if already transcribed
	try {
		const repo = (window as any).repo
		if (!repo) return
		const rh = await repo.find(voiceUrl)
		const rd = rh.doc() as any
		if (rd?.transcription) {
			onResult?.(rd.transcription)
			return
		}

		// Get audio data
		if (!rd?.audio) return
		const ah = await repo.find(rd.audio)
		const ad = ah.doc() as any
		if (!ad?.content) return

		const bytes = ad.content instanceof Uint8Array ? ad.content : new Uint8Array(ad.content)
		const blob = new Blob([bytes], {type: "audio/webm;codecs=opus"})

		pendingTranscriptions.add(voiceUrl)
		if (onResult) resultCallbacks.set(voiceUrl, onResult)

		initWorker()
		if (!worker) return

		// Decode to PCM Float32Array at 16kHz
		const audioCtx = new AudioContext({sampleRate: 16000})
		const arrayBuf = await blob.arrayBuffer()
		const audioBuf = await audioCtx.decodeAudioData(arrayBuf)
		const pcm = audioBuf.getChannelData(0)
		audioCtx.close()

		worker.postMessage(
			{type: "transcribe", audio: pcm, _msgUrl: voiceUrl},
			[pcm.buffer]
		)
	} catch (e) {
		console.warn("[Chat] transcription decode:", e)
		pendingTranscriptions.delete(voiceUrl)
	}
}

export async function getExistingTranscription(voiceUrl: AutomergeUrl): Promise<string | null> {
	try {
		const repo = (window as any).repo
		if (!repo) return null
		const rh = await repo.find(voiceUrl)
		const rd = rh.doc() as any
		return rd?.transcription || null
	} catch {
		return null
	}
}
