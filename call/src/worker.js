/**
 * Moonshine + Silero VAD transcription Web Worker
 *
 * Loads Moonshine Base (ASR) via transformers.js pipeline, and
 * Silero VAD v5 via onnxruntime-web directly.
 * Audio chunks flow in continuously; VAD detects speech boundaries;
 * interim transcriptions are sent during speech; final transcription
 * on silence.
 *
 * Messages IN:  { type: "audio", buffer: Float32Array }
 * Messages OUT: { type: "status", message: string }
 *               { type: "ready" }
 *               { type: "recording_start" }
 *               { type: "recording_end" }
 *               { type: "interim", text: string }
 *               { type: "final", text: string }
 */

const SAMPLE_RATE = 16000;
const SPEECH_THRESHOLD = 0.3;
const EXIT_THRESHOLD = 0.1;
const MIN_SILENCE_DURATION_MS = 400;
const MIN_SPEECH_DURATION_MS = 250;
const MAX_BUFFER_DURATION = 30;
const INTERIM_INTERVAL_MS = 1000;

const VAD_MODEL_URL =
  "https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model_q4f16.onnx";

let transcriber = null;
let ort = null;

// VAD expects exactly 512 samples at 16kHz per call
const VAD_CHUNK_SIZE = 512;
let vadAccum = new Float32Array(0); // accumulator for incoming samples

// VAD state
let vadSession = null;
let vadState = null; // Float32Array [2, 1, 128]
let isSpeaking = false;
let speechBuffer = [];
let speechBufferSamples = 0;
let prevChunk = null;
let silenceStart = null;
let speechStart = null;

// Interim timer
let interimTimer = null;
let lastInterimSamples = 0;

// Inference queue to prevent concurrent model calls
let inferenceChain = Promise.resolve();

function queueInference(fn) {
  inferenceChain = inferenceChain.then(fn).catch((err) => {
    console.error("[worker] Inference error:", err);
  });
  return inferenceChain;
}

async function loadModels() {
  // Load onnxruntime-web for VAD
  console.log("[worker] Importing onnxruntime-web...");
  ort = await import(
    "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.all.bundle.min.mjs"
  );
  console.log("[worker] onnxruntime-web loaded");

  // Load transformers.js for Moonshine ASR
  console.log("[worker] Importing transformers.js...");
  const mod = await import(
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
  );
  mod.env.allowLocalModels = false;
  console.log("[worker] transformers.js loaded");

  // Load Silero VAD via raw ONNX Runtime
  self.postMessage({
    type: "status",
    message: "Loading voice detection model…",
  });
  try {
    const response = await fetch(VAD_MODEL_URL);
    const modelBuffer = await response.arrayBuffer();
    vadSession = await ort.InferenceSession.create(modelBuffer);
    // Initialize state tensor: shape [2, 1, 128], all zeros
    vadState = new Float32Array(2 * 1 * 128);
    console.log("[worker] Silero VAD loaded");
  } catch (err) {
    console.error("[worker] Failed to load VAD:", err);
    self.postMessage({
      type: "status",
      message: `Failed to load voice detection: ${err.message}`,
    });
    throw err;
  }

  // Load Moonshine Base
  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;
  const device = hasWebGPU ? "webgpu" : "wasm";
  self.postMessage({
    type: "status",
    message: `Loading transcription model (${device})…`,
  });

  try {
    transcriber = await mod.pipeline(
      "automatic-speech-recognition",
      "onnx-community/moonshine-base-ONNX",
      {
        device,
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: device === "webgpu" ? "q4" : "q8",
        },
      }
    );
    console.log("[worker] Moonshine Base loaded");
  } catch (err) {
    if (hasWebGPU) {
      console.warn("[worker] WebGPU failed, falling back to WASM:", err);
      self.postMessage({
        type: "status",
        message: "WebGPU failed, falling back to WASM…",
      });
      try {
        transcriber = await mod.pipeline(
          "automatic-speech-recognition",
          "onnx-community/moonshine-base-ONNX",
          {
            dtype: {
              encoder_model: "fp32",
              decoder_model_merged: "q8",
            },
          }
        );
        console.log("[worker] Moonshine Base loaded (WASM fallback)");
      } catch (err2) {
        console.error("[worker] WASM fallback also failed:", err2);
        self.postMessage({
          type: "status",
          message: `Failed to load model: ${err2.message}`,
        });
        throw err2;
      }
    } else {
      console.error("[worker] Failed to load model:", err);
      self.postMessage({
        type: "status",
        message: `Failed to load model: ${err.message}`,
      });
      throw err;
    }
  }

  self.postMessage({ type: "status", message: "Ready" });
  self.postMessage({ type: "ready" });
}

