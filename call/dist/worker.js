// src/worker.js
import {
  pipeline,
  env
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";
env.allowLocalModels = false;
var transcriber = null;
var loading = false;
async function loadModel() {
  if (transcriber || loading) return;
  loading = true;
  self.postMessage({ type: "status", message: "Loading transcription model\u2026" });
  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-base.en",
      {
        device: "webgpu",
        dtype: {
          encoder_model: "fp32",
          decoder_model_merged: "q4"
        }
      }
    );
    self.postMessage({ type: "status", message: "Model ready" });
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({
      type: "status",
      message: "WebGPU unavailable, falling back to WASM\u2026"
    });
    try {
      transcriber = await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-base.en",
        {
          dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q4"
          }
        }
      );
      self.postMessage({ type: "status", message: "Model ready (WASM)" });
      self.postMessage({ type: "ready" });
    } catch (err2) {
      self.postMessage({
        type: "status",
        message: `Failed to load model: ${err2.message}`
      });
    }
  } finally {
    loading = false;
  }
}
loadModel();
self.onmessage = async (e) => {
  const { type, audio } = e.data;
  if (type === "transcribe") {
    if (!transcriber) {
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
//# sourceMappingURL=worker.js.map
