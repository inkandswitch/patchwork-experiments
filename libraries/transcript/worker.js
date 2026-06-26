// @ts-nocheck — imports transformers.js from a CDN (no types) and drives it dynamically.
/**
 * Transcription Web Worker — local (in-browser) speech-to-text.
 *
 * Loads an `automatic-speech-recognition` model (Moonshine / Whisper ONNX) with
 * WebGPU via transformers.js and transcribes 16 kHz mono PCM sent from the main
 * thread, falling back to WASM if WebGPU init fails.
 *
 * One transcriber is cached per `model` id; switching models loads the new one.
 *
 * Messages IN:
 *   { type: "preload",    model, dtype? }
 *   { type: "transcribe", id, audio: Float32Array, model, dtype? }
 * Messages OUT:
 *   { type: "ready",  model }
 *   { type: "status", message }
 *   { type: "result", id, text }
 *   { type: "error",  id?, message }
 */

let pipeline, env

/** @type {Map<string, Promise<any>>} model id → loading/loaded transcriber */
const transcribers = new Map()

async function loadTransformers() {
	if (pipeline) return
	const mod = await import(
		/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
	)
	pipeline = mod.pipeline
	env = mod.env
	env.allowLocalModels = false
}

/**
 * Resolve the dtype map for a model. An explicit `dtype` string overrides the
 * decoder precision; otherwise we pick per-device (q4 on WebGPU, q8 on WASM).
 * @param {boolean} webgpu
 * @param {string|null|undefined} dtype
 */
function dtypeFor(webgpu, dtype) {
	const decoder = dtype || (webgpu ? "q4" : "q8")
	return {encoder_model: "fp32", decoder_model_merged: decoder}
}

/**
 * Get (or start loading) the transcriber for a model, trying WebGPU then WASM.
 * @param {string} model
 * @param {string|null} [dtype]
 */
function getTranscriber(model, dtype) {
	const existing = transcribers.get(model)
	if (existing) return existing

	const loading = (async () => {
		await loadTransformers()
		const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu

		if (hasWebGPU) {
			self.postMessage({
				type: "status",
				message: "Loading transcription model (WebGPU)…",
			})
			try {
				const t = await pipeline("automatic-speech-recognition", model, {
					device: "webgpu",
					dtype: dtypeFor(true, dtype),
				})
				self.postMessage({type: "status", message: "Transcription ready (WebGPU)"})
				self.postMessage({type: "ready", model})
				return t
			} catch (err) {
				console.warn("[transcript worker] WebGPU failed, falling back to WASM:", err)
				self.postMessage({
					type: "status",
					message: "WebGPU failed, falling back to WASM…",
				})
			}
		} else {
			self.postMessage({
				type: "status",
				message: "Loading transcription model (WASM)…",
			})
		}

		const t = await pipeline("automatic-speech-recognition", model, {
			dtype: dtypeFor(false, dtype),
		})
		self.postMessage({type: "status", message: "Transcription ready (WASM)"})
		self.postMessage({type: "ready", model})
		return t
	})()

	transcribers.set(model, loading)
	// If loading fails, drop the cache entry so a later request can retry.
	loading.catch(() => transcribers.delete(model))
	return loading
}

const JUNK = ["[BLANK_AUDIO]", "[ Silence ]", "(keyboard clacking)"]

self.onmessage = async (e) => {
	const {type, id, audio, model, dtype} = e.data
	const modelId = model || "onnx-community/moonshine-base-ONNX"

	if (type === "preload") {
		getTranscriber(modelId, dtype).catch((err) =>
			self.postMessage({type: "error", message: String(err?.message || err)})
		)
		return
	}

	if (type === "transcribe") {
		try {
			const transcriber = await getTranscriber(modelId, dtype)
			const result = await transcriber(audio)
			const text = (result.text || "").trim()
			// Drop transformers.js' silence/noise placeholders.
			self.postMessage({
				type: "result",
				id,
				text: text && JUNK.some((j) => text.includes(j)) ? "" : text,
			})
		} catch (err) {
			console.error("[transcript worker] transcription error:", err)
			self.postMessage({type: "error", id, message: String(err?.message || err)})
		}
	}
}
