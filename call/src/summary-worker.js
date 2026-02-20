/**
 * Summary Web Worker
 *
 * Loads distilbart-cnn-12-6 via transformers.js for in-browser summarization.
 * Chunks long transcripts to stay within model limits, summarizes each chunk,
 * then produces per-speaker summaries and a pithy top-line.
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

const MODEL_ID = "Xenova/distilbart-cnn-12-6-samsum";
const MAX_CHUNK_CHARS = 3000;

let summarizer = null;
let loading = false;

async function loadModel() {
  if (summarizer || loading) return;
  loading = true;

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;

  if (hasWebGPU) {
    self.postMessage({
      type: "status",
      message: "Loading summary model (WebGPU)\u2026",
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
        message: "WebGPU unavailable, falling back to WASM\u2026",
      });
    }
  } else {
    self.postMessage({
      type: "status",
      message: "Loading summary model (WASM)\u2026",
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

function extractSpeakers(text) {
  const names = new Set();
  for (const match of text.matchAll(/^<([^>]+)>/gm)) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Collect all text said by each speaker.
 * Returns Map<name, string>
 */
function textBySpeaker(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^<([^>]+)>\s*(.*)/);
    if (m && m[2].trim()) {
      const prev = map.get(m[1]) || "";
      map.set(m[1], prev + (prev ? " " : "") + m[2].trim());
    }
  }
  return map;
}

function chunkText(text, maxChars) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Summarize a piece of text, chunking if needed. Returns a single string.
 */
async function summarizeText(text, statusPrefix, opts = {}) {
  const maxTokens = opts.max_new_tokens || 150;
  const minLen = opts.min_length || 30;

  const chunks = chunkText(text, MAX_CHUNK_CHARS);
  const summaries = [];

  for (let i = 0; i < chunks.length; i++) {
    if (chunks.length > 1 && statusPrefix) {
      self.postMessage({
        type: "status",
        message: `${statusPrefix} (${i + 1}/${chunks.length})\u2026`,
      });
    }
    const result = await summarizer(chunks[i], {
      max_new_tokens: maxTokens,
      min_length: minLen,
    });
    const t = result[0]?.summary_text?.trim();
    if (t) summaries.push(t);
  }

  if (summaries.length === 0) return "";

  // Condense multiple chunk summaries into one
  if (summaries.length > 1) {
    const combined = summaries.join(" ");
    if (combined.length <= MAX_CHUNK_CHARS) {
      try {
        const r = await summarizer(combined, {
          max_new_tokens: maxTokens,
          min_length: minLen,
        });
        const t = r[0]?.summary_text?.trim();
        if (t) return t;
      } catch {}
    }
    return summaries.join(" ");
  }

  return summaries[0];
}

function toSentenceBullets(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => `- ${s}`)
    .join("\n");
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

    try {
      const speakers = extractSpeakers(text);
      const speakerTexts = textBySpeaker(text);
      const cleaned = text.replace(/^<[^>]+>\s*/gm, "").trim();

      // --- Overview: detailed summary of the full transcript ---
      self.postMessage({ type: "status", message: "Summarizing transcript\u2026" });
      const overview = await summarizeText(cleaned, "Summarizing transcript", {
        max_new_tokens: 200,
        min_length: 40,
      });

      if (!overview) {
        self.postMessage({ type: "status", message: "No summary could be generated" });
        return;
      }

      // --- Top-line: pithy one-liner from the overview ---
      self.postMessage({ type: "status", message: "Generating top-line\u2026" });
      let topLine = "";
      try {
        const r = await summarizer(overview, {
          max_new_tokens: 40,
          min_length: 10,
        });
        topLine = r[0]?.summary_text?.trim() || "";
      } catch {
        // Fall back to first sentence of overview
        const firstSentence = overview.match(/^[^.!?]+[.!?]/);
        topLine = firstSentence ? firstSentence[0].trim() : "";
      }

      // --- Per-speaker summaries ---
      const speakerSummaries = new Map();
      const speakerList = [...speakerTexts.keys()];
      for (let i = 0; i < speakerList.length; i++) {
        const name = speakerList[i];
        const spkText = speakerTexts.get(name);
        if (!spkText || spkText.length < 20) continue;

        self.postMessage({
          type: "status",
          message: `Summarizing ${name}\u2026 (${i + 1}/${speakerList.length})`,
        });

        const spkSummary = await summarizeText(spkText, null, {
          max_new_tokens: 150,
          min_length: 20,
        });
        if (spkSummary) {
          speakerSummaries.set(name, spkSummary);
        }
      }

      // --- Assemble ---
      const now = new Date();
      const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      let md = "# Meeting Notes\n\n";
      md += `**${dateStr}**\n\n`;
      if (speakers.length > 0) {
        md += `**Participants:** ${speakers.join(", ")}\n\n`;
      }
      md += "---\n\n";

      if (topLine) {
        md += `*${topLine}*\n\n`;
      }

      md += "## Overview\n\n";
      md += toSentenceBullets(overview) + "\n\n";

      // Per-speaker sections
      for (const name of speakerList) {
        const spkSummary = speakerSummaries.get(name);
        if (!spkSummary) continue;
        md += `## ${name}\n\n`;
        md += toSentenceBullets(spkSummary) + "\n\n";
      }

      self.postMessage({ type: "result", summary: md });
    } catch (err) {
      console.error("[summary worker] error:", err);
      self.postMessage({
        type: "status",
        message: `Summary error: ${err.message}`,
      });
    }
  }
};
