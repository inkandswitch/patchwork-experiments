/**
 * Per-user transcription (speech-to-text) config, held in a private settings
 * doc (its body IS the config) requested from the `patchwork:tool-storage`
 * provider (see `patchwork-base/providers`) under the shared id `"transcript"`
 * — mirrors `@chee/patchwork-llm`'s `"llm"` id. The provider lazily creates
 * the doc and scopes it to the current account, so this needs no
 * `window.accountDocHandle` global: just a DOM node inside a mounted
 * `<patchwork-view>` subtree (any element passed to
 * `ensureSettingsDoc`/`subscribeConfig`/etc). See `ensureSettingsDoc()` for
 * resolution/creation.
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

import {subscribe, request} from "@inkandswitch/patchwork-providers"

// Shared id every transcription-touching tool requests its settings doc
// under (see `patchwork:tool-storage`, patchwork-base/providers).
export const TOOL_STORAGE_ID = "transcript"
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

function repoRef() {
	return (typeof window !== "undefined" && window.repo) || null
}

// --- settings doc -----------------------------------------------------------
// The config lives in its own doc (its body IS the config), requested from the
// `patchwork:tool-storage` provider under `TOOL_STORAGE_ID`. That provider
// owns the account-doc pointer and the lazy-create; this module just resolves
// it and caches the handle so reads/writes stay synchronous afterwards.
//
// Resolving needs *some* DOM node inside a mounted `<patchwork-view>` subtree
// (to dispatch the `patchwork:subscribe` request against). Rather than fall
// back to a global, we remember the most recent element any caller *did*
// supply (`lastElement`, warmed by whichever tool's UI mounted first) and let
// elementless callers piggyback on that bootstrap. Until one has happened,
// resolution simply isn't ready yet — the same as any other not-yet-loaded doc.

/** @type {DocHandle|null} */
let settingsHandle = null
/** @type {Promise<DocHandle|null>|null} */
let settingsReady = null // de-dupes concurrent ensureSettingsDoc() calls
/** @type {HTMLElement|null} */
let lastElement = null

/** The cached settings DocHandle, or null until ensureSettingsDoc() resolves. */
export function settingsDocHandle() {
	return settingsHandle
}

/**
 * Resolve (or lazily create, via the `patchwork:tool-storage` provider) the
 * settings doc and cache its handle. Idempotent and concurrency-safe. Pass an
 * `element` the first time it's available (any node inside a mounted
 * `<patchwork-view>`); later elementless calls reuse whichever element a
 * caller most recently supplied.
 * @param {HTMLElement|null} [element]
 * @returns {Promise<DocHandle|null>}
 */
export function ensureSettingsDoc(element) {
	if (element) lastElement = element
	if (settingsHandle) return Promise.resolve(settingsHandle)
	if (settingsReady) return settingsReady
	const el = element ?? lastElement
	const repo = repoRef()
	if (!repo || !el) return Promise.resolve(null) // not bootstrapped yet; don't cache — a later call with an element can still resolve
	settingsReady = (async () => {
		const url = await request(el, {type: "patchwork:tool-storage", toolId: TOOL_STORAGE_ID})
		if (!url) {
			settingsReady = null
			return null
		}
		settingsHandle = await repo.find(url)
		return settingsHandle
	})()
	return settingsReady
}

/**
 * Ensure the settings doc is resolved, then return the normalized config.
 * @param {Scope} [_scope]  accepted for parity with @chee/patchwork-llm (unused for now)
 * @param {HTMLElement|null} [element]
 */
export async function ensureConfig(_scope, element) {
	await ensureSettingsDoc(element)
	return readConfig()
}

/**
 * Read the normalized config. Reads the cached settings doc, or defaults if it
 * hasn't resolved yet. Pass a settings-doc snapshot to normalize that instead.
 * @param {Record<string, any>} [snapshot]
 * @returns {TranscriptConfig}
 */
export function readConfig(snapshot) {
	if (snapshot !== undefined) return normalizeConfig(snapshot)
	return normalizeConfig(settingsHandle?.doc() ?? {})
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
 * this tool's `patchwork:tool-storage` settings doc (and keep it live by
 * listening for changes to it). If a provider appears later, it takes over.
 * Always pass a real `element` when you have one — it's also how the settings
 * doc itself gets resolved (see `ensureSettingsDoc`), even for later callers
 * that don't.
 *
 * @param {HTMLElement} element  a node inside a <patchwork-view>
 * @param {(config: TranscriptConfig) => void} callback
 * @returns {() => void} unsubscribe
 */
export function subscribeConfig(element, callback, {timeoutMs = 50} = {}) {
	if (!element) throw new TypeError("subscribeConfig requires an element")
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
		ensureSettingsDoc(element).then((handle) => {
			if (providerAnswered || cancelled || !handle) return
			callback(readConfig())
			const onChange = () => {
				if (!providerAnswered && !cancelled) callback(readConfig())
			}
			handle.on("change", onChange)
			fallbackOff = () => handle.off("change", onChange)
		})
	}

	providerOff = subscribe(element, CONFIG_SELECTOR, (raw) => {
		providerAnswered = true
		clearTimeout(timer)
		fallbackOff?.()
		fallbackOff = null
		callback(normalizeConfig(raw))
	})
	timer = setTimeout(startFallback, timeoutMs)

	return () => {
		cancelled = true
		clearTimeout(timer)
		providerOff()
		fallbackOff?.()
	}
}

/**
 * One-shot resolve of the active config (request + account-doc fallback).
 * @param {HTMLElement} element
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
