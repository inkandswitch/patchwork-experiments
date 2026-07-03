/**
 * Streaming (real-time) transcription. Feed it a live microphone track and it
 * emits speech-segmented interim + final transcripts as the user talks — the
 * shape `call` uses for its live meeting transcript.
 *
 *   const session = await createTranscriptionStream({
 *     track: localStream.getAudioTracks()[0],
 *     onSpeechStart: () => insertSpeakerPrefix(),
 *     onInterim: (text) => replaceInterim(text),
 *     onFinal:   (text) => commit(text),
 *     onSpeechEnd: () => clearInterim(),
 *     onStatus:  (m) => setStatus(m),
 *   })
 *   session.setEnabled(false)   // mute (drops frames, keeps the model warm)
 *   session.close()             // tear down
 *
 * Audio runs through Silero VAD + the ASR model in a Worker. If you don't pass a
 * `track`/`mediaStream`, drive it yourself with `session.push(float32At16k)`.
 *
 * @typedef {Object} StreamOpts
 * @property {MediaStreamTrack} [track]        an audio track to read from
 * @property {MediaStream} [mediaStream]       or a stream (its first audio track is used)
 * @property {boolean} [enabled]               start enabled (default true)
 * @property {import("./config.js").TranscriptConfig} [config]  skip resolution
 * @property {(message:string)=>void} [onStatus]
 * @property {()=>void} [onReady]
 * @property {()=>void} [onSpeechStart]
 * @property {(text:string)=>void} [onInterim]
 * @property {(text:string)=>void} [onFinal]
 * @property {()=>void} [onSpeechEnd]
 * @property {(err:any)=>void} [onError]
 *
 * @typedef {Object} TranscriptionStream
 * @property {(samples:Float32Array)=>void} push   feed 16 kHz mono PCM directly
 * @property {(on:boolean)=>void} setEnabled       mute/unmute the mic feed
 * @property {()=>void} close
 */

import {ensureConfig, callConfig} from "./config.js"
import {spawnWorker} from "./worker-loader.js"

const TARGET_SAMPLE_RATE = 16000
const WORKER_BUFFER_SIZE = 512 // VAD wants 512-sample chunks at 16 kHz

/**
 * Linear-resample mono Float32 samples from `srcRate` to 16 kHz.
 * @param {Float32Array} raw
 * @param {number} srcRate
 */
function resampleTo16k(raw, srcRate) {
	if (srcRate === TARGET_SAMPLE_RATE) return raw
	const ratio = srcRate / TARGET_SAMPLE_RATE
	const outLen = Math.round(raw.length / ratio)
	const out = new Float32Array(outLen)
	for (let i = 0; i < outLen; i++) {
		const srcIdx = i * ratio
		const lo = Math.floor(srcIdx)
		const hi = Math.min(lo + 1, raw.length - 1)
		const frac = srcIdx - lo
		out[i] = raw[lo] * (1 - frac) + raw[hi] * frac
	}
	return out
}

/**
 * Open a live transcription session.
 * @param {StreamOpts} [opts]
 * @returns {Promise<TranscriptionStream>}
 */
export async function createTranscriptionStream(opts = {}) {
	const cfg = opts.config ?? (await ensureConfig())
	// Streaming runs locally (VAD + ASR in the worker); use the local model.
	const call = callConfig(cfg, {provider: "local"})

	const worker = await spawnWorker(new URL("./stream-worker.js", import.meta.url))
	worker.onmessage = (/** @type {MessageEvent} */ e) => {
		const {type, text, message} = e.data
		switch (type) {
			case "status":
				opts.onStatus?.(message)
				break
			case "ready":
				opts.onReady?.()
				break
			case "recording_start":
				opts.onSpeechStart?.()
				break
			case "interim":
				opts.onInterim?.(text)
				break
			case "final":
				opts.onFinal?.(text)
				break
			case "recording_end":
				opts.onSpeechEnd?.()
				break
		}
	}
	worker.onerror = (/** @type {ErrorEvent} */ err) => opts.onError?.(err)
	worker.postMessage({type: "start", model: call.model, dtype: call.dtype})

	let enabled = opts.enabled !== false
	let closed = false

	/** @param {Float32Array} samples 16 kHz mono PCM */
	const push = (samples) => {
		if (closed || !enabled) return
		let off = 0
		while (off + WORKER_BUFFER_SIZE <= samples.length) {
			const chunk = samples.slice(off, off + WORKER_BUFFER_SIZE)
			worker.postMessage({type: "audio", buffer: chunk}, [chunk.buffer])
			off += WORKER_BUFFER_SIZE
		}
	}

	// Optionally read from a media track ourselves.
	const track =
		opts.track ??
		(opts.mediaStream ? opts.mediaStream.getAudioTracks()[0] : undefined)
	/** @type {ReadableStreamDefaultReader<any>|null} */
	let reader = null
	let leftover = new Float32Array(0)

	if (track) {
		// MediaStreamTrackProcessor reads frames straight off the track — it keeps
		// flowing even when the page loses focus (unlike an AudioContext).
		const Processor = /** @type {any} */ (globalThis).MediaStreamTrackProcessor
		if (!Processor) {
			throw new Error("transcript: MediaStreamTrackProcessor unavailable; use session.push() instead")
		}
		const proc = new Processor({track})
		reader = proc.readable.getReader()
		;(async () => {
			while (!closed) {
				let result
				try {
					result = await /** @type {ReadableStreamDefaultReader<any>} */ (reader).read()
				} catch (err) {
					if (!closed) opts.onError?.(err)
					break
				}
				if (result.done) break
				const frame = result.value
				if (!enabled) {
					frame.close()
					continue
				}
				const raw = new Float32Array(frame.numberOfFrames)
				frame.copyTo(raw, {planeIndex: 0})
				const srcRate = frame.sampleRate
				frame.close()

				const samples = resampleTo16k(raw, srcRate)
				const combined = new Float32Array(leftover.length + samples.length)
				combined.set(leftover)
				combined.set(samples, leftover.length)
				let off = 0
				while (off + WORKER_BUFFER_SIZE <= combined.length) {
					const chunk = combined.slice(off, off + WORKER_BUFFER_SIZE)
					worker.postMessage({type: "audio", buffer: chunk}, [chunk.buffer])
					off += WORKER_BUFFER_SIZE
				}
				leftover = combined.slice(off)
			}
		})()
	}

	return {
		push,
		setEnabled: (on) => {
			enabled = !!on
		},
		close: () => {
			if (closed) return
			closed = true
			try {
				reader?.cancel().catch(() => {})
			} catch {}
			worker.terminate()
		},
	}
}
