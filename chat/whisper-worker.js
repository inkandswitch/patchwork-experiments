/**
 * Whisper transcription Web Worker
 *
 * Loads whisper-small.en with WebGPU via transformers.js and transcribes
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
        "onnx-community/whisper-small.en",
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
      return;
    } catch (err) {
      console.warn(
        "[whisper worker] WebGPU failed, falling back to WASM:",
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
      "onnx-community/whisper-small.en",
      {
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q4",
        },
      },
    );
    self.postMessage({ type: "status", message: "Transcription ready (WASM)" });
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({
      type: "status",
      message: `Failed to load model: ${err.message}`,
    });
  } finally {
    loading = false;
  }
}

// Start loading immediately
loadModel();

self.onmessage = async (e) => {
  const { type, audio, _msgUrl } = e.data;

  if (type === "transcribe") {
    if (!transcriber) {
      return;
    }

    try {
      const result = await transcriber(audio);
      const text = result.text.trim();
      if (text && text !== "" && text !== "[BLANK_AUDIO]") {
        self.postMessage({ type: "result", text, _msgUrl });
      }
    } catch (err) {
      console.error("[whisper worker] transcription error:", err);
    }
  }
};
