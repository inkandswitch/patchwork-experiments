// @ts-nocheck — imports transformers.js + onnxruntime-web from CDNs (no types).
/**
 * Streaming transcription Web Worker — Moonshine/Whisper ASR + Silero VAD.
 *
 * Loads an `automatic-speech-recognition` model via transformers.js and Silero
 * VAD v5 via onnxruntime-web. Resampled 16 kHz mono audio chunks flow in
 * continuously; VAD detects speech boundaries; interim transcriptions are sent
 * during speech; a final transcription is sent on silence.
 *
 * Messages IN:
 *   { type: "start", model?, dtype? }   optional; sets the ASR model
 *   { type: "audio", buffer: Float32Array }
 * Messages OUT:
 *   { type: "status", message }
 *   { type: "ready" }
 *   { type: "recording_start" }
 *   { type: "recording_end" }
 *   { type: "interim", text }
 *   { type: "final",   text }
 */

const SAMPLE_RATE = 16000
const SPEECH_THRESHOLD = 0.3
const EXIT_THRESHOLD = 0.1
const MIN_SILENCE_DURATION_MS = 400
const MIN_SPEECH_DURATION_MS = 250
const MAX_BUFFER_DURATION = 30
const INTERIM_INTERVAL_MS = 1000

const VAD_MODEL_URL =
	"https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model_q4f16.onnx"

let MODEL = "onnx-community/moonshine-base-ONNX"
let DTYPE = null

let transcriber = null
let ort = null
let loading = null

// VAD expects exactly 512 samples at 16kHz per call
const VAD_CHUNK_SIZE = 512
let vadAccum = new Float32Array(0)

let vadSession = null
let vadState = null // Float32Array [2, 1, 128]
let isSpeaking = false
let speechBuffer = []
let speechBufferSamples = 0
let prevChunk = null
let silenceStart = null
let speechStart = null

let interimTimer = null
let lastInterimSamples = 0

// Serialize model calls so VAD + ASR don't run concurrently.
let inferenceChain = Promise.resolve()
function queueInference(fn) {
	inferenceChain = inferenceChain.then(fn).catch((err) => {
		console.error("[transcript stream worker] inference error:", err)
	})
	return inferenceChain
}

function dtypeFor(webgpu) {
	const decoder = DTYPE || (webgpu ? "q4" : "q8")
	return {encoder_model: "fp32", decoder_model_merged: decoder}
}

async function loadModels() {
	if (loading) return loading
	loading = (async () => {
		ort = await import(
			/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.bundle.min.mjs"
		)
		const mod = await import(
			/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
		)
		mod.env.allowLocalModels = false

		// Silero VAD via raw ONNX Runtime.
		self.postMessage({type: "status", message: "Loading voice detection model…"})
		try {
			const response = await fetch(VAD_MODEL_URL)
			const modelBuffer = await response.arrayBuffer()
			vadSession = await ort.InferenceSession.create(modelBuffer)
			vadState = new Float32Array(2 * 1 * 128)
		} catch (err) {
			console.error("[transcript stream worker] failed to load VAD:", err)
			self.postMessage({
				type: "status",
				message: `Failed to load voice detection: ${err.message}`,
			})
			throw err
		}

		// ASR model — WebGPU with a WASM fallback.
		const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu
		const device = hasWebGPU ? "webgpu" : "wasm"
		self.postMessage({
			type: "status",
			message: `Loading transcription model (${device})…`,
		})
		try {
			transcriber = await mod.pipeline("automatic-speech-recognition", MODEL, {
				device,
				dtype: dtypeFor(hasWebGPU),
			})
		} catch (err) {
			if (hasWebGPU) {
				console.warn("[transcript stream worker] WebGPU failed, WASM fallback:", err)
				self.postMessage({type: "status", message: "WebGPU failed, falling back to WASM…"})
				transcriber = await mod.pipeline("automatic-speech-recognition", MODEL, {
					dtype: dtypeFor(false),
				})
			} else {
				self.postMessage({type: "status", message: `Failed to load model: ${err.message}`})
				throw err
			}
		}

		self.postMessage({type: "status", message: "Ready"})
		self.postMessage({type: "ready"})
	})()
	return loading
}

