/**
 * Whisper transcription Web Worker
 *
 * Loads whisper-base.en with WebGPU via transformers.js and transcribes
 * audio chunks sent from the main thread.
 *
 * Messages IN:  { type: "transcribe", audio: Float32Array }
 * Messages OUT: { type: "result", text: string }
 *               { type: "status", message: string }
 *               { type: "ready" }
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

// Disable local model check — always fetch from HF hub
env.allowLocalModels = false;

let transcriber = null;
let loading = false;

async function loadModel() {
  if (transcriber || loading) return;
  loading = true;

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;

  if (hasWebGPU) {
    self.postMessage({ type: "status", message: "Loading transcription model (WebGPU)…" });
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-base.en",
        {
          device: "webgpu",
          dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
          },
        }
      );

      self.postMessage({ type: "status", message: "Model ready (WebGPU)" });
      self.postMessage({ type: "ready" });
      loading = false;
      return;
    } catch (err) {
      console.warn("[whisper worker] WebGPU pipeline failed, falling back to WASM:", err);
      self.postMessage({
        type: "status",
        message: "WebGPU failed, falling back to WASM…",
      });
    }
  } else {
    self.postMessage({ type: "status", message: "Loading transcription model (WASM)…" });
  }

  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-base.en",
      {
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q4",
        },
      }
    );

    self.postMessage({ type: "status", message: "Model ready (WASM)" });
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
  const { type, audio } = e.data;

  if (type === "transcribe") {
    if (!transcriber) {
      // Model still loading, drop this chunk
      return;
    }

    try {
      const result = await transcriber(audio);

      const text = result.text.trim();
      if (text && text !== "" && text !== "[BLANK_AUDIO]") {
        self.postMessage({ type: "result", text });
      }
    } catch (err) {
      console.error("[whisper worker] transcription error:", err);
    }
  }
};
