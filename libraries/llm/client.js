/**
 * Main-thread client for the @patchwork/llm worker.
 *
 * Connects to the SharedWorker (falling back to a dedicated Worker), routes
 * messages back to the right in-flight generation, and exposes two call styles:
 *
 *   const { text, stats } = await generate(messages, { onToken, onPrediction, onStats })
 *   for await (const ev of stream(messages, { topk: 5 })) { ... }
 *
 * Provider / model / key / temperature come from the account-doc config
 * (see config.js) unless overridden via opts.
 */

import {readConfig, ensureConfig, callConfig, applyPrompts, effectiveSystem} from "./config.js"
import {builtinGenerate} from "./builtin.js"
import {resolveTools, buildToolsSystem, parseToolCalls, runTool, resolveCfgPrompts} from "./tools.js"

let connection = null
let idSeq = 0
const handlers = new Map() // generation id -> (msg) => void
const resumeHandlers = new Map() // sessionKey -> { onToken, onDone, onError, onNone }
const statusListeners = new Set() // (message) => void

function nextId() {
	return "llm-" + ++idSeq + "-" + (performance.now() | 0)
}

function dispatch(msg) {
	if (!msg) return
	if (msg.type === "status") {
		for (const f of statusListeners) f(msg.message)
		return
	}
	// Resume replies are keyed by sessionKey (the reconnecting tab never knew the
	// original generation id) and tell us the live id to adopt for what follows.
	if (
		msg.type === "resumed" ||
		msg.type === "resume-result" ||
		msg.type === "no-active-generation"
	) {
		const rh = msg.sessionKey != null && resumeHandlers.get(msg.sessionKey)
		if (!rh) return
		if (msg.type === "no-active-generation") {
			resumeHandlers.delete(msg.sessionKey)
			rh.onNone?.()
		} else if (msg.type === "resume-result") {
			resumeHandlers.delete(msg.sessionKey)
			rh.onToken?.(msg.text)
			rh.onDone?.(msg.text)
		} else {
			rh.onToken?.(msg.text)
			handlers.set(msg.id, (m) => {
				if (m.type === "token") rh.onToken?.(m.text)
				else if (m.type === "result") {
					handlers.delete(msg.id)
					resumeHandlers.delete(msg.sessionKey)
					rh.onDone?.(m.text)
				} else if (m.type === "error") {
					handlers.delete(msg.id)
					resumeHandlers.delete(msg.sessionKey)
					rh.onError?.(m.message)
				}
			})
		}
		return
	}
	const h = msg.id != null && handlers.get(msg.id)
	if (h) h(msg)
}

function getConnection() {
	if (connection) return connection
	// NOTE: `new URL("./worker.js", import.meta.url)` MUST stay inline inside the
	// constructor — that's the exact pattern bundlers (vite) statically detect to
	// emit the worker chunk; hoisting it to a variable silently breaks bundling.
	if (typeof SharedWorker !== "undefined") {
		const sw = new SharedWorker(new URL("./worker.js", import.meta.url), {
			type: "module",
			name: "patchwork-llm",
		})
		sw.port.onmessage = (ev) => dispatch(ev.data)
		sw.port.start()
		connection = {post: (m) => sw.port.postMessage(m)}
	} else {
		const w = new Worker(new URL("./worker.js", import.meta.url), {type: "module"})
		w.onmessage = (ev) => dispatch(ev.data)
		connection = {post: (m) => w.postMessage(m)}
	}
	return connection
}

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
 * @returns {Promise<{text:string, stats:object|null}>}
 */
