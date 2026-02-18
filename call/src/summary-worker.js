/**
 * Summary Web Worker
 *
 * Loads distilbart-cnn-6-6 via transformers.js for in-browser summarization.
 * Produces a summary from call transcript text.
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

const MODEL_ID = "Xenova/distilbart-cnn-6-6";

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
      summarizer = await pipeline("summarization", MODEL_ID, {
        device: "webgpu",
      });
      self.postMessage({ type: "status", message: "Summary model ready" });
      self.postMessage({ type: "ready" });
      loading = false;
      return;
    } catch (err) {
      console.warn("[summary worker] WebGPU failed, falling back to WASM:", err);
      self.postMessage({
        type: "status",
        message: "WebGPU unavailable, falling back to WASM…",
      });
    }
  } else {
    self.postMessage({
      type: "status",
      message: "Loading summary model (WASM)…",
    });
  }

  try {
    summarizer = await pipeline("summarization", MODEL_ID);
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

/**
 * Extract speaker names from transcript lines like "<Alice> ..."
 */
function extractSpeakers(text) {
  const names = new Set();
  for (const match of text.matchAll(/^<([^>]+)>/gm)) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Wrap a plain-text summary into markdown meeting notes format.
 */
function formatAsMeetingNotes(summaryText, speakers) {
  let md = "# Meeting Notes\n\n";
  if (speakers.length > 0) {
    md += `**Participants:** ${speakers.join(", ")}\n\n`;
  }
  md += "## Summary\n\n";
  // Split into sentences and make bullet points
  const sentences = summaryText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const sentence of sentences) {
    md += `- ${sentence}\n`;
  }
  return md;
}

self.onmessage = async (e) => {
  const { type, text } = e.data;

  if (type === "summarize") {
    if (!summarizer) {
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
      const speakers = extractSpeakers(text);

      // Strip speaker tags for cleaner input to the model
      const cleaned = text.replace(/^<[^>]+>\s*/gm, "").trim();

      const result = await summarizer(cleaned, {
        max_new_tokens: 256,
        min_length: 30,
      });

      const rawSummary = result[0]?.summary_text?.trim();
      if (rawSummary) {
        const summary = formatAsMeetingNotes(rawSummary, speakers);
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
