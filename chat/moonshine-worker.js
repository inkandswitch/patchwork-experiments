/**
 * Moonshine transcription Web Worker
 *
 * Loads moonshine-base-ONNX with WebGPU via transformers.js and transcribes
 * audio chunks sent from the main thread.
 *
 * Messages IN:  { type: "transcribe", audio: Float32Array, _msgUrl?: string }
 * Messages OUT: { type: "result", text: string, _msgUrl?: string }
 *               { type: "status", message: string }
 *               { type: "ready" }
 */

let pipeline, env;
let transcriber = null;
let loading = false;
const pendingQueue = [];

async function loadTransformers() {
  const mod = await import(
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
  );
  pipeline = mod.pipeline;
  env = mod.env;
  env.allowLocalModels = false;
}

async function loadModel() {
  await loadTransformers();
  if (transcriber || loading) return;
  loading = true;

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;

  if (hasWebGPU) {
    self.postMessage({
      type: "status",
      message: "Loading transcription model (WebGPU)\u2026",
    });
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/moonshine-base-ONNX",
        {
          device: "webgpu",
          dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
          },
        },
      );
      self.postMessage({ type: "status", message: "Transcription ready (WebGPU)" });
      self.postMessage({ type: "ready" });
      loading = false;
      drainQueue();
      return;
    } catch (err) {
      console.warn(
        "[moonshine worker] WebGPU failed, falling back to WASM:",
        err,
      );
      self.postMessage({
        type: "status",
        message: "WebGPU failed, falling back to WASM\u2026",
      });
    }
  } else {
    self.postMessage({
      type: "status",
      message: "Loading transcription model (WASM)\u2026",
    });
  }

  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/moonshine-base-ONNX",
      {
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q8",
        },
      },
    );
    self.postMessage({ type: "status", message: "Transcription ready (WASM)" });
    self.postMessage({ type: "ready" });
    drainQueue();
  } catch (err) {
    self.postMessage({
      type: "status",
      message: `Failed to load model: ${err.message}`,
    });
  } finally {
    loading = false;
  }
}

async function transcribe(audio, _msgUrl) {
  try {
    const result = await transcriber(audio);
    const text = result.text.trim();
    const junk = ["[BLANK_AUDIO]", "[ Silence ]", "(keyboard clacking)"];
    if (text && !junk.some((j) => text.includes(j))) {
      self.postMessage({ type: "result", text, _msgUrl });
    }
  } catch (err) {
    console.error("[moonshine worker] transcription error:", err);
  }
}

async function drainQueue() {
  while (pendingQueue.length > 0) {
    const { audio, _msgUrl } = pendingQueue.shift();
    await transcribe(audio, _msgUrl);
  }
}

// Start loading immediately
loadModel();

self.onmessage = async (e) => {
  const { type, audio, _msgUrl } = e.data;

  if (type === "transcribe") {
    if (!transcriber) {
      console.log("[moonshine worker] Model not ready, queuing transcription for", _msgUrl);
      pendingQueue.push({ audio, _msgUrl });
      return;
    }

    await transcribe(audio, _msgUrl);
  }
};