export async function generate(messages, opts = {}) {
	const cfg0 = opts.config ?? (await ensureConfig())
	// Resolve the selected system/pre prompt docs → their text. repo.find is
	// cached, so this is cheap after first load.
	const cfg = await resolveCfgPrompts(cfg0)
	const config = callConfig(cfg, opts)

	// Built-in (Chrome Prompt API) runs on the main thread, not the worker.
	if (config.provider === "builtin") {
		const pre = cfg.resolved?.pre || ""
		const text =
			typeof messages === "string"
				? pre
					? pre + "\n\n" + messages
					: messages
				: messages
		return builtinGenerate(text, {
			temperature: config.temperature,
			topK: config.topK,
			system: effectiveSystem(cfg, opts.system),
			onToken: opts.onToken,
			onStatus: opts.onStatus,
			signal: opts.signal,
		}).then((t) => ({text: t, stats: null}))
	}

	// A string input is CHAT by default — wrapped as a user turn, so instruct/chat
	// models respond normally and the system prompt applies. It's a raw
	// CONTINUATION only when opts.continuation is set: raw-fed for
	// local/webllm/ollama, and CONTINUE_SYS-framed for chat-only OpenRouter (see
	// the worker). Loom passes continuation:true; other callers get plain chat.
	const asContinuation = !!opts.continuation && typeof messages === "string"
	const prepared = asContinuation
		? messages
		: typeof messages === "string"
			? [{role: "user", content: messages}]
			: messages
	// Prepend the configured system + pre-prompt (and any tool-supplied system).
	const input = applyPrompts(prepared, cfg, opts.system)
	const conn = getConnection()
	const id = nextId()
	const sessionKey = opts.sessionKey || id
	let stats = null

	return new Promise((resolve, reject) => {
		const onStatus = opts.onStatus
		if (onStatus) statusListeners.add(onStatus)
		const cleanup = () => {
			handlers.delete(id)
			if (onStatus) statusListeners.delete(onStatus)
			if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
		}
		function onAbort() {
			conn.post({type: "abort", sessionKey})
			cleanup()
			reject(new DOMException("Aborted", "AbortError"))
		}

		handlers.set(id, (msg) => {
			switch (msg.type) {
				case "token":
					opts.onToken?.(msg.delta, msg.text)
					break
				case "prediction":
					opts.onPrediction?.(msg.candidates, msg.step)
					break
				case "stats":
					stats = msg
					opts.onStats?.(msg)
					break
				case "result":
					cleanup()
					resolve({text: msg.text, stats})
					break
				case "error":
					cleanup()
					reject(new Error(msg.message))
					break
			}
		})

		if (opts.signal) {
			if (opts.signal.aborted) return onAbort()
			opts.signal.addEventListener("abort", onAbort)
		}
		// A string is a raw continuation prompt; an array is chat messages.
		const payload = {type: "generate", id, sessionKey, provider: config.provider, config}
		if (typeof input === "string") payload.text = input
		else payload.messages = input
		conn.post(payload)
	})
}

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
export async function* stream(messages, opts = {}) {
	const queue = []
	let wake = null
	let finished = false
	let error = null
	const push = (ev) => {
		queue.push(ev)
		wake?.()
	}

	generate(messages, {
		...opts,
		onToken: (delta, text) => push({type: "token", delta, text}),
		onPrediction: (candidates, step) =>
			push({type: "prediction", candidates, step}),
		onStats: (s) => push({type: "stats", ...s}),
		onStatus: (message) => push({type: "status", message}),
	})
		.then((r) => push({type: "done", text: r.text, stats: r.stats}))
		.catch((e) => (error = e))
		.finally(() => {
			finished = true
			wake?.()
		})

	while (true) {
		if (queue.length) {
			yield queue.shift()
			continue
		}
		if (finished) break
		await new Promise((r) => (wake = r))
	}
	if (error) throw error
}

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
export async function predict(text, opts = {}) {
	const cfg = await resolveCfgPrompts(opts.config ?? (await ensureConfig()))
	const config = callConfig(cfg, {...opts, topk: opts.topk || 10})
	// continuation → frame chat-only providers (OpenRouter) to predict the
	// *continuation's* next token, not a chat reply's. Opt-in (Loom sets it).
	config.continuation = !!opts.continuation
	// Built-in exposes no next-token logprobs.
	if (config.provider === "builtin") return Promise.resolve([])
	const promptedText = applyPrompts(text, cfg, opts.system) // prepends pre-prompt (no system in raw)
	const conn = getConnection()
	const id = nextId()
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			handlers.delete(id)
			if (opts.signal) opts.signal.removeEventListener("abort", onAbort)
		}
		function onAbort() {
			cleanup()
			reject(new DOMException("Aborted", "AbortError"))
		}
		handlers.set(id, (msg) => {
			if (msg.type === "predictions") {
				cleanup()
				resolve(msg.candidates)
			} else if (msg.type === "error") {
				cleanup()
				reject(new Error(msg.message))
			}
		})
		if (opts.signal) {
			if (opts.signal.aborted) return onAbort()
			opts.signal.addEventListener("abort", onAbort)
		}
		conn.post({type: "predict", id, provider: config.provider, text: promptedText, config})
	})
}

