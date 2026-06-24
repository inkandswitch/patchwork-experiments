declare function broadcast(msg: any): void;
declare function fmtMB(b: any): string;
declare function installWeightsProgress(): void;
declare function trackDownload(res: any, total: any): Response;
declare function log(...args: any[]): void;
declare function friendlyError(err: any): string;
declare function modelLoadError(): string;
declare function releaseGenerator(): Promise<void>;
declare function ensureLocalFetchPatch(): void;
declare function withTimeout(promise: any, ms: any, label: any): Promise<any>;
declare function loadModel(modelId: any, dtypeOverride: any): Promise<any>;
declare function topkFromLogits(data: any, vocab: any, k: any): {
    id: number;
    p: number;
}[];
declare function safeJson(v: any): any;
declare function samplingExtras(config: any): {
    top_k: any;
    min_p: any;
    repetition_penalty: any;
    frequency_penalty: any;
    presence_penalty: any;
    seed: any;
};
declare function messagesToPrompt(messages: any): string;
declare function doGenerateLocal(gen: any, input: any, config: any): Promise<{
    text: any;
    toolCalls: null;
}>;
declare function doGenerateOpenRouter(gen: any, input: any, config: any): Promise<{
    text: any;
    toolCalls: any;
}>;
declare function doGenerateOllama(gen: any, input: any, config: any): Promise<{
    text: any;
    toolCalls: any;
}>;
declare function predictLocal(text: any, config: any): Promise<any[]>;
declare function scoreTokensLocal(gen: any, text: any, config: any): Promise<void>;
declare function computeImportanceLocal(gen: any, text: any, config: any): Promise<void>;
declare function computeAttentionWeightsLocal(gen: any, text: any, config: any): Promise<void>;
declare function predictOpenRouter(text: any, config: any, signal: any): Promise<any>;
declare function handlePredict(port: any, data: any): void;
declare function ensureWebLLM(model: any, custom: any): Promise<void>;
declare function doGenerateWebLLM(gen: any, input: any, config: any): Promise<{
    text: any;
    toolCalls: any;
}>;
declare function predictWebLLM(text: any, config: any): Promise<any>;
declare function post(gen: any, msg: any): void;
declare function finalize(sessionKey: any, gen: any, text: any, toolCalls: any): void;
declare function fail(sessionKey: any, gen: any, message: any): void;
declare function runGeneration(sessionKey: any, gen: any, provider: any, input: any, config: any): Promise<void>;
declare function extractFeaturesLocal(gen: any, text: any): Promise<void>;
declare function extractCutFeaturesLocal(gen: any, text: any): Promise<void>;
declare function handleMessage(port: any, data: any): void;
/**
 * @patchwork/llm SharedWorker
 *
 * Runs ALL generation (local transformers.js / OpenRouter / Ollama) off the
 * main thread, so a stream survives a page refresh and is shared across tabs
 * keyed by an optional `sessionKey`. Merges chat's SharedWorker with rlm's
 * teaching telemetry: alongside the text we stream the model's next-token
 * distribution ("predictions") and decode stats (TTFT, tokens/sec, the exact
 * sampling settings used) — for local AND OpenRouter.
 *
 * IN:
 *   { type:"generate", id, sessionKey?, provider, messages, config }
 *       config: { model, apiKey?, url?, temperature?, topk?, maxNewTokens?,
 *                 contextLength?, maxCompletionTokens? }
 *   { type:"preload", provider, config }
 *   { type:"resume", sessionKey }
 *   { type:"abort", sessionKey }
 *   { type:"list-local-models" }
 *
 * OUT (per generation `id` unless noted):
 *   { type:"token", id, delta, text }
 *   { type:"prediction", id, step, candidates:[{token,p}] }   // next-token top-k
 *   { type:"stats", id, ...stats }
 *   { type:"result", id, text }
 *   { type:"error", id, message }
 *   { type:"status", message }            // broadcast: model loading, etc.
 *   { type:"ready", ...modelInfo }
 *   { type:"local-models", models }
 *   { type:"resumed"|"resume-result", id, text } | { type:"no-active-generation" }
 */
declare const CDN: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4";
declare const ports: Set<any>;
declare const activeGenerations: Map<any, any>;
declare const LOCAL_MODELS: {
    id: string;
    name: string;
    dtype: string;
}[];
declare const DEFAULT_MODEL_ID: string;
declare const PREDICTION_CAP: 256;
declare let TF: null;
declare let generator: null;
declare let currentModelId: string;
declare let currentDtype: null;
declare let loading: boolean;
declare let loadingPromise: null;
declare let lastLoadError: null;
declare const compiledModels: Set<any>;
declare const localModelFiles: Map<any, any>;
declare const CONTINUE_SYS: "You are a text-continuation engine inside a writing tool. Continue the user's text seamlessly from exactly where it ends, matching its voice, tense, and style. Output ONLY the continuation \u2014 no preamble, no commentary, no explanation, no quotation marks \u2014 and never restate or acknowledge the user's text. If it ends mid-word or mid-sentence, finish it.";
declare let webllmMod: null;
declare let webllmEngine: null;
declare let webllmModel: null;
