/**
 * Generate. Resolves to `{ text, stats }`.
 *
 * Two intents:
 *   - CHAT (default): pass chat messages, or a string (wrapped as a user turn).
 *     The instruct/chat model responds; the system prompt applies.
 *   - CONTINUATION: pass a string with `{ continuation: true }` to *continue* the
 *     text rather than answer it. local/webllm/ollama feed it raw; chat-only
 *     OpenRouter is framed with a "continue, output only the continuation"
 *     instruction. (This is what Loom uses; everyone else gets plain chat.)
 *
 * @param {Array|string} messages  chat messages, or a string
 * @param {Object} [opts]
 * @param {boolean} [opts.continuation]  treat a string input as a continuation
 * @param {number} [opts.topk]         stream top-k next-token predictions (0 = off)
 * @param {number} [opts.temperature]  override the configured temperature
 * @param {string} [opts.model]        override the configured model
 * @param {string} [opts.provider]     override the configured provider
 * @param {number} [opts.maxNewTokens]
 * @param {string} [opts.sessionKey]   key for resume-after-refresh / cross-tab
 * @param {(delta:string, full:string)=>void}        [opts.onToken]
 * @param {(candidates:{token,p}[], step:number)=>void} [opts.onPrediction]
 * @param {(stats:object)=>void}                      [opts.onStats]
 * @param {(message:string)=>void}                    [opts.onStatus]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text:string, toolCalls:object[]|null, stats:object|null}>}
 */
export function generate(messages: any[] | string, opts?: {
    continuation?: boolean | undefined;
    topk?: number | undefined;
    temperature?: number | undefined;
    model?: string | undefined;
    provider?: string | undefined;
    maxNewTokens?: number | undefined;
    sessionKey?: string | undefined;
    onToken?: ((delta: string, full: string) => void) | undefined;
    onPrediction?: ((candidates: {
        token: any;
        p: any;
    }[], step: number) => void) | undefined;
    onStats?: ((stats: object) => void) | undefined;
    onStatus?: ((message: string) => void) | undefined;
    signal?: AbortSignal | undefined;
}): Promise<{
    text: string;
    toolCalls: object[] | null;
    stats: object | null;
}>;
/**
 * Stream a completion as an async iterable of telemetry events:
 *   { type:"token", delta, text }
 *   { type:"prediction", candidates:[{token,p}], step }
 *   { type:"stats", ... }
 *   { type:"status", message }
 *   { type:"done", text, stats }
 *
 * @returns {AsyncGenerator}
 */
export function stream(messages: any, opts?: {}): AsyncGenerator;
/**
 * Predict the next-token distribution after `text` — one forward pass, no
 * generation. Resolves to `[{token, p}]` (top-k, highest p first). Powers
 * "predict as you type". Local reads real logits; OpenRouter is best-effort
 * (chat-only models return `[]`); Ollama returns `[]`.
 *
 * @param {string} text
 * @param {Object} [opts]  { topk?, model?, provider?, config?, signal? }
 * @returns {Promise<{token:string,p:number}[]>}
 */
export function predict(text: string, opts?: Object): Promise<{
    token: string;
    p: number;
}[]>;
/**
 * Score every token in `text` — runs a forward pass at each position and
 * returns the model's probability, rank, entropy, and top-k alternatives for
 * the actual next token. Powers the surprisal and info-gain overlays ("how
 * surprised was the model by what you actually wrote?" and "how much did each
 * token reduce its uncertainty?"). Only works for local models.
 *
 * Yields progress events and a final result:
 *   { type:"progress", step, total }
 *   { type:"done", scores:[{token, p, rank, entropy, topk:[{token,p}]}] }
 *
 * @param {string} text
 * @param {Object} [opts]  { config?, signal? }
 * @returns {AsyncGenerator}
 */
export function scoreTokens(text: string, opts?: Object): AsyncGenerator;
/**
 * Compute per-token importance for `text` by erasure-based attribution: a
 * baseline forward pass, then one pass per token with that token masked out,
 * scoring each token by how much its removal shifts the model's next-token
 * distribution (Jensen–Shannon divergence). N+1 forward passes on the local
 * model — genuine importance, not an attention proxy. See Li, Chen, Zhu &
 * Rudin 2016, "Understanding Neural Networks through Representation Erasure".
 *
 * This is erasure-based importance, NOT attention weights — for real attention
 * see computeAttentionWeights. Returns `{decoded, spans}` where decoded is the
 * tokenizer's round-tripped text and spans is `[{from, to, importance}]`
 * (importance normalized to [0,1]) with positions relative to `decoded`. Only
 * works for local models (others resolve to null).
 *
 * @param {string} text
 * @param {Object} [opts]  { config?, signal? }
 * @returns {Promise<{decoded:string, spans:Array}|null>}
 */