/**
 * Chat with the user's configured tools available. Tells the model what tools
 * exist, runs an agentic loop: generate → parse `tool-call` blocks → run each
 * handler (in the MAIN thread, full page access) → feed the result back →
 * generate again, until the model stops calling tools (or maxRounds).
 *
 * @param {Array|string} messages  chat messages (or a string → one user turn)
 * @param {Object} [opts]  same as generate(), plus:
 *   @param {(delta,full,round)=>void} [opts.onToken]
 *   @param {({tool,args,result,error})=>void} [opts.onToolCall]
 *   @param {number} [opts.maxRounds=6]
 * @returns {Promise<{text:string, messages:Array}>}
 */
export async function generateWithTools(messages, opts = {}) {
	const cfg = opts.config ?? (await ensureConfig())
	const tools = await resolveTools(cfg)
	const toolSystem = buildToolsSystem(tools)
	const system = [toolSystem, opts.system].filter(Boolean).join("\n\n") || undefined
	const convo = Array.isArray(messages)
		? [...messages]
		: [{role: "user", content: String(messages)}]
	const maxRounds = opts.maxRounds ?? 6
	let finalText = ""

	for (let round = 0; round < maxRounds; round++) {
		const {text} = await generate(convo, {
			...opts,
			system,
			onToken: opts.onToken
				? (delta, full) => opts.onToken(delta, full, round)
				: undefined,
		})
		finalText = text
		const calls = tools.length ? parseToolCalls(text) : []
		if (!calls.length) break
		convo.push({role: "assistant", content: text})
		for (const call of calls) {
			const tool = tools.find((t) => t.name === call.tool)
			let resultText
			if (!tool) {
				resultText = `Error: no tool named "${call.tool}"`
				opts.onToolCall?.({tool: call.tool, args: call.args, error: "unknown tool"})
			} else {
				try {
					const result = await runTool(tool, call.args)
					resultText = typeof result === "string" ? result : JSON.stringify(result)
					opts.onToolCall?.({tool: call.tool, args: call.args, result})
				} catch (e) {
					resultText = "Error: " + (e?.message || String(e))
					opts.onToolCall?.({
						tool: call.tool,
						args: call.args,
						error: e?.message || String(e),
					})
				}
			}
			convo.push({role: "user", content: `Tool "${call.tool}" returned:\n${resultText}`})
		}
	}
	return {text: finalText, messages: convo}
}

/** Warm the model/connection ahead of the first real call. */
export function preload(opts = {}) {
	const cfg = opts.config ?? readConfig()
	const config = callConfig(cfg, opts)
	getConnection().post({type: "preload", provider: config.provider, config})
}

/**
 * Subscribe to worker status messages (model download / shader compile / etc.).
 * Returns an unsubscribe function.
 */
export function onStatus(cb) {
	getConnection()
	statusListeners.add(cb)
	return () => statusListeners.delete(cb)
}

/** Abort an in-flight generation by its sessionKey. */
export function abort(sessionKey) {
	getConnection().post({type: "abort", sessionKey})
}

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
export function registerLocalModel(id, files, dtype = "q4f16") {
	getConnection().post({type: "register-local-model", id, files, dtype})
}

/**
 * Resume a generation that may have survived a refresh, by sessionKey.
 * Handlers: { onToken(full), onDone(text), onError(msg), onNone() }.
 */
export function resume(sessionKey, handlers2 = {}) {
	resumeHandlers.set(sessionKey, handlers2)
	getConnection().post({type: "resume", sessionKey})
}
