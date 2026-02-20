/**
 * Summary Web Worker
 *
 * Uses Qwen2.5-0.5B-Instruct via transformers.js to generate structured
 * meeting notes from call transcripts. Runs in-browser via WebGPU (preferred)
 * or WASM fallback.
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

const MODEL_ID = "onnx-community/Qwen2.5-0.5B-Instruct";
// Keep input short so the model doesn't churn forever
const MAX_INPUT_CHARS = 8000;

let generator = null;
let loading = false;

function progress(msg) {
  self.postMessage({ type: "status", message: msg });
}

async function loadModel() {
  if (generator || loading) return;
  loading = true;

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;

  const onProgress = (p) => {
    if (p.status === "progress" && p.progress != null) {
      const pct = Math.round(p.progress);
      progress(`Downloading model\u2026 ${pct}%`);
    }
  };

  if (hasWebGPU) {
    progress("Loading summary model (WebGPU)\u2026");
    try {
      generator = await pipeline("text-generation", MODEL_ID, {
        dtype: "q4f16",
        device: "webgpu",
        progress_callback: onProgress,
      });
      self.postMessage({ type: "ready" });
      loading = false;
      return;
    } catch (err) {
      console.warn("[summary] WebGPU failed, falling back to WASM:", err);
      progress("WebGPU unavailable, falling back to WASM\u2026");
    }
  } else {
    progress("Loading summary model (WASM)\u2026");
  }

  try {
    generator = await pipeline("text-generation", MODEL_ID, {
      dtype: "q4",
      progress_callback: onProgress,
    });
    self.postMessage({ type: "ready" });
  } catch (err) {
    progress(`Failed to load summary model: ${err.message}`);
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

self.onmessage = async (e) => {
  const { type, text } = e.data;
  if (type !== "summarize") return;

  if (!generator) {
    await loadModel();
    if (!generator) {
      progress("Summary model failed to load");
      return;
    }
  }

  try {
    progress("Generating meeting notes\u2026");

    // Truncate very long transcripts, keeping the most recent portion
    let transcript = text;
    if (transcript.length > MAX_INPUT_CHARS) {
      transcript = transcript.slice(-MAX_INPUT_CHARS);
      // Start at a clean line boundary
      const nl = transcript.indexOf("\n");
      if (nl !== -1) transcript = transcript.slice(nl + 1);
    }

    const speakers = extractSpeakers(transcript);
    const speakerList =
      speakers.length > 0
        ? `\nParticipants: ${speakers.join(", ")}`
        : "";

    const messages = [
      {
        role: "system",
        content:
          "You are a meeting notes assistant. You receive call transcripts " +
          "where each line is formatted as `<Speaker Name> what they said`. " +
          "Produce clear, structured meeting notes in markdown.\n\n" +
          "Include these sections:\n" +
          "# Meeting Notes\n" +
          "- A **one-sentence summary** of what the meeting was about\n" +
          "- **Participants** list\n" +
          "- **Key Discussion Points** as bullet points\n" +
          "- **Decisions** (if any were made)\n" +
          "- **Action Items** (if any, with who is responsible)\n" +
          "- A brief **Per-Participant Summary** section with a short " +
          "paragraph for each speaker describing their main contributions\n\n" +
          "Be concise but thorough. Use markdown formatting with headers. " +
          "Do not include the raw transcript in your output.",
      },
      {
        role: "user",
        content:
          `Here is the meeting transcript:${speakerList}\n\n${transcript}\n\n` +
          "Please generate the meeting notes.",
      },
    ];

    const output = await generator(messages, {
      max_new_tokens: 512,
      do_sample: false,
      repetition_penalty: 1.2,
    });

    const result = output[0].generated_text.at(-1).content;

    self.postMessage({ type: "result", summary: result });
  } catch (err) {
    console.error("[summary] error:", err);
    progress(`Summary error: ${err.message}`);
  }
};
