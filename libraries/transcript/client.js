/**
 * Transcription client. Resolves the active config and dispatches to the right
 * provider:
 *   - `local`  → a dedicated Web Worker running transformers.js ASR (WebGPU →
 *                WASM). Needs 16 kHz mono PCM; blobs are decoded for you.
 *   - `openai` → a multipart POST to an OpenAI-compatible
 *                /v1/audio/transcriptions endpoint. Needs the audio file bytes.
 *
 *   import { transcribe } from "@chee/patchwork-transcript"
 *   const text = await transcribe(blob, { onStatus: setStatus })
 *
 * @typedef {import("./config.js").TranscriptConfig} TranscriptConfig
 *
 * @typedef {Object} TranscribeOpts
 * @property {TranscriptConfig} [config]   skip resolution; use this config
 * @property {(message:string)=>void} [onStatus]  model-loading progress (local)
 * @property {AbortSignal} [signal]
 * @property {string} [mimeType]           hint when input is raw bytes (default audio/webm)
 */

import {ensureConfig, callConfig} from "./config.js"

// --- local worker -----------------------------------------------------------

/** @typedef {{post:(m:any, transfer?:Transferable[])=>void}} Connection */
/** @type {Connection|null} */
let connection = null
let nextId = 1
/** @type {Map<number, {resolve:(t:string)=>void, reject:(e:any)=>void}>} */
const pending = new Map()
/** @type {Set<(message:string)=>void>} */
const statusListeners = new Set()

function dispatch(/** @type {any} */ msg) {
	if (msg.type === "status") {
		for (const cb of statusListeners) cb(msg.message)
		return
	}
	if (msg.type === "ready") return
	const h = msg.id != null && pending.get(msg.id)
	if (!h) return
	pending.delete(msg.id)
	if (msg.type === "result") h.resolve(msg.text || "")
	else if (msg.type === "error") h.reject(new Error(msg.message || "transcription failed"))
}

/** @returns {Connection} */
function getConnection() {
	if (connection) return connection
	// A dedicated Worker (one per page), reloaded with the page and isolated from
	// other tabs. NOTE: `new URL("./worker.js", import.meta.url)` MUST stay inline
	// inside the constructor — that's the exact pattern bundlers (vite) statically
	// detect to emit the worker chunk; hoisting it to a variable breaks bundling.
	const w = new Worker(new URL("./worker.js", import.meta.url), {type: "module"})
	w.onmessage = (/** @type {MessageEvent} */ ev) => dispatch(ev.data)
	connection = {
		post: (/** @type {any} */ m, /** @type {Transferable[]=} */ transfer) =>
			w.postMessage(m, transfer || []),
	}
	return connection
}

/** Subscribe to model-loading status messages (local provider). */
export function onStatus(/** @type {(message:string)=>void} */ cb) {
	statusListeners.add(cb)
	return () => statusListeners.delete(cb)
}

/**
 * Start loading the local model ahead of the first transcription.
 * @param {TranscribeOpts} [opts]
 */
export async function preload(opts = {}) {
	const cfg = opts.config ?? (await ensureConfig())
	const call = callConfig(cfg)
	if (call.provider !== "local") return
	getConnection().post({type: "preload", model: call.model, dtype: call.dtype})
}

// --- audio helpers ----------------------------------------------------------

/**
 * Decode compressed audio (a Blob or ArrayBuffer) to a mono Float32Array PCM at
 * `sampleRate` (16 kHz by default — what the ASR models expect).
 * @param {Blob|ArrayBuffer} input
 * @param {{sampleRate?:number}} [opts]
 * @returns {Promise<Float32Array>}
 */
export async function decodeAudio(input, {sampleRate = 16000} = {}) {
	const arrayBuf = input instanceof Blob ? await input.arrayBuffer() : input
	const Ctx =
		(typeof OfflineAudioContext !== "undefined" && OfflineAudioContext) ||
		/** @type {any} */ (globalThis).webkitOfflineAudioContext
	// AudioContext resamples on decode; we read channel 0 (mono).
	const audioCtx = new AudioContext({sampleRate})
	try {
		const audioBuf = await audioCtx.decodeAudioData(arrayBuf.slice(0))
		return audioBuf.getChannelData(0)
	} finally {
		audioCtx.close?.()
		void Ctx
	}
}