export function computeImportance(text: string, opts?: Object): Promise<{
    decoded: string;
    spans: any[];
} | null>;
/**
 * Compute REAL attention weights for `text` (not the erasure proxy that
 * computeImportance returns). Only works for local models exported with an
 * `attentions` output (see glomper-tuning/onnx_attn.py). One forward pass.
 *
 * Resolves to:
 *   { supported:true, dims:{layers,heads,seq}, received, fromLast, spans, tokens, decoded }
 * where `received` and `fromLast` are Float32Arrays of length layers*heads*seq
 * laid out as [(layer*heads + head)*seq + key]:
 *   received[…] = mean attention key j gets across all queries i≥j (causal)
 *   fromLast[…] = attention the final token places on key j
 * `spans` is [{from,to,index}] (char positions in `decoded`, keyed by token
 * index). Resolves to { supported:false } when the model has no attention
 * output, or null for non-local providers.
 *
 * @param {string} text
 * @param {Object} [opts]  { config?, signal? }
 * @returns {Promise<Object|null>}
 */
export function computeAttentionWeights(text: string, opts?: Object): Promise<Object | null>;
/**
 * Extract per-position features from a local model for LoRA-on-head training:
 * a single forward pass returning, for every token position, the final hidden
 * state `h` and the base logits, plus token ids/spans. Requires a model
 * exported with a `last_hidden_state` output (glomper-tuning/onnx_hidden.py).
 *
 * Resolves to { supported, seq, H, V, ids, tokens, spans, decoded, hidden, logits }
 * where `hidden` is a Float32Array(seq*H) and `logits` is a Float32Array(seq*V),
 * both row-major over positions. Returns null for non-local providers, and
 * { supported:false, message } if the model lacks the hidden-state output.
 */
export function extractFeatures(text: any, opts?: {}): Promise<any>;
/**
 * Decode vocab ids to token strings using the loaded local model's tokenizer.
 * Used to label the next-token bars when training a LoRA adapter. Returns a
 * string[] aligned with `ids`, or null for non-local providers.
 */
export function decodeTokens(ids: any, opts?: {}): Promise<any>;
/**
 * Like extractFeatures, but returns the `cut_hidden` state (the residual just
 * before the last block's MLP) — for training a LoRA adapter on that MLP (rung 2).
 * Requires a model exported with onnx_block.py. Resolves to
 * { supported, seq, d, ids, tokens, spans, decoded, hidden: Float32Array(seq*d) }.
 */
export function extractCutFeatures(text: any, opts?: {}): Promise<any>;
/**
 * Diagnostic: probe the loaded model for attention weight support. Posts a
 * `probe-attention` message to the worker and returns the result — includes
 * the ONNX session output names, forward-pass output keys, and whether any
 * attention tensors are available. Only works for local models.
 */
export function probeAttention(text?: string, opts?: {}): Promise<any>;
/**
 * Chat with the user's configured tools available. Tells the model what tools
 * exist, runs an agentic loop: generate → parse `tool-call` blocks → run each
 * handler → feed the result back → generate again, until the model stops calling
 * tools (or maxRounds). Folder-tool handlers run in the MAIN thread (full page
 * access) by default; pass `sandbox` (or set the config's `toolSandbox`) to run
 * them in an isolated Worker instead. Inline tools (with their own `handler` fn)
 * always run as given.
 *
 * @param {Array|string} messages  chat messages (or a string → one user turn)
 * @param {Object} [opts]  same as generate(), plus:
 *   @param {(delta,full,round)=>void} [opts.onToken]
 *   @param {({tool,args,result,error})=>void} [opts.onToolCall]
 *   @param {number} [opts.maxRounds=6]
 *   @param {boolean} [opts.sandbox]  run folder-tool handlers in an isolated Worker
 * @returns {Promise<{text:string, messages:Array}>}
 */
export function generateWithTools(messages: any[] | string, opts?: {
    onToken?: ((delta: any, full: any, round: any) => void) | undefined;
    onToolCall?: (({ tool, args, result, error }: {
        tool: any;
        args: any;
        result: any;
        error: any;
    }) => void) | undefined;
    maxRounds?: number | undefined;
    sandbox?: boolean | undefined;
}): Promise<{
    text: string;
    messages: any[];
}>;
/** Warm the model/connection ahead of the first real call. */
export function preload(opts?: {}): void;
/**
 * Subscribe to worker status messages (model download / shader compile / etc.).
 * Returns an unsubscribe function.
 */
export function onStatus(cb: any): () => boolean;
/** Abort an in-flight generation by its sessionKey. */
export function abort(sessionKey: any): void;
/**
 * Register a local ONNX model uploaded from disk so the worker can load it as
 * `local/<name>`. `files` is `[{path, blob}]` in transformers.js layout
 * (config.json, tokenizer.json, onnx/model_<dtype>.onnx, …). Session-only — the
 * files aren't persisted, so they must be re-registered after a reload.
 *
 * @param {string} id     e.g. "local/my-model"
 * @param {{path:string, blob:Blob}[]} files
 * @param {string} [dtype="q4f16"]
 */
export function registerLocalModel(id: string, files: {
    path: string;
    blob: Blob;
}[], dtype?: string): void;
/**
 * Resume a generation that may have survived a refresh, by sessionKey.
 * Handlers: { onToken(full), onDone(text), onError(msg), onNone() }.
 */
export function resume(sessionKey: any, handlers2?: {}): void;
