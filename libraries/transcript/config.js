/**
 * Per-user transcription (speech-to-text) config. Mirrors `@chee/patchwork-llm`:
 * the account doc holds a namespaced `transcript` field that is a URL pointing
 * at a separate "settings doc" whose body IS the config. The account doc is
 * private + synced across the user's devices — a good home for an API key —
 * reachable via `window.accountDocHandle`. See `ensureSettingsDoc()` for
 * resolution/creation + the inline→doc migration.
 *
 * @typedef {"local"|"openai"} ProviderId
 *
 * @typedef {Object} TranscriptConfig
 * @property {ProviderId} provider
 * @property {{model:string, dtype:string|null}} local   in-browser transformers.js ASR
 * @property {{apiKey:string, model:string, baseUrl:string}} openai  OpenAI-compatible /audio/transcriptions
 *
 * @typedef {{toolId:string, docId?:string}} Scope
 *
 * The flat per-provider shape the worker / fetch path wants. Built by
 * {@link callConfig} from a {@link TranscriptConfig} plus per-call overrides.
 * @typedef {Object} CallConfig
 * @property {ProviderId} provider
 * @property {string} [model]
 * @property {string|null} [dtype]
 * @property {string} [apiKey]
 * @property {string} [baseUrl]
 *
 * @typedef {import("@automerge/automerge-repo").DocHandle<any>} DocHandle
 */

import {subscribe} from "@inkandswitch/patchwork-providers"

export const ACCOUNT_TRANSCRIPT_FIELD = "transcript"
export const CONFIG_SELECTOR = {type: "patchwork:transcript-config"}

export const DEFAULTS = {
	provider: "local",
	// In-browser (WebGPU/WASM) ASR via transformers.js. dtype null = auto: the
	// worker picks per-device (q4 decoder on WebGPU, q8 on WASM).
	local: {model: "onnx-community/moonshine-base-ONNX", dtype: null},
	// Any OpenAI-compatible /v1/audio/transcriptions endpoint (OpenAI Whisper,
	// Groq, a local whisper.cpp server, …).
	openai: {
		apiKey: "",
		model: "whisper-1",
		baseUrl: "https://api.openai.com/v1",
	},
}

/** The live account DocHandle, or null if unavailable. */
export function accountHandle() {
	return (typeof window !== "undefined" && window.accountDocHandle) || null
}

function repoRef() {
	return (typeof window !== "undefined" && window.repo) || null
}

// --- settings doc -----------------------------------------------------------
// `accountDoc.transcript` is a URL pointing at a separate "settings doc" whose
// body IS the config. We accept either a bare URL string or `{config: url}` so
// there's room for inline state next to the pointer later. The resolved handle
// is cached so reads/writes stay synchronous after a one-time async bootstrap.

/** @type {DocHandle|null} */
let settingsHandle = null
/** @type {Promise<DocHandle|null>|null} */
let settingsReady = null // de-dupes concurrent ensureSettingsDoc() calls

/** The pointer on the account doc → settings-doc URL (string), or null. */
function accountSettingsUrl() {
	const v = accountHandle()?.doc?.()?.[ACCOUNT_TRANSCRIPT_FIELD]
	if (typeof v === "string") return v
	if (v && typeof v === "object" && typeof v.config === "string") return v.config
	return null
}

/** The legacy inline config object (pre-settings-doc), or null. */
function legacyInline() {
	const v = accountHandle()?.doc?.()?.[ACCOUNT_TRANSCRIPT_FIELD]
	return v && typeof v === "object" && !Array.isArray(v) && !("config" in v)
		? v
		: null
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
		const legacy = legacyInline()
		const seed = legacy ? JSON.parse(JSON.stringify(legacy)) : {}
		seed["@patchwork"] = {type: "transcript:settings"}
		const created = await repo.create2(seed)
		settingsHandle = created
		account.change((/** @type {any} */ d) => {
			d[ACCOUNT_TRANSCRIPT_FIELD] = created.url
		})
		return settingsHandle
	})()
	return settingsReady
}

/**
 * Ensure the settings doc is resolved, then return the normalized config.
 * @param {Scope} [_scope]  accepted for parity with @chee/patchwork-llm (unused for now)
 */
export async function ensureConfig(_scope) {
	await ensureSettingsDoc()
	return readConfig()
}

/**
 * Read the normalized config. Reads the cached settings doc; before that
 * resolves it falls back to a legacy inline config (if any) or defaults. Pass a
 * settings-doc snapshot to normalize that instead.
 * @param {Record<string, any>} [snapshot]
 * @returns {TranscriptConfig}
 */