/** Encode mono Float32 PCM as a 16-bit WAV Blob (for the openai upload path). */
function pcmToWav(/** @type {Float32Array} */ pcm, sampleRate = 16000) {
	const buffer = new ArrayBuffer(44 + pcm.length * 2)
	const view = new DataView(buffer)
	const writeStr = (/** @type {number} */ off, /** @type {string} */ s) => {
		for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
	}
	writeStr(0, "RIFF")
	view.setUint32(4, 36 + pcm.length * 2, true)
	writeStr(8, "WAVE")
	writeStr(12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true) // PCM
	view.setUint16(22, 1, true) // mono
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	writeStr(36, "data")
	view.setUint32(40, pcm.length * 2, true)
	let off = 44
	for (let i = 0; i < pcm.length; i++, off += 2) {
		const s = Math.max(-1, Math.min(1, pcm[i]))
		view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
	}
	return new Blob([buffer], {type: "audio/wav"})
}

// --- main API ----------------------------------------------------------------

/**
 * Transcribe audio to text using the active provider.
 *
 * @param {Blob|ArrayBuffer|Float32Array} input
 *   A Blob/ArrayBuffer of an encoded audio file, or a mono Float32Array of
 *   16 kHz PCM (already-decoded).
 * @param {TranscribeOpts} [opts]
 * @returns {Promise<string>}  the transcript ("" if silence/empty)
 */
export async function transcribe(input, opts = {}) {
	const cfg = opts.config ?? (await ensureConfig())
	const call = callConfig(cfg)
	if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError")

	if (call.provider === "openai") {
		const blob =
			input instanceof Float32Array
				? pcmToWav(input)
				: input instanceof Blob
					? input
					: new Blob([input], {type: opts.mimeType || "audio/webm"})
		return transcribeOpenAI(blob, call, opts.signal)
	}

	// local: ensure 16 kHz mono PCM.
	const pcm =
		input instanceof Float32Array
			? input
			: await decodeAudio(input)

	const conn = getConnection()
	const id = nextId++
	const onStatusCb = opts.onStatus
	if (onStatusCb) statusListeners.add(onStatusCb)

	return new Promise((resolve, reject) => {
		const cleanup = () => {
			pending.delete(id)
			if (onStatusCb) statusListeners.delete(onStatusCb)
			opts.signal?.removeEventListener("abort", onAbort)
		}
		const onAbort = () => {
			cleanup()
			reject(new DOMException("Aborted", "AbortError"))
		}
		opts.signal?.addEventListener("abort", onAbort)
		pending.set(id, {
			resolve: (t) => {
				cleanup()
				resolve(t)
			},
			reject: (e) => {
				cleanup()
				reject(e)
			},
		})
		// Transfer the PCM buffer to the worker (zero-copy).
		conn.post(
			{type: "transcribe", id, audio: pcm, model: call.model, dtype: call.dtype},
			[pcm.buffer]
		)
	})
}

/**
 * @param {Blob} blob
 * @param {import("./config.js").CallConfig} call
 * @param {AbortSignal} [signal]
 */
async function transcribeOpenAI(blob, call, signal) {
	if (!call.apiKey) throw new Error("transcript: OpenAI provider needs an API key")
	const form = new FormData()
	const ext = (blob.type.split("/")[1] || "webm").split(";")[0]
	form.append("file", blob, `audio.${ext}`)
	form.append("model", call.model || "whisper-1")
	const base = (call.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")
	const res = await fetch(`${base}/audio/transcriptions`, {
		method: "POST",
		headers: {Authorization: `Bearer ${call.apiKey}`},
		body: form,
		signal,
	})
	if (!res.ok) {
		throw new Error(`transcript: OpenAI ${res.status} ${await res.text().catch(() => "")}`)
	}
	const data = await res.json()
	return (data.text || "").trim()
}