async function runVAD(audioData) {
  if (!vadSession || !ort) return null;
  try {
    const inputTensor = new ort.Tensor("float32", audioData, [
      1,
      audioData.length,
    ]);
    const stateTensor = new ort.Tensor("float32", vadState, [2, 1, 128]);
    const srTensor = new ort.Tensor("int64", BigInt64Array.from([16000n]), []);

    const result = await vadSession.run({
      input: inputTensor,
      state: stateTensor,
      sr: srTensor,
    });

    // Update state for next call
    vadState = new Float32Array(result.stateN.data);

    // Speech probability
    return result.output.data[0];
  } catch (err) {
    console.error("[worker] VAD error:", err);
    return null;
  }
}

async function transcribeBuffer() {
  if (!transcriber || speechBufferSamples === 0) return null;

  const audio = new Float32Array(speechBufferSamples);
  let offset = 0;
  for (const chunk of speechBuffer) {
    audio.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    const result = await transcriber(audio);
    const text = result.text.trim();
    const junk = ["[BLANK_AUDIO]", "[ Silence ]", "(keyboard clacking)"];
    if (text && !junk.some((j) => text.includes(j))) {
      return text;
    }
  } catch (err) {
    console.error("[worker] Transcription error:", err);
  }
  return null;
}

function startSpeech() {
  isSpeaking = true;
  speechStart = Date.now();
  speechBuffer = [];
  speechBufferSamples = 0;
  silenceStart = null;
  lastInterimSamples = 0;

  // Add previous chunk as padding for context
  if (prevChunk) {
    speechBuffer.push(prevChunk);
    speechBufferSamples += prevChunk.length;
  }

  self.postMessage({ type: "recording_start" });

  // Start interim transcription timer
  interimTimer = setInterval(() => {
    if (speechBufferSamples > lastInterimSamples) {
      queueInference(async () => {
        const text = await transcribeBuffer();
        if (text) {
          lastInterimSamples = speechBufferSamples;
          self.postMessage({ type: "interim", text });
        }
      });
    }
  }, INTERIM_INTERVAL_MS);
}

function endSpeech() {
  isSpeaking = false;

  if (interimTimer) {
    clearInterval(interimTimer);
    interimTimer = null;
  }

  const speechDuration = Date.now() - (speechStart || Date.now());

  if (speechDuration < MIN_SPEECH_DURATION_MS) {
    console.log("[worker] Discarding short speech:", speechDuration, "ms");
    speechBuffer = [];
    speechBufferSamples = 0;
    self.postMessage({ type: "recording_end" });
    return;
  }

  // Final transcription
  queueInference(async () => {
    const text = await transcribeBuffer();
    if (text) {
      self.postMessage({ type: "final", text });
    }
    speechBuffer = [];
    speechBufferSamples = 0;
    self.postMessage({ type: "recording_end" });
  });
}

async function processVADChunk(chunk) {
  // chunk is exactly VAD_CHUNK_SIZE (512) samples
  if (!vadSession) return;

  const prob = await runVAD(chunk);
  if (prob === null) return;

  if (isSpeaking) {
    speechBuffer.push(chunk);
    speechBufferSamples += chunk.length;

    if (speechBufferSamples / SAMPLE_RATE > MAX_BUFFER_DURATION) {
      console.warn("[worker] Max buffer duration reached, forcing end");
      endSpeech();
      return;
    }

    if (prob < EXIT_THRESHOLD) {
      if (!silenceStart) {
        silenceStart = Date.now();
      } else if (Date.now() - silenceStart >= MIN_SILENCE_DURATION_MS) {
        endSpeech();
      }
    } else {
      silenceStart = null;
    }
  } else {
    if (prob >= SPEECH_THRESHOLD) {
      startSpeech();
      speechBuffer.push(chunk);
      speechBufferSamples += chunk.length;
    }
  }

  prevChunk = chunk;
}

async function processIncomingAudio(samples) {
  // Accumulate incoming resampled audio, then process in VAD_CHUNK_SIZE blocks
  const combined = new Float32Array(vadAccum.length + samples.length);
  combined.set(vadAccum);
  combined.set(samples, vadAccum.length);

  let offset = 0;
  while (offset + VAD_CHUNK_SIZE <= combined.length) {
    const chunk = combined.slice(offset, offset + VAD_CHUNK_SIZE);
    await processVADChunk(chunk);
    offset += VAD_CHUNK_SIZE;
  }

  // Keep leftover for next call
  vadAccum = combined.slice(offset);
}

// Start loading immediately
console.log("[worker] Starting model load");
loadModels();

self.onmessage = (e) => {
  const { type, buffer } = e.data;

  if (type === "audio") {
    queueInference(() => processIncomingAudio(buffer));
  }
};
