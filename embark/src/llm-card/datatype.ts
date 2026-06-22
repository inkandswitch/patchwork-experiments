import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { LlmCardConfig, LlmCardDoc } from "./types";

// OpenAI-compatible endpoint. The key is read from VITE_LLM_API_KEY at build
// time (see llm-loop.ts). Mirrors llm-canvas's defaults.
export const DEFAULT_CONFIG: LlmCardConfig = {
  apiUrl: "https://openrouter.ai/api/v1",
  model: "anthropic/claude-opus-4.6",
};

export const LlmCardDatatype: DatatypeImplementation<LlmCardDoc> = {
  init(doc) {
    doc["@patchwork"] = { type: "llm-card" };
    doc.description = "";
    doc.status = "draft";
    doc.entry = "effect.js";
    doc.transcript = [];
    doc.config = { ...DEFAULT_CONFIG };
  },
  getTitle(doc) {
    const first = doc.description?.split("\n")[0]?.trim();
    return first ? first.slice(0, 60) : "LLM Card";
  },
  setTitle(doc, title) {
    doc.description = title;
  },
};
