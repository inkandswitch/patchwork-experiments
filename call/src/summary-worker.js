/**
 * Summary Web Worker
 *
 * Loads a small text-generation model via transformers.js and summarizes
 * transcript text sent from the main thread.
 *
 * Messages IN:  { type: "summarize", text: string }
 * Messages OUT: { type: "result", summary: string }
 *               { type: "status", message: string }
 *               { type: "ready" }
 */

import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

env.allowLocalModels = false;

let summarizer = null;
let loading = false;

async function loadModel() {
  if (summarizer || loading) return;
  loading = true;

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;

  if (hasWebGPU) {
    self.postMessage({
      type: "status",
      message: "Loading summary model (WebGPU)…",
    });
    try {
      summarizer = await pipeline(
        "summarization",
        "Xenova/distilbart-cnn-6-6",
        { device: "webgpu" }
      );
      self.postMessage({ type: "status", message: "Summary model ready" });
      self.postMessage({ type: "ready" });
      loading = false;
      return;
    } catch (err) {
      self.postMessage({
        type: "status",
        message: "WebGPU unavailable for summary, falling back to WASM…",
      });
    }
  } else {
    self.postMessage({
      type: "status",
      message: "Loading summary model (WASM)…",
    });
  }

  try {
    summarizer = await pipeline(
      "summarization",
      "Xenova/distilbart-cnn-6-6"
    );
    self.postMessage({ type: "status", message: "Summary model ready (WASM)" });
    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({
      type: "status",
      message: `Failed to load summary model: ${err.message}`,
    });
  } finally {
    loading = false;
  }
}

self.onmessage = async (e) => {
  const { type, text } = e.data;

  if (type === "summarize") {
    if (!summarizer) {
      // Lazy load on first request
      await loadModel();
      if (!summarizer) {
        self.postMessage({
          type: "status",
          message: "Summary model failed to load",
        });
        return;
      }
    }

    self.postMessage({ type: "status", message: "Summarizing…" });

    try {
      const result = await summarizer(text, {
        max_new_tokens: 256,
        min_length: 25,
      });

      const summary = result[0]?.summary_text?.trim();
      if (summary) {
        self.postMessage({ type: "result", summary });
      } else {
        self.postMessage({
          type: "status",
          message: "No summary generated",
        });
      }
    } catch (err) {
      console.error("[summary worker] error:", err);
      self.postMessage({
        type: "status",
        message: `Summary error: ${err.message}`,
      });
    }
  }
};