async function runVAD(audioData) {
	if (!vadSession || !ort) return null
	try {
		const inputTensor = new ort.Tensor("float32", audioData, [1, audioData.length])
		const stateTensor = new ort.Tensor("float32", vadState, [2, 1, 128])
		const srTensor = new ort.Tensor("int64", BigInt64Array.from([16000n]), [])
		const result = await vadSession.run({input: inputTensor, state: stateTensor, sr: srTensor})
		vadState = new Float32Array(result.stateN.data)
		return result.output.data[0]
	} catch (err) {
		console.error("[transcript stream worker] VAD error:", err)
		return null
	}
}

const JUNK = ["[BLANK_AUDIO]", "[ Silence ]", "(keyboard clacking)"]

async function transcribeBuffer() {
	if (!transcriber || speechBufferSamples === 0) return null
	const audio = new Float32Array(speechBufferSamples)
	let offset = 0
	for (const chunk of speechBuffer) {
		audio.set(chunk, offset)
		offset += chunk.length
	}
	try {
		const result = await transcriber(audio)
		const text = result.text.trim()
		if (text && !JUNK.some((j) => text.includes(j))) return text
	} catch (err) {
		console.error("[transcript stream worker] transcription error:", err)
	}
	return null
}

function startSpeech() {
	isSpeaking = true
	speechStart = Date.now()
	speechBuffer = []
	speechBufferSamples = 0
	silenceStart = null
	lastInterimSamples = 0
	if (prevChunk) {
		speechBuffer.push(prevChunk)
		speechBufferSamples += prevChunk.length
	}
	self.postMessage({type: "recording_start"})
	interimTimer = setInterval(() => {
		if (speechBufferSamples > lastInterimSamples) {
			queueInference(async () => {
				const text = await transcribeBuffer()
				if (text) {
					lastInterimSamples = speechBufferSamples
					self.postMessage({type: "interim", text})
				}
			})
		}
	}, INTERIM_INTERVAL_MS)
}

function endSpeech() {
	isSpeaking = false
	if (interimTimer) {
		clearInterval(interimTimer)
		interimTimer = null
	}
	const speechDuration = Date.now() - (speechStart || Date.now())
	if (speechDuration < MIN_SPEECH_DURATION_MS) {
		speechBuffer = []
		speechBufferSamples = 0
		self.postMessage({type: "recording_end"})
		return
	}
	queueInference(async () => {
		const text = await transcribeBuffer()
		if (text) self.postMessage({type: "final", text})
		speechBuffer = []
		speechBufferSamples = 0
		self.postMessage({type: "recording_end"})
	})
}

async function processVADChunk(chunk) {
	if (!vadSession) return
	const prob = await runVAD(chunk)
	if (prob === null) return

	if (isSpeaking) {
		speechBuffer.push(chunk)
		speechBufferSamples += chunk.length
		if (speechBufferSamples / SAMPLE_RATE > MAX_BUFFER_DURATION) {
			endSpeech()
			return
		}
		if (prob < EXIT_THRESHOLD) {
			if (!silenceStart) silenceStart = Date.now()
			else if (Date.now() - silenceStart >= MIN_SILENCE_DURATION_MS) endSpeech()
		} else {
			silenceStart = null
		}
	} else if (prob >= SPEECH_THRESHOLD) {
		startSpeech()
		speechBuffer.push(chunk)
		speechBufferSamples += chunk.length
	}
	prevChunk = chunk
}

async function processIncomingAudio(samples) {
	const combined = new Float32Array(vadAccum.length + samples.length)
	combined.set(vadAccum)
	combined.set(samples, vadAccum.length)
	let offset = 0
	while (offset + VAD_CHUNK_SIZE <= combined.length) {
		const chunk = combined.slice(offset, offset + VAD_CHUNK_SIZE)
		await processVADChunk(chunk)
		offset += VAD_CHUNK_SIZE
	}
	vadAccum = combined.slice(offset)
}

self.onmessage = (e) => {
	const {type, buffer, model, dtype} = e.data
	if (type === "start") {
		if (model) MODEL = model
		if (dtype !== undefined) DTYPE = dtype
		loadModels()
	} else if (type === "audio") {
		// Audio can arrive before "start"; kick off loading with defaults if so.
		loadModels()
		queueInference(() => processIncomingAudio(buffer))
	}
}
