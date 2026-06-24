/** The live account DocHandle, or null if unavailable. */
export function accountHandle(): any;
/** The cached settings DocHandle, or null until ensureSettingsDoc() resolves. */
export function settingsDocHandle(): any;
/**
 * Resolve (or lazily create) the settings doc and cache its handle. Idempotent
 * and concurrency-safe. If the account doc still holds a legacy inline config,
 * it seeds the new doc from it and rewrites the pointer to a URL.
 * @returns {Promise<DocHandle|null>}
 */
export function ensureSettingsDoc(): Promise<DocHandle | null>;
/** Ensure the settings doc is resolved, then return the normalized config. */
export function ensureConfig(): Promise<LLMConfig>;
/**
 * Read the normalized LLM config. Reads the cached settings doc; before that
 * resolves it falls back to a legacy inline config (if any) or defaults. Pass a
 * settings-doc snapshot to normalize that instead.
 * @returns {LLMConfig}
 */
export function readConfig(snapshot: any): LLMConfig;
/** Fill in defaults for any missing fields of a raw `llm` config object. */
export function normalizeConfig(raw?: {}): {
    provider: any;
    temperature: any;
    topP: any;
    topK: any;
    minP: any;
    repetitionPenalty: any;
    frequencyPenalty: any;
    presencePenalty: any;
    seed: any;
    maxTokens: any;
    outputAttentions: any;
    local: any;
    openrouter: any;
    ollama: any;
    webllm: any;
    builtin: any;
    tools: any;
    toolSandbox: boolean;
    prompts: any;
    systemUrl: any;
    preUrl: any;
    recentModels: any;
};
/**
 * Combine the configured system prompt with any tool-supplied one. Tools may
 * append their own instructions to the user's system prompt.
 */
export function effectiveSystem(cfg: any, extraSystem: any): string;
/**
 * Apply the configured pre-prompt + system prompt to a generation input.
 * - string input (raw continuation): prefixes `system\n\npre\n\n…`
 * - chat messages: prepends a system message.
 */
export function applyPrompts(input: any, cfg: any, extraSystem: any): string | any[];
/**
 * Resolve the *active* LLM config reactively, calling `callback(config)` now and
 * whenever it changes.
 *
 * Resolution order: a `patchwork:llm-config` provider in `element`'s subtree
 * (request/provide — lets a future provider element scope config per tool/view)
 * wins; if no provider answers within `timeoutMs`, we fall back to the account
 * doc (and keep it live by listening for account-doc changes). If a provider
 * appears later, it takes over.
 *
 * @param {HTMLElement|null} element  a node inside a <patchwork-view> (null → account doc only)
 * @param {(config: import("./config.js").LLMConfig) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeConfig(element: HTMLElement | null, callback: (config: import("./config.js").LLMConfig) => void, { timeoutMs }?: {
    timeoutMs?: number | undefined;
}): () => void;
/** One-shot resolve of the active config (request + account-doc fallback). */
export function resolveConfig(element: any, opts: any): Promise<any>;
/**
 * Merge a partial config into the account doc under `llm`. Pass the account
 * DocHandle, or omit to use the global one. `undefined` values are skipped;
 * `null` is stored (e.g. an unknown context length).
 */
export function writeConfig(next: any): void;
/**
 * Resolve the flat call config for a given provider from a full LLMConfig — the
 * shape the worker's `generate` message wants.
 */
