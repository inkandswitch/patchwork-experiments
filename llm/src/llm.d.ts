// Minimal ambient types for the (plain-JS) @chee/patchwork-llm library.
// Covers just what this tool uses; see ../libraries/llm for the full API.
declare module "@chee/patchwork-llm" {
  export type LLMMessage = {
    role: "system" | "user" | "assistant";
    content: string;
  };

  export type StreamEvent =
    | { type: "status"; message: string }
    | { type: "token"; delta: string; text: string }
    | { type: "prediction"; step: number; candidates: { token: string; p: number }[] }
    | { type: "stats"; [key: string]: unknown }
    | { type: "done"; text: string; stats: unknown };

  export interface GenerateOpts {
    system?: string;
    model?: string;
    provider?: string;
    temperature?: number;
    topk?: number;
    maxNewTokens?: number;
    sessionKey?: string;
    signal?: AbortSignal;
    onToken?: (delta: string, full: string) => void;
    onStatus?: (message: string) => void;
  }

  export function stream(
    messages: LLMMessage[] | string,
    opts?: GenerateOpts
  ): AsyncGenerator<StreamEvent>;

  export function generate(
    messages: LLMMessage[] | string,
    opts?: GenerateOpts
  ): Promise<{ text: string; toolCalls: unknown[] | null; stats: unknown }>;

  // Model picker UI (writes choice to the account settings doc).
  export function popup(opts?: Record<string, unknown>): HTMLElement & { result: Promise<unknown> };
  export function dom(opts?: Record<string, unknown>): HTMLElement;

  export function readConfig(snapshot?: unknown): Record<string, unknown>;
  export function writeConfig(patch: Record<string, unknown>): Promise<void>;

  // Resolve (or lazily create, via the shared "llm" `patchwork:tool-storage`
  // doc) the settings doc, then return the normalized config. `element` should
  // be a node inside a mounted <patchwork-view> — call this once on mount so
  // later elementless resolutions elsewhere (e.g. inside `stream`/`generate`)
  // can reuse the same settings doc.
  export function ensureConfig(
    scope?: { toolId: string; docId?: string },
    element?: HTMLElement | null
  ): Promise<Record<string, unknown>>;

  // Human label for a config, e.g. "Browser Qwen2.5" / "OpenRouter gpt-4o".
  export function describeConfig(
    cfg: Record<string, unknown>,
    opts?: { openrouterModels?: { id: string; name: string }[] }
  ): string;

  // Subscribe to config changes. Returns an unsubscribe function. Pass an
  // element inside a mounted <patchwork-view> so the tool-storage-backed
  // settings doc can resolve; null only works once some other caller has
  // already supplied one.
  export function subscribeConfig(
    element: HTMLElement,
    callback: (cfg: Record<string, unknown>) => void,
    opts?: { timeoutMs?: number }
  ): () => void;
}
