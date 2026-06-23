/**
 * Per-user LLM config. The account doc holds a namespaced `llm` field that is a
 * URL pointing at a separate "settings doc" (its body IS the config); a provider
 * owns that doc, so other tools can park their own settings the same way. The
 * account doc is private + synced across the user's devices, a good home for a
 * personal API key — reachable via `window.accountDocHandle`. See
 * `ensureSettingsDoc()` for resolution/creation + the inline→doc migration.
 *
 * @typedef {Object} LLMConfig
 * @property {"local"|"openrouter"|"ollama"} provider
 * @property {number} temperature  default sampling temperature (0 = greedy)
 * @property {{model:string}} local
 * @property {{apiKey:string,model:string,contextLength:?number,maxCompletionTokens:?number}} openrouter
 * @property {{url:string,model:string}} ollama
 */

import {subscribe} from "@inkandswitch/patchwork-providers"

export const ACCOUNT_LLM_FIELD = "llm"
export const CONFIG_SELECTOR = {type: "patchwork:llm-config"}

export const DEFAULTS = {
	provider: "local",
	// --- sampling / decoding parameters ---
	temperature: 0.7,
	topP: 0.9, // nucleus sampling (1 = off)
	topK: 0, // top-k sampling (0 = off)
	minP: 0, // min-p sampling (0 = off)
	repetitionPenalty: 1.1, // 1 = off (transformers / ollama / openrouter)
	frequencyPenalty: 0, // -2..2 (openrouter / ollama / webllm)
	presencePenalty: 0, // -2..2
	seed: null, // fixed seed for reproducibility (null = random)
	maxTokens: null, // output cap (null = provider default / per-call)
	outputAttentions: false, // request per-token attention scores (only some providers)
	local: {model: "onnx-community/Qwen3-0.6B-ONNX", dtype: null}, // dtype null = auto (catalogue default / q4f16)
	openrouter: {
		apiKey: "",
		model: "anthropic/claude-sonnet-4",
		contextLength: null,
		maxCompletionTokens: null,
	},
	ollama: {url: "http://localhost:11434", model: "llama3.2"},
	webllm: {model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", custom: []}, // MLC WebLLM (WebGPU); custom = self-compiled model records
	builtin: {}, // Chrome built-in AI (Gemini Nano) — one model, no config
	tools: null, // URL of a "folder" doc — its .docs are the llm:tool DocLinks
	toolSandbox: false, // run folder-tool handlers in an isolated Worker (no page access)
	prompts: null, // URL of a "folder" doc — its .docs are the prompt DocLinks
	systemUrl: null, // selected llm:system-prompt doc
	preUrl: null, // selected llm:pre-prompt doc
	recentModels: [], // most-recently-chosen {provider, model}, newest first
}

// Sampling/decoding params reset together by the picker's "Reset to defaults".
export const PARAM_KEYS = [
	"temperature",
	"topP",
	"topK",
	"minP",
	"repetitionPenalty",
	"frequencyPenalty",
	"presencePenalty",
	"seed",
	"maxTokens",
	"outputAttentions",
]

export const PROVIDER_CAPS = {
	local:      { logprobs: true,  attention: true,  topP: true,  topK: true,  minP: true,  repetitionPenalty: true,  frequencyPenalty: false, presencePenalty: false, seed: false, maxTokens: true  },
	openrouter: { logprobs: true,  attention: false, topP: true,  topK: true,  minP: true,  repetitionPenalty: true,  frequencyPenalty: true,  presencePenalty: true,  seed: true,  maxTokens: true  },
	ollama:     { logprobs: false, attention: false, topP: true,  topK: true,  minP: true,  repetitionPenalty: true,  frequencyPenalty: false, presencePenalty: false, seed: true,  maxTokens: true  },
	webllm:     { logprobs: true,  attention: false, topP: true,  topK: false, minP: false, repetitionPenalty: false, frequencyPenalty: true,  presencePenalty: true,  seed: true,  maxTokens: true  },
	builtin:    { logprobs: false, attention: false, topP: false, topK: true,  minP: false, repetitionPenalty: false, frequencyPenalty: false, presencePenalty: false, seed: false, maxTokens: false },
}

/** The live account DocHandle, or null if unavailable. */
export function accountHandle() {
	return (typeof window !== "undefined" && window.accountDocHandle) || null
}

function repoRef() {
	return (typeof window !== "undefined" && window.repo) || null
}

// --- settings doc -----------------------------------------------------------
// `accountDoc.llm` is no longer the config itself — it's a URL pointing at a
// separate "settings doc" whose body IS the config. This lets a provider own
// the settings somewhere of its choosing (and lets other tools, e.g. rlm, park
// their own). We accept either a bare URL string or `{config: url}` so there's
// room for inline state next to the pointer later. The resolved handle is
// cached so reads/writes stay synchronous after a one-time async bootstrap.

let settingsHandle = null
let settingsReady = null // de-dupes concurrent ensureSettingsDoc() calls

/** The pointer on the account doc → settings-doc URL (string), or null. */
function accountSettingsUrl() {
	const v = accountHandle()?.doc?.()?.[ACCOUNT_LLM_FIELD]
	if (typeof v === "string") return v
	if (v && typeof v === "object" && typeof v.config === "string") return v.config
	return null
}

/** The legacy inline config object (pre-settings-doc), or null. */
function legacyInline() {
	const v = accountHandle()?.doc?.()?.[ACCOUNT_LLM_FIELD]
	return v && typeof v === "object" && !Array.isArray(v) && !("config" in v) ? v : null
}

/** The cached settings DocHandle, or null until ensureSettingsDoc() resolves. */
export function settingsDocHandle() {
	return settingsHandle
}

/**
 * Resolve (or lazily create) the settings doc and cache its handle. Idempotent
 * and concurrency-safe. If the account doc still holds a legacy inline config,
 * it seeds the new doc from it and rewrites the pointer to a URL.
 * @returns {Promise<DocHandle|null>}
 */
export function ensureSettingsDoc() {
	if (settingsHandle) return Promise.resolve(settingsHandle)
	if (settingsReady) return settingsReady
	settingsReady = (async () => {
		const account = accountHandle()
		const repo = repoRef()
		if (!repo || !account) return null
		const url = accountSettingsUrl()
		if (url) {
			settingsHandle = await repo.find(url)
			return settingsHandle
		}
		// No pointer yet: seed from a legacy inline config if present, else empty.
		const legacy = legacyInline()
		const seed = legacy ? JSON.parse(JSON.stringify(legacy)) : {}
		seed["@patchwork"] = {type: "llm:settings"}
		settingsHandle = await repo.create2(seed)
		account.change((d) => {
			d[ACCOUNT_LLM_FIELD] = settingsHandle.url
		})
		return settingsHandle
	})()
	return settingsReady
}

/** Ensure the settings doc is resolved, then return the normalized config. */
export async function ensureConfig() {
	await ensureSettingsDoc()
	return readConfig()
}

/**
 * Read the normalized LLM config. Reads the cached settings doc; before that
 * resolves it falls back to a legacy inline config (if any) or defaults. Pass a
 * settings-doc snapshot to normalize that instead.
 * @returns {LLMConfig}
 */
export function readConfig(snapshot) {
	if (snapshot !== undefined) return normalizeConfig(snapshot)
	if (settingsHandle) return normalizeConfig(settingsHandle.doc() ?? {})
	return normalizeConfig(legacyInline() ?? {})
}

/** Fill in defaults for any missing fields of a raw `llm` config object. */
export function normalizeConfig(raw = {}) {
	return {
		provider: raw.provider ?? DEFAULTS.provider,
		temperature:
			typeof raw.temperature === "number" ? raw.temperature : DEFAULTS.temperature,
		topP: typeof raw.topP === "number" ? raw.topP : DEFAULTS.topP,
		topK: typeof raw.topK === "number" ? raw.topK : DEFAULTS.topK,
		minP: typeof raw.minP === "number" ? raw.minP : DEFAULTS.minP,
		repetitionPenalty:
			typeof raw.repetitionPenalty === "number"
				? raw.repetitionPenalty
				: DEFAULTS.repetitionPenalty,
		frequencyPenalty:
			typeof raw.frequencyPenalty === "number"
				? raw.frequencyPenalty
				: DEFAULTS.frequencyPenalty,
		presencePenalty:
			typeof raw.presencePenalty === "number"
				? raw.presencePenalty
				: DEFAULTS.presencePenalty,
		seed: raw.seed ?? DEFAULTS.seed,
		maxTokens: raw.maxTokens ?? DEFAULTS.maxTokens,
		outputAttentions: raw.outputAttentions ?? DEFAULTS.outputAttentions,
		local: {...DEFAULTS.local, ...(raw.local ?? {})},
		openrouter: {...DEFAULTS.openrouter, ...(raw.openrouter ?? {})},
		ollama: {...DEFAULTS.ollama, ...(raw.ollama ?? {})},
		webllm: {
			...DEFAULTS.webllm,
			...(raw.webllm ?? {}),
			// Self-compiled MLC models: just {model_id, model_lib}. The weights URL is
			// derived from the model_id (its HuggingFace repo) in the worker. Plain
			// copies — these get re-assigned into the doc, and automerge rejects
			// re-inserting its own proxy objects.
			custom: Array.isArray(raw.webllm?.custom)
				? raw.webllm.custom
						.map((c) => ({model_id: c.model_id ?? "", model_lib: c.model_lib ?? ""}))
						.filter((c) => c.model_id || c.model_lib)
				: [],
		},
		builtin: {...DEFAULTS.builtin, ...(raw.builtin ?? {})},
		// Folders (URLs). The legacy array/object shapes resolve to null here; the
		// one-time migrateConfig() converts them and rewrites the account doc.
		tools: typeof raw.tools === "string" ? raw.tools : null,
		toolSandbox: !!raw.toolSandbox,
		prompts: typeof raw.prompts === "string" ? raw.prompts : null,
		systemUrl:
			raw.systemUrl ??
			(raw.prompts && typeof raw.prompts === "object" ? raw.prompts.systemUrl : null) ??
			null,
		preUrl:
			raw.preUrl ??
			(raw.prompts && typeof raw.prompts === "object" ? raw.prompts.preUrl : null) ??
			null,
		// Plain copies (see webllm.custom note) — re-assigned into the doc on save.
		recentModels: Array.isArray(raw.recentModels)
			? raw.recentModels.map((r) => ({provider: r.provider, model: r.model ?? null}))
			: [],
	}
}

/**
 * Combine the configured system prompt with any tool-supplied one. Tools may
 * append their own instructions to the user's system prompt.
 */
export function effectiveSystem(cfg, extraSystem) {
	// `cfg.resolved.{system,pre}` is the prompt TEXT, filled in by resolveCfgPrompts
	// (which reads the selected prompt docs). Absent in a bare cfg → empty.
	return [cfg?.resolved?.system, extraSystem].filter(Boolean).join("\n\n")
}

/**
 * Apply the configured pre-prompt + system prompt to a generation input.
 * - string input (raw continuation): prefixes `system\n\npre\n\n…`
 * - chat messages: prepends a system message.
 */
export function applyPrompts(input, cfg, extraSystem) {
	const sys = effectiveSystem(cfg, extraSystem)
	const pre = cfg?.resolved?.pre || ""
	if (typeof input === "string") {
		// Raw completion has no `system` role, so the system prompt is OMITTED
		// here — only the pre-prompt (literal text before your input) is prepended.
		void sys
		return pre ? pre + "\n\n" + input : input
	}
	// Chat: the system prompt becomes a real `system` turn; the pre-prompt is
	// glued onto the front of the first user message (part of the user's input).
	let msgs = [...input]
	if (pre) {
		const i = msgs.findIndex((m) => m.role === "user")
		if (i === -1) msgs.unshift({role: "user", content: pre})
		else msgs[i] = {...msgs[i], content: pre + "\n\n" + msgs[i].content}
	}
	return sys ? [{role: "system", content: sys}, ...msgs] : msgs
}

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
export function subscribeConfig(element, callback, {timeoutMs = 50} = {}) {
	let providerAnswered = false
	let fallbackOff = null
	let providerOff = () => {}
	let timer = null

	let cancelled = false
	const startFallback = () => {
		if (providerAnswered || cancelled) return
		callback(readConfig()) // immediate sync value (legacy/defaults) so UI isn't blank
		ensureSettingsDoc().then((handle) => {
			if (providerAnswered || cancelled || !handle) return
			callback(readConfig()) // real config now that the settings doc resolved
			const onChange = () => {
				if (!providerAnswered && !cancelled) callback(readConfig())
			}
			handle.on("change", onChange)
			fallbackOff = () => handle.off("change", onChange)
		})
	}

	if (element) {
		providerOff = subscribe(element, CONFIG_SELECTOR, (raw) => {
			providerAnswered = true
			clearTimeout(timer)
			fallbackOff?.()
			fallbackOff = null
			callback(normalizeConfig(raw))
		})
		timer = setTimeout(startFallback, timeoutMs)
	} else {
		startFallback()
	}

	return () => {
		cancelled = true
		clearTimeout(timer)
		providerOff()
		fallbackOff?.()
	}
}

/** One-shot resolve of the active config (request + account-doc fallback). */
export function resolveConfig(element, opts) {
	return new Promise((resolve) => {
		let off = null
		let done = false
		off = subscribeConfig(
			element,
			(cfg) => {
				if (done) return
				done = true
				queueMicrotask(() => off && off())
				resolve(cfg)
			},
			opts
		)
	})
}

/**
 * Merge a partial config into the account doc under `llm`. Pass the account
 * DocHandle, or omit to use the global one. `undefined` values are skipped;
 * `null` is stored (e.g. an unknown context length).
 */
export function writeConfig(next) {
	const apply = (handle) => {
		if (!handle) return
		handle.change((d) => {
			if (next.provider !== undefined) d.provider = next.provider
			for (const k of [
				"temperature",
				"topP",
				"topK",
				"minP",
				"repetitionPenalty",
				"frequencyPenalty",
				"presencePenalty",
				"seed",
				"maxTokens",
				"outputAttentions",
				"tools", // folder URL
				"toolSandbox", // run folder-tool handlers in an isolated Worker
				"prompts", // folder URL
				"systemUrl", // selected prompt docs
				"preUrl",
				"recentModels", // [{provider, model}], newest first
			]) {
				if (next[k] !== undefined) d[k] = next[k]
			}
			for (const group of ["local", "openrouter", "ollama", "webllm", "builtin"]) {
				if (!next[group]) continue
				if (!d[group]) d[group] = {}
				for (const [field, value] of Object.entries(next[group])) {
					if (value === undefined) continue
					d[group][field] = value // null is allowed in automerge
				}
			}
		})
	}
	// Settings doc is usually already resolved (the picker awaits it). If a write
	// races ahead of that, resolve first, then apply.
	if (settingsHandle) apply(settingsHandle)
	else ensureSettingsDoc().then(apply)
}

/**
 * Resolve the flat call config for a given provider from a full LLMConfig — the
 * shape the worker's `generate` message wants.
 */
export function callConfig(cfg, overrides = {}) {
	const provider = overrides.provider ?? cfg.provider
	const base = {
		provider,
		temperature:
			overrides.temperature != null ? overrides.temperature : cfg.temperature,
		topP: overrides.topP != null ? overrides.topP : cfg.topP,
		topK: cfg.topK, // sampling top-k (distinct from `topk`, the prediction-viz count)
		minP: cfg.minP,
		repetitionPenalty: cfg.repetitionPenalty,
		frequencyPenalty: cfg.frequencyPenalty,
		presencePenalty: cfg.presencePenalty,
		seed: cfg.seed,
		topk: overrides.topk | 0, // how many candidate logprobs to stream (viz)
		maxNewTokens: overrides.maxNewTokens ?? cfg.maxTokens ?? undefined,
	}
	if (provider === "openrouter") {
		return {
			...base,
			apiKey: overrides.apiKey ?? cfg.openrouter.apiKey,
			model: overrides.model ?? cfg.openrouter.model,
			contextLength: cfg.openrouter.contextLength,
			maxCompletionTokens: cfg.openrouter.maxCompletionTokens,
		}
	}
	if (provider === "ollama") {
		return {
			...base,
			url: overrides.url ?? cfg.ollama.url,
			model: overrides.model ?? cfg.ollama.model,
		}
	}
	if (provider === "webllm") {
		return {
			...base,
			model: overrides.model ?? cfg.webllm.model,
			custom: cfg.webllm.custom || [], // self-compiled MLC model records
		}
	}
	return {...base, model: overrides.model ?? cfg.local.model, dtype: overrides.dtype ?? cfg.local.dtype ?? undefined}
}

// ---------------------------------------------------------------------------
// Model catalogues (for the picker)
// ---------------------------------------------------------------------------

/** In-browser (WebGPU/WASM) models, mirroring chat's catalogue. */
export const LOCAL_MODELS = [
	{id: "onnx-community/Qwen3-4B-ONNX", name: "Qwen3 4B", canUseTool: true},
	{id: "onnx-community/Qwen3-1.7B-ONNX", name: "Qwen3 1.7B", canUseTool: true},
	{id: "onnx-community/Qwen3-0.6B-ONNX", name: "Qwen3 0.6B", canUseTool: true},
	{
		id: "onnx-community/Llama-3.2-1B-Instruct-ONNX",
		name: "Llama 3.2 1B",
		canUseTool: true,
	},
	{id: "onnx-community/gemma-3-1b-it-ONNX", name: "Gemma 3 1B", canUseTool: false},
	{
		id: "onnx-community/gemma-3-270m-it-ONNX",
		name: "Gemma 3 270M (tiny)",
		canUseTool: false,
	},
	{
		id: "onnx-community/DeepSeek-R1-Distill-Qwen-1.5B-ONNX",
		name: "DeepSeek-R1 Distill 1.5B (reasoning)",
		canUseTool: false,
	},
	{
		id: "onnx-community/Qwen2.5-Coder-1.5B-Instruct",
		name: "Qwen2.5 Coder 1.5B",
		canUseTool: true,
	},
	{
		id: "onnx-community/Qwen2.5-0.5B-Instruct",
		name: "Qwen2.5 0.5B",
		canUseTool: true,
	},
	{
		id: "onnx-community/LFM2-1.2B-ONNX",
		name: "LFM2 1.2B",
		canUseTool: false,
	},
	{
		id: "onnx-community/Phi-3.5-mini-instruct-onnx-web",
		name: "Phi 3.5 Mini",
		canUseTool: false,
	},
	{
		id: "onnx-community/SmolLM2-1.7B-Instruct-ONNX",
		name: "SmolLM2 1.7B",
		canUseTool: false,
	},
	{
		id: "onnx-community/SmolLM2-360M-Instruct",
		name: "SmolLM2 360M (tiny)",
		canUseTool: false,
	},
]

/** Curated WebLLM (MLC) models — WebGPU, non-ONNX. Type any prebuilt model_id too. */
export const WEBLLM_MODELS = [
	{id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 0.5B"},
	{id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen2.5 1.5B"},
	{id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", name: "Qwen2.5 3B"},
	{id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", name: "Llama 3.2 1B"},
	{id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", name: "Llama 3.2 3B"},
	{id: "Phi-3.5-mini-instruct-q4f16_1-MLC", name: "Phi 3.5 Mini"},
	{id: "gemma-2-2b-it-q4f16_1-MLC", name: "Gemma 2 2B"},
	{id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", name: "Mistral 7B"},
	{id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", name: "SmolLM2 1.7B"},
	{id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC", name: "TinyLlama 1.1B"},
]

/** Fetch the OpenRouter model catalogue (with capability metadata). */
export async function fetchOpenRouterModels() {
	const resp = await fetch("https://openrouter.ai/api/v1/models")
	const data = await resp.json()
	return (data.data || [])
		.filter((m) => m.id)
		.map((m) => ({
			id: m.id,
			name: m.name || m.id,
			context_length: m.context_length || m.top_provider?.context_length,
			max_completion_tokens: m.top_provider?.max_completion_tokens,
			supported_parameters: m.supported_parameters || [],
			input_modalities: m.architecture?.input_modalities || [],
			pricing: m.pricing || null,
		}))
		.sort((a, b) => a.name.localeCompare(b.name))
}

/** Probe an Ollama server for installed models. */
export async function fetchOllamaModels(url) {
	const base = (url || DEFAULTS.ollama.url).replace(/\/$/, "")
	const resp = await fetch(base + "/api/tags")
	const data = await resp.json()
	return (data.models || []).map((m) => m.name || m.model)
}

/** Human label for the current selection. */
export function describeConfig(cfg, {openrouterModels = []} = {}) {
	if (cfg.provider === "local") {
		const m = LOCAL_MODELS.find((x) => x.id === cfg.local.model)
		const name = m ? m.name : cfg.local.model.replace(/^local\//, "")
		return "Browser " + name
	}
	if (cfg.provider === "openrouter") {
		const m = openrouterModels.find((x) => x.id === cfg.openrouter.model)
		return "OpenRouter " + (m ? m.name : cfg.openrouter.model)
	}
	if (cfg.provider === "webllm") {
		const m = WEBLLM_MODELS.find((x) => x.id === cfg.webllm.model)
		return "WebLLM " + (m ? m.name : cfg.webllm.model)
	}
	if (cfg.provider === "builtin") return "Built-in (Chrome)"
	return "Ollama " + cfg.ollama.model
}