export function callConfig(cfg: any, overrides?: {}): {
    apiKey: any;
    model: any;
    contextLength: any;
    maxCompletionTokens: any;
    provider: any;
    temperature: any;
    topP: any;
    topK: any;
    minP: any;
    repetitionPenalty: any;
    frequencyPenalty: any;
    presencePenalty: any;
    seed: any;
    topk: number;
    maxNewTokens: any;
} | {
    url: any;
    model: any;
    provider: any;
    temperature: any;
    topP: any;
    topK: any;
    minP: any;
    repetitionPenalty: any;
    frequencyPenalty: any;
    presencePenalty: any;
    seed: any;
    topk: number;
    maxNewTokens: any;
} | {
    model: any;
    custom: any;
    provider: any;
    temperature: any;
    topP: any;
    topK: any;
    minP: any;
    repetitionPenalty: any;
    frequencyPenalty: any;
    presencePenalty: any;
    seed: any;
    topk: number;
    maxNewTokens: any;
} | {
    model: any;
    dtype: any;
    provider: any;
    temperature: any;
    topP: any;
    topK: any;
    minP: any;
    repetitionPenalty: any;
    frequencyPenalty: any;
    presencePenalty: any;
    seed: any;
    topk: number;
    maxNewTokens: any;
};
/** Fetch the OpenRouter model catalogue (with capability metadata). */
export function fetchOpenRouterModels(): Promise<any>;
/** Probe an Ollama server for installed models. */
export function fetchOllamaModels(url: any): Promise<any>;
/** Human label for the current selection. */
export function describeConfig(cfg: any, { openrouterModels }?: {
    openrouterModels?: never[] | undefined;
}): string;
export const ACCOUNT_LLM_FIELD: "llm";
export namespace CONFIG_SELECTOR {
    let type: string;
}
export namespace DEFAULTS {
    let provider: string;
    let temperature: number;
    let topP: number;
    let topK: number;
    let minP: number;
    let repetitionPenalty: number;
    let frequencyPenalty: number;
    let presencePenalty: number;
    let seed: null;
    let maxTokens: null;
    let outputAttentions: boolean;
    namespace local {
        let model: string;
        let dtype: null;
    }
    namespace openrouter {
        export let apiKey: string;
        let model_1: string;
        export { model_1 as model };
        export let contextLength: null;
        export let maxCompletionTokens: null;
    }
    namespace ollama {
        export let url: string;
        let model_2: string;
        export { model_2 as model };
    }
    namespace webllm {
        let model_3: string;
        export { model_3 as model };
        export let custom: never[];
    }
    let builtin: {};
    let tools: null;
    let toolSandbox: boolean;
    let prompts: null;
    let systemUrl: null;
    let preUrl: null;
    let recentModels: never[];
}
export const PARAM_KEYS: string[];
export namespace PROVIDER_CAPS {
    export namespace local_1 {
        export let logprobs: boolean;
        export let attention: boolean;
        let topP_1: boolean;
        export { topP_1 as topP };
        let topK_1: boolean;
        export { topK_1 as topK };
        let minP_1: boolean;
        export { minP_1 as minP };
        let repetitionPenalty_1: boolean;
        export { repetitionPenalty_1 as repetitionPenalty };
        let frequencyPenalty_1: boolean;
        export { frequencyPenalty_1 as frequencyPenalty };
        let presencePenalty_1: boolean;
        export { presencePenalty_1 as presencePenalty };
        let seed_1: boolean;
        export { seed_1 as seed };
        let maxTokens_1: boolean;
        export { maxTokens_1 as maxTokens };
    }
    export { local_1 as local };
    export namespace openrouter_1 {
        let logprobs_1: boolean;
        export { logprobs_1 as logprobs };
        let attention_1: boolean;
        export { attention_1 as attention };
        let topP_2: boolean;
        export { topP_2 as topP };
        let topK_2: boolean;
        export { topK_2 as topK };
        let minP_2: boolean;
        export { minP_2 as minP };
        let repetitionPenalty_2: boolean;
        export { repetitionPenalty_2 as repetitionPenalty };
        let frequencyPenalty_2: boolean;
        export { frequencyPenalty_2 as frequencyPenalty };
        let presencePenalty_2: boolean;
        export { presencePenalty_2 as presencePenalty };
        let seed_2: boolean;
        export { seed_2 as seed };
        let maxTokens_2: boolean;
        export { maxTokens_2 as maxTokens };
    }
    export { openrouter_1 as openrouter };
    export namespace ollama_1 {
        let logprobs_2: boolean;
        export { logprobs_2 as logprobs };
        let attention_2: boolean;
        export { attention_2 as attention };
        let topP_3: boolean;
        export { topP_3 as topP };
        let topK_3: boolean;
        export { topK_3 as topK };
        let minP_3: boolean;
        export { minP_3 as minP };
        let repetitionPenalty_3: boolean;
        export { repetitionPenalty_3 as repetitionPenalty };
        let frequencyPenalty_3: boolean;
        export { frequencyPenalty_3 as frequencyPenalty };
        let presencePenalty_3: boolean;
        export { presencePenalty_3 as presencePenalty };
        let seed_3: boolean;
        export { seed_3 as seed };
        let maxTokens_3: boolean;
        export { maxTokens_3 as maxTokens };
    }
    export { ollama_1 as ollama };
    export namespace webllm_1 {
        let logprobs_3: boolean;
        export { logprobs_3 as logprobs };
        let attention_3: boolean;
        export { attention_3 as attention };
        let topP_4: boolean;
        export { topP_4 as topP };
        let topK_4: boolean;
        export { topK_4 as topK };
        let minP_4: boolean;
        export { minP_4 as minP };
        let repetitionPenalty_4: boolean;
        export { repetitionPenalty_4 as repetitionPenalty };
        let frequencyPenalty_4: boolean;
        export { frequencyPenalty_4 as frequencyPenalty };
        let presencePenalty_4: boolean;
        export { presencePenalty_4 as presencePenalty };
        let seed_4: boolean;
        export { seed_4 as seed };
        let maxTokens_4: boolean;
        export { maxTokens_4 as maxTokens };
    }
    export { webllm_1 as webllm };
    export namespace builtin_1 {
        let logprobs_4: boolean;
        export { logprobs_4 as logprobs };
        let attention_4: boolean;
        export { attention_4 as attention };
        let topP_5: boolean;
        export { topP_5 as topP };
        let topK_5: boolean;
        export { topK_5 as topK };
        let minP_5: boolean;
        export { minP_5 as minP };
        let repetitionPenalty_5: boolean;
        export { repetitionPenalty_5 as repetitionPenalty };
        let frequencyPenalty_5: boolean;
        export { frequencyPenalty_5 as frequencyPenalty };
        let presencePenalty_5: boolean;
        export { presencePenalty_5 as presencePenalty };
        let seed_5: boolean;
        export { seed_5 as seed };
        let maxTokens_5: boolean;
        export { maxTokens_5 as maxTokens };
    }
    export { builtin_1 as builtin };
}
/** In-browser (WebGPU/WASM) models, mirroring chat's catalogue. */
export const LOCAL_MODELS: {
    id: string;
    name: string;
    canUseTool: boolean;
}[];
/** Curated WebLLM (MLC) models — WebGPU, non-ONNX. Type any prebuilt model_id too. */
export const WEBLLM_MODELS: {
    id: string;
    name: string;
}[];
/**
 * Per-user LLM config. The account doc holds a namespaced `llm` field that is a
 * URL pointing at a separate "settings doc" (its body IS the config); a provider
 * owns that doc, so other tools can park their own settings the same way. The
 * account doc is private + synced across the user's devices, a good home for a
 * personal API key — reachable via `window.accountDocHandle`. See
 * `ensureSettingsDoc()` for resolution/creation + the inline→doc migration.
 */
export type LLMConfig = {
    provider: "local" | "openrouter" | "ollama";
    /**
     * default sampling temperature (0 = greedy)
     */
    temperature: number;
    local: {
        model: string;
    };
    openrouter: {
        apiKey: string;
        model: string;
        contextLength: number | null;
        maxCompletionTokens: number | null;
    };
    ollama: {
        url: string;
        model: string;
    };
};
