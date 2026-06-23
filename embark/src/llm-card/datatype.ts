import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { createSpecDoc } from "./folder";
import type { LlmCardConfig, LlmCardDoc } from "./types";

// OpenAI-compatible endpoint. The key is read from VITE_LLM_API_KEY at build
// time (see llm-loop.ts). Mirrors llm-canvas's defaults.
export const DEFAULT_CONFIG: LlmCardConfig = {
  apiUrl: "https://openrouter.ai/api/v1",
  model: "anthropic/claude-opus-4.6",
};

export const LlmCardDatatype: DatatypeImplementation<LlmCardDoc> = {
  init(doc, repo) {
    doc["@patchwork"] = { type: "llm-card" };
    doc.description = "";
    doc.status = "draft";
    doc.entry = "effect.js";
    doc.transcript = [];
    doc.config = { ...DEFAULT_CONFIG };
    // Give every new card an empty spec doc up front so the info popover has
    // something to render before the first Activate.
    doc.specUrl = createSpecDoc(repo);
  },
  getTitle(doc) {
    const first = doc.description?.split("\n")[0]?.trim();
    return first ? first.slice(0, 60) : "LLM Card";
  },
  setTitle(doc, title) {
    doc.description = title;
  },
};