export function readConfig(snapshot) {
	if (snapshot !== undefined) return normalizeConfig(snapshot)
	if (settingsHandle) return normalizeConfig(settingsHandle.doc() ?? {})
	return normalizeConfig(legacyInline() ?? {})
}

/**
 * Fill in defaults for any missing fields of a raw `transcript` config object.
 * @param {any} [raw]
 * @returns {TranscriptConfig}
 */
export function normalizeConfig(raw = {}) {
	return {
		provider: raw.provider === "openai" ? "openai" : "local",
		local: {...DEFAULTS.local, ...(raw.local ?? {})},
		openai: {...DEFAULTS.openai, ...(raw.openai ?? {})},
	}
}

/**
 * Subscribe to the active config and re-fire whenever it changes.
 *
 * Resolution order: a `patchwork:transcript-config` provider in `element`'s
 * subtree (request/provide — lets a provider element scope config per
 * tool/view) wins; if no provider answers within `timeoutMs`, we fall back to
 * the account doc (and keep it live by listening for settings-doc changes). If
 * a provider appears later, it takes over.
 *
 * @param {HTMLElement|null} element  a node inside a <patchwork-view> (null → account doc only)
 * @param {(config: TranscriptConfig) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeConfig(element, callback, {timeoutMs = 50} = {}) {
	let providerAnswered = false
	/** @type {(() => void)|null} */
	let fallbackOff = null
	let providerOff = () => {}
	/** @type {ReturnType<typeof setTimeout>|undefined} */
	let timer = undefined
	let cancelled = false

	const startFallback = () => {
		if (providerAnswered || cancelled) return
		callback(readConfig()) // immediate sync value so UI isn't blank
		ensureSettingsDoc().then((handle) => {
			if (providerAnswered || cancelled || !handle) return
			callback(readConfig())
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

/**
 * One-shot resolve of the active config (request + account-doc fallback).
 * @param {HTMLElement|null} element
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<TranscriptConfig>}
 */
export function resolveConfig(element, opts) {
	return new Promise((resolve) => {
		/** @type {(() => void)|null} */
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
 * Merge a partial config into the settings doc. `undefined` values are skipped.
 * @param {Partial<TranscriptConfig> & Record<string, any>} next
 */
export function writeConfig(next) {
	/** @param {DocHandle|null} handle */
	const apply = (handle) => {
		if (!handle) return
		handle.change((/** @type {any} */ d) => {
			if (next.provider !== undefined) d.provider = next.provider
			for (const group of ["local", "openai"]) {
				if (!next[group]) continue
				if (!d[group]) d[group] = {}
				for (const [field, value] of Object.entries(next[group])) {
					if (value === undefined) continue
					d[group][field] = value // null is allowed in automerge
				}
			}
		})
	}
	if (settingsHandle) apply(settingsHandle)
	else ensureSettingsDoc().then(apply)
}

/**
 * Resolve the flat call config for the active provider — the shape the worker
 * (local) / fetch path (openai) wants.
 * @param {TranscriptConfig} cfg
 * @param {Partial<CallConfig>} [overrides]
 * @returns {CallConfig}
 */
export function callConfig(cfg, overrides = {}) {
	const provider = overrides.provider ?? cfg.provider
	if (provider === "openai") {
		return {
			provider,
			apiKey: overrides.apiKey ?? cfg.openai.apiKey,
			model: overrides.model ?? cfg.openai.model,
			baseUrl: overrides.baseUrl ?? cfg.openai.baseUrl,
		}
	}
	return {
		provider: "local",
		model: overrides.model ?? cfg.local.model,
		dtype: overrides.dtype ?? cfg.local.dtype ?? null,
	}
}

// ---------------------------------------------------------------------------
// Model catalogue (for a future picker)
// ---------------------------------------------------------------------------

/** In-browser (WebGPU/WASM) ASR models. */
export const LOCAL_MODELS = [
	{id: "onnx-community/moonshine-base-ONNX", name: "Moonshine base"},
	{id: "onnx-community/moonshine-tiny-ONNX", name: "Moonshine tiny (fast)"},
	{id: "onnx-community/whisper-base", name: "Whisper base"},
	{id: "onnx-community/whisper-tiny.en", name: "Whisper tiny (English)"},
]

/**
 * A short human label for a config (e.g. for a status line).
 * @param {any} cfg
 */
export function describeConfig(cfg) {
	const c = normalizeConfig(cfg)
	if (c.provider === "openai") return `OpenAI · ${c.openai.model}`
	const known = LOCAL_MODELS.find((m) => m.id === c.local.model)
	return `Local · ${known ? known.name : c.local.model.split("/").pop()}`
}
