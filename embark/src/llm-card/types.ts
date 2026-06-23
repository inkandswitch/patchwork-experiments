import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import type { accept, subscribe } from "@inkandswitch/patchwork-providers";

// An LLM card: the user writes a plain-language `description`, hits Activate,
// and an LLM agentic loop generates a dependency-free `effect.js` into the
// card's own automerge "directory" folder. The card then loads that file via
// the service worker and runs it against the card's element, where it hooks
// into the canvas providers.
export type LlmCardDoc = {
  "@patchwork": { type: "llm-card" };
  // The user's paragraph describing the desired effect.
  description: string;
  status: LlmCardStatus;
  // The directory doc that holds generated files; created on first Activate.
  folderUrl?: AutomergeUrl;
  // The module the loader imports and runs (default "effect.js").
  entry: string;
  // The text/script/result log of the generation loop, shown in the UI.
  transcript: TranscriptEntry[];
  // A giveUp reason or fatal error, set when `status` is "failed".
  failure?: string;
  config: LlmCardConfig;
};

export type LlmCardStatus = "draft" | "generating" | "active" | "failed";

export type LlmCardConfig = {
  apiUrl: string;
  model: string;
};

// One entry in the generation transcript. Mirrors llm-canvas's OutputBlock: a
// streamed text region, or a script the loop evaluated (with its captured
// output/error).
export type TranscriptEntry =
  | { type: "text"; content: string }
  | {
      type: "script";
      code: string;
      description?: string;
      output?: string;
      error?: string;
    };

// A directory doc (patchwork filesystem "directory" strategy): maps file paths
// to automerge urls of FileDocs. The service worker walks these to serve files.
export type DirectoryDoc = {
  "@patchwork": { type: "directory"; title?: string };
  [path: string]: unknown;
};

// A leaf file served by the service worker; `mimeType` becomes the response
// content-type so a js file loads as a real ES module.
export type FileDoc = {
  content: string;
  mimeType: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// Emitted by the streaming parser (see parser.ts).
export type ParsedBlock =
  | { id: number; type: "text"; content: string; complete: boolean }
  | {
      id: number;
      type: "script";
      code: string;
      description?: string;
      complete: boolean;
    };

// Console captured during script evaluation, replayed back into the transcript.
export type CapturedConsole = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  flush: () => string;
};

// The eval-scope API handed to the LLM loop's <script> blocks while it
// generates. NOTE: the activated effect is NOT handed this object - it receives
// only `element` and imports any deps from esm.sh.
export type LoopApi = {
  element: ToolElement;
  repo: Repo;
  subscribe: typeof subscribe;
  accept: typeof accept;
  loadSkill: (name: string) => string;
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string | undefined>;
  listFiles: () => Promise<string[]>;
  giveUp: (reason: string) => never;
  console: CapturedConsole;
};

// The shape the generated effect module must export: a default function that
// receives the card's element and returns an optional cleanup.
export type EffectModule = {
  default: (element: ToolElement) => (() => void) | void;
};
