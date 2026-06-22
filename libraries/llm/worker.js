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

// v4: the version where TextStreamer + a logits_processor probe (the per-token
// prediction telemetry) are verified working together (rlm uses this combo).
const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4"
const ports = new Set()

function broadcast(msg) {
	for (const port of ports) {
		try {
			port.postMessage(msg)
		} catch {}
	}
}

// sessionKey -> { id, port, fullText, done, finalText, abortController }
const activeGenerations = new Map()

self.addEventListener("error", (e) =>
	broadcast({type: "status", message: "Worker error: " + (e.message || "")})
)
self.addEventListener("unhandledrejection", (e) =>
	broadcast({
		type: "status",
		message: "Worker error: " + (e.reason?.message || e.reason || ""),
	})
)

// ---------------------------------------------------------------------------
// Local models (transformers.js)
// ---------------------------------------------------------------------------

const LOCAL_MODELS = [
	{id: "onnx-community/Qwen3-4B-ONNX", name: "Qwen3 4B (best)", dtype: "q4f16"},
	{id: "onnx-community/Qwen3-1.7B-ONNX", name: "Qwen3 1.7B", dtype: "q4f16"},
	{id: "onnx-community/Qwen3-0.6B-ONNX", name: "Qwen3 0.6B (fast)", dtype: "q4f16"},
	{id: "onnx-community/Llama-3.2-1B-Instruct-ONNX", name: "Llama 3.2 1B", dtype: "q4f16"},
	{id: "onnx-community/Phi-3.5-mini-instruct-onnx-web", name: "Phi 3.5 Mini", dtype: "q4f16"},
	{id: "onnx-community/SmolLM2-1.7B-Instruct-ONNX", name: "SmolLM2 1.7B", dtype: "q4f16"},
]
const DEFAULT_MODEL_ID = LOCAL_MODELS[2].id
const PREDICTION_CAP = 256 // cap per-step prediction events so a long gen can't flood

let TF = null
let generator = null
let currentModelId = DEFAULT_MODEL_ID
let loading = false
let loadingPromise = null
const compiledModels = new Set()

// User-supplied local ONNX models (in transformers.js layout) uploaded from
// disk. We serve their files to transformers.js by patching the worker's fetch
// — the same trick rlm uses for CDN files — so a model id like "local/<name>"
// loads from memory instead of the network.
const localModelFiles = new Map() // id -> { files: Map<relpath, Blob>, dtype }

function ensureLocalFetchPatch() {
	if (self.__loomFetchPatched) return
	self.__loomFetchPatched = true
	const realFetch = self.fetch.bind(self)
	self.fetch = (input, init) => {
		try {
			const url = typeof input === "string" ? input : input?.url || ""
			for (const [id, entry] of localModelFiles) {
				const marker = "/" + id + "/resolve/"
				const at = url.indexOf(marker)
				if (at === -1) continue
				const after = url.slice(at + marker.length) // "<rev>/<relpath>"
				const rel = after.substring(after.indexOf("/") + 1)
				const file =
					entry.files.get(rel) || entry.files.get(rel.split("/").pop())
				if (file) return Promise.resolve(new Response(file, {status: 200}))
				return Promise.resolve(
					new Response("local model file not found: " + rel, {status: 404})
				)
			}
		} catch {}
		return realFetch(input, init)
	}
}

function withTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(label + " timed out")), ms)
		),
	])
}

async function loadModel(modelId) {
	modelId = modelId || DEFAULT_MODEL_ID
	if (generator && currentModelId !== modelId) generator = null
	if (generator) return
	if (loading && loadingPromise) return loadingPromise
	currentModelId = modelId
	loading = true
	let resolveLoading
	loadingPromise = new Promise((r) => (resolveLoading = r))
	const reg = localModelFiles.get(modelId)
	if (reg) ensureLocalFetchPatch()
	const modelDef = reg
		? {dtype: reg.dtype}
		: LOCAL_MODELS.find((m) => m.id === modelId) || {dtype: "q4f16"}

	try {
		broadcast({type: "status", message: "Loading transformers.js…"})
		TF = await import(/* @vite-ignore */ CDN)
		TF.env.allowLocalModels = false
		TF.env.useBrowserCache = true
		if (navigator.storage?.persist) await navigator.storage.persist()
	} catch (err) {
		loading = false
		loadingPromise = null
		resolveLoading()
		return
	}

	const isFirstCompile = !compiledModels.has(modelId)
	function progressCb(backend) {
		const fileProgress = new Map()
		return (p) => {
			if (p.status === "progress" && p.progress != null && p.file) {
				fileProgress.set(p.file, {loaded: p.loaded || 0, total: p.total || 0})
				const shortName = p.file.split("/").pop() || p.file
				let tl = 0,
					ts = 0
				for (const f of fileProgress.values()) {
					tl += f.loaded
					ts += f.total
				}
				const overall = ts > 0 ? Math.round((100 * tl) / ts) : Math.round(p.progress)
				broadcast({
					type: "status",
					message: `Downloading ${shortName}… ${Math.round(p.progress)}% (overall ${overall}%)`,
				})
			} else if (p.status === "ready") {
				broadcast({
					type: "status",
					message: isFirstCompile
						? `⚠️ Compiling shaders for ${backend} (first time — might freeze for a bit)…`
						: `Compiling shaders for ${backend}…`,
				})
			}
		}
	}

	const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu
	const attempts = []
	if (hasWebGPU) attempts.push({device: "webgpu", label: "WebGPU"})
	attempts.push({device: undefined, label: "WASM"})

	for (const attempt of attempts) {
		try {
			generator = await withTimeout(
				TF.pipeline("text-generation", modelId, {
					dtype: modelDef.dtype,
					device: attempt.device,
					progress_callback: progressCb(attempt.label),
				}),
				180000,
				attempt.label + " pipeline"
			)
			compiledModels.add(modelId)
			broadcast({type: "status", message: `Model ready (${attempt.label})`})
			broadcast({type: "ready", model: modelId, device: attempt.label})
			break
		} catch (err) {
			broadcast({
				type: "status",
				message: attempt.label + " failed" + (attempt.device ? " — trying WASM…" : ""),
			})
		}
	}
	loading = false
	loadingPromise = null
	resolveLoading()
}

// Top-k of a logits row as softmax probabilities (two passes + a tiny top-k
// scan — cheap enough to run every decode step). Adapted from rlm.
function topkFromLogits(data, vocab, k) {
	let max = -Infinity
	for (let i = 0; i < vocab; i++) if (data[i] > max) max = data[i]
	let sum = 0
	const idx = [],
		val = []
	for (let i = 0; i < vocab; i++) {
		const v = data[i]
		sum += Math.exp(v - max)
		if (idx.length < k) {
			idx.push(i)
			val.push(v)
		} else {
			let mi = 0
			for (let j = 1; j < k; j++) if (val[j] < val[mi]) mi = j
			if (v > val[mi]) {
				val[mi] = v
				idx[mi] = i
			}
		}
	}
	return idx
		.map((id, j) => ({id, p: Math.exp(val[j] - max) / sum}))
		.sort((a, b) => b.p - a.p)
}

// Optional OpenAI-style sampling params, omitting off/default values so a
// provider that doesn't support one isn't upset.
// Parse a tool-call arguments value (string or already-object) → object.
function safeJson(v) {
	if (v && typeof v === "object") return v
	if (typeof v !== "string") return {}
	try {
		return JSON.parse(v)
	} catch {
		return {}
	}
}

function samplingExtras(config) {
	const p = {}
	if (config.topK > 0) p.top_k = config.topK
	if (config.minP > 0) p.min_p = config.minP
	if (config.repetitionPenalty && config.repetitionPenalty !== 1)
		p.repetition_penalty = config.repetitionPenalty
	if (config.frequencyPenalty) p.frequency_penalty = config.frequencyPenalty
	if (config.presencePenalty) p.presence_penalty = config.presencePenalty
	if (config.seed != null && config.seed !== "") p.seed = config.seed
	return p
}

async function doGenerateLocal(gen, input, config) {
	const tokenizer = generator.tokenizer
	const isText = typeof input === "string"
	const temperature = config.temperature ?? 0.7
	const topk = config.topk | 0
	const maxNewTokens = config.maxNewTokens ?? 2048

	let promptTokens = 0
	try {
		const prompt = isText
			? input
			: tokenizer.apply_chat_template(input, {
					tokenize: false,
					add_generation_prompt: true,
			  })
		promptTokens = tokenizer.encode(prompt).length
	} catch {}

	const tStart = performance.now()
	let tFirst = 0
	let full = ""

	const streamer = new TF.TextStreamer(tokenizer, {
		skip_prompt: true,
		skip_special_tokens: true,
		callback_function: (text) => {
			if (!tFirst) tFirst = performance.now()
			full += text
			gen.fullText = full
			post(gen, {type: "token", delta: text, text: full})
		},
	})

	// Teaching probe: a plain function is a valid logits processor; we read the
	// next-token distribution and stream the top candidates, returning logits
	// unchanged so generation is untouched.
	let step = 0
	const logits_processor =
		topk > 0
			? [
					(inputIds, logits) => {
						if (step < PREDICTION_CAP) {
							try {
								const vocab = logits.dims.at(-1)
								const data = logits.data
								const candidates = topkFromLogits(data, vocab, topk).map(
									({id, p}) => ({token: tokenizer.decode([id]), p: +p.toFixed(4)})
								)
								// Full-distribution entropy (bits) from raw logits
								let mx = -Infinity
								for (let j = 0; j < vocab; j++) if (data[j] > mx) mx = data[j]
								let sm = 0
								for (let j = 0; j < vocab; j++) sm += Math.exp(data[j] - mx)
								let ent = 0
								for (let j = 0; j < vocab; j++) {
									const p = Math.exp(data[j] - mx) / sm
									if (p > 0) ent -= p * Math.log2(p)
								}
								post(gen, {type: "prediction", step, candidates, entropy: +ent.toFixed(3)})
							} catch {}
						}
						step++
						return logits
					},
			  ]
			: undefined

	const output = await generator(input, {
		max_new_tokens: maxNewTokens,
		do_sample: temperature > 0,
		temperature,
		top_p: config.topP ?? 0.9,
		...(config.topK > 0 ? {top_k: config.topK} : {}),
		...(config.minP > 0 ? {min_p: config.minP} : {}),
		repetition_penalty: config.repetitionPenalty ?? 1.1,
		streamer,
		logits_processor,
	})

	const text =
		full || output?.[0]?.generated_text?.at(-1)?.content || ""

	let genTokens = 0
	try {
		genTokens = tokenizer.encode(text).length
	} catch {}
	const now = performance.now()
	post(gen, {
		type: "stats",
		provider: "local",
		model: currentModelId,
		promptTokens,
		genTokens,
		ttftMs: tFirst ? Math.round(tFirst - tStart) : null,
		totalMs: Math.round(now - tStart),
		tokPerSec: tFirst ? +(genTokens / ((now - tFirst) / 1000)).toFixed(1) : null,
		decode: {
			greedy: !(temperature > 0),
			temperature,
			top_p: config.topP ?? 0.9,
			repetition_penalty: config.repetitionPenalty ?? 1.1,
			maxNewTokens,
		},
	})
	// Local has no native tool API; the client parses the model's text (XML/JSON)
	// when tools were requested via the system prompt.
	return {text, toolCalls: null}
}

// ---------------------------------------------------------------------------
// OpenRouter (SSE) — with logprobs → predictions, usage → stats
// ---------------------------------------------------------------------------

// Chat-only providers (OpenRouter, etc.) can't do raw completion — they'd
// *answer* the text. So a raw continuation is framed as a chat turn instructing
// the model to continue and emit ONLY the continuation.
const CONTINUE_SYS =
	"You are a text-continuation engine inside a writing tool. Continue the user's text seamlessly from exactly where it ends, matching its voice, tense, and style. Output ONLY the continuation — no preamble, no commentary, no explanation, no quotation marks — and never restate or acknowledge the user's text. If it ends mid-word or mid-sentence, finish it."

async function doGenerateOpenRouter(gen, input, config) {
	const isText = typeof input === "string"
	const temperature = config.temperature ?? 0.7
	const topk = config.topk | 0
	const body = {
		model: config.model || "anthropic/claude-sonnet-4",
		stream: true,
		stream_options: {include_usage: true},
		temperature,
	}
	if (config.topP != null) body.top_p = config.topP
	Object.assign(body, samplingExtras(config))
	// Always chat; a raw string becomes a "continue this" chat turn.
	body.messages = isText
		? [{role: "system", content: CONTINUE_SYS}, {role: "user", content: input}]
		: input
	if (config.maxNewTokens) body.max_tokens = config.maxNewTokens
	else if (config.contextLength) {
		const inputEstimate = Math.ceil(JSON.stringify(input).length / 4)
		const maxOutput = config.maxCompletionTokens || 8192
		body.max_tokens = Math.min(
			maxOutput,
			Math.max(1024, config.contextLength - inputEstimate - 256)
		)
	}
	if (topk > 0) {
		body.logprobs = true
		body.top_logprobs = Math.min(topk, 20) // OpenAI caps top_logprobs at 20
	}

	// Native function calling: a non-streaming request so we get structured
	// tool_calls back (streaming tool_calls deltas aren't worth reassembling here).
	if (config.tools && config.tools.length) {
		body.tools = config.tools
		body.tool_choice = "auto"
		body.stream = false
		delete body.stream_options
		delete body.logprobs
		delete body.top_logprobs
		const t0 = performance.now()
		const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json"},
			body: JSON.stringify(body),
			signal: gen.abortController.signal,
		})
		if (!res.ok) throw new Error("OpenRouter: " + (await res.text()))
		const data = await res.json()
		const msg = data.choices?.[0]?.message || {}
		const text = msg.content || ""
		if (text) post(gen, {type: "token", delta: text, text})
		gen.fullText = text
		const toolCalls = (msg.tool_calls || []).map((tc) => ({
			id: tc.id,
			name: tc.function?.name,
			args: safeJson(tc.function?.arguments),
		}))
		post(gen, {
			type: "stats",
			provider: "openrouter",
			model: config.model,
			promptTokens: data.usage?.prompt_tokens ?? null,
			genTokens: data.usage?.completion_tokens ?? null,
			ttftMs: null,
			totalMs: Math.round(performance.now() - t0),
			tokPerSec: null,
			decode: {greedy: temperature === 0, temperature},
		})
		return {text, toolCalls}
	}

	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: "Bearer " + config.apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
		signal: gen.abortController.signal,
	})
	if (!res.ok) throw new Error("OpenRouter: " + (await res.text()))

	const tStart = performance.now()
	let tFirst = 0
	let full = ""
	let step = 0
	let usage = null
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buf = ""

	const handleLine = (line) => {
		if (!line.startsWith("data: ")) return
		const data = line.slice(6).trim()
		if (data === "[DONE]") return
		let parsed
		try {
			parsed = JSON.parse(data)
		} catch {
			return
		}
		if (parsed.usage) usage = parsed.usage
		const choice = parsed.choices?.[0]
		const delta = choice?.delta?.content
		if (delta) {
			if (!tFirst) tFirst = performance.now()
			full += delta
			gen.fullText = full
			post(gen, {type: "token", delta, text: full})
		}
		if (topk > 0) {
			for (const item of choice?.logprobs?.content || []) {
				if (step >= PREDICTION_CAP) break
				const candidates = (item.top_logprobs || []).map((tl) => ({
					token: tl.token,
					p: +Math.exp(tl.logprob).toFixed(4),
				}))
				if (candidates.length) post(gen, {type: "prediction", step, candidates})
				step++
			}
		}
	}

	while (true) {
		const {done, value} = await reader.read()
		if (done) break
		buf += decoder.decode(value, {stream: true})
		const lines = buf.split("\n")
		buf = lines.pop()
		for (const line of lines) handleLine(line)
	}
	if (buf.trim()) for (const line of buf.split("\n")) handleLine(line)

	const now = performance.now()
	const genTokens = usage?.completion_tokens ?? null
	post(gen, {
		type: "stats",
		provider: "openrouter",
		model: config.model,
		promptTokens: usage?.prompt_tokens ?? null,
		genTokens,
		ttftMs: tFirst ? Math.round(tFirst - tStart) : null,
		totalMs: Math.round(now - tStart),
		tokPerSec:
			tFirst && genTokens
				? +(genTokens / ((now - tFirst) / 1000)).toFixed(1)
				: null,
		decode: {greedy: temperature === 0, temperature},
	})
	return {text: full, toolCalls: null}
}

// ---------------------------------------------------------------------------
// Ollama (NDJSON) — tokens + basic stats (no logprobs available)
// ---------------------------------------------------------------------------

async function doGenerateOllama(gen, input, config) {
	const isText = typeof input === "string"
	const baseUrl = (config.url || "http://localhost:11434").replace(/\/$/, "")
	const body = {
		model: config.model || "llama3.2",
		stream: true,
		options: {
			temperature: config.temperature ?? 0.7,
			...(config.topP != null ? {top_p: config.topP} : {}),
			...(config.topK > 0 ? {top_k: config.topK} : {}),
			...(config.minP > 0 ? {min_p: config.minP} : {}),
			...(config.repetitionPenalty && config.repetitionPenalty !== 1
				? {repeat_penalty: config.repetitionPenalty}
				: {}),
			...(config.frequencyPenalty ? {frequency_penalty: config.frequencyPenalty} : {}),
			...(config.presencePenalty ? {presence_penalty: config.presencePenalty} : {}),
			...(config.seed != null && config.seed !== "" ? {seed: config.seed} : {}),
		},
	}
	if (isText) body.prompt = input
	else body.messages = input

	// Native tool calling (chat only): non-streaming, parse message.tool_calls.
	if (config.tools && config.tools.length && !isText) {
		body.tools = config.tools
		body.stream = false
		const t0 = performance.now()
		const r = await fetch(baseUrl + "/api/chat", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify(body),
			signal: gen.abortController.signal,
		})
		if (!r.ok) throw new Error("Ollama: " + (await r.text()))
		const data = await r.json()
		const text = data.message?.content || ""
		if (text) post(gen, {type: "token", delta: text, text})
		gen.fullText = text
		const toolCalls = (data.message?.tool_calls || []).map((tc, i) => ({
			id: tc.id || "call_" + i,
			name: tc.function?.name,
			args: safeJson(tc.function?.arguments), // Ollama already gives an object
		}))
		post(gen, {
			type: "stats",
			provider: "ollama",
			model: config.model,
			promptTokens: data.prompt_eval_count ?? null,
			genTokens: data.eval_count ?? null,
			ttftMs: null,
			totalMs: Math.round(performance.now() - t0),
			tokPerSec: null,
			decode: {greedy: (config.temperature ?? 0.7) === 0, temperature: config.temperature ?? 0.7},
		})
		return {text, toolCalls}
	}

	const res = await fetch(baseUrl + (isText ? "/api/generate" : "/api/chat"), {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify(body),
		signal: gen.abortController.signal,
	})
	if (!res.ok) throw new Error("Ollama: " + (await res.text()))

	const tStart = performance.now()
	let tFirst = 0
	let full = ""
	let final = null
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buf = ""
	while (true) {
		const {done, value} = await reader.read()
		if (done) break
		buf += decoder.decode(value, {stream: true})
		const lines = buf.split("\n")
		buf = lines.pop()
		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const parsed = JSON.parse(line)
				if (parsed.done) final = parsed
				const content = isText ? parsed.response : parsed.message?.content
				if (content) {
					if (!tFirst) tFirst = performance.now()
					full += content
					gen.fullText = full
					post(gen, {type: "token", delta: content, text: full})
				}
			} catch {}
		}
	}
	const now = performance.now()
	const genTokens = final?.eval_count ?? null
	post(gen, {
		type: "stats",
		provider: "ollama",
		model: config.model,
		promptTokens: final?.prompt_eval_count ?? null,
		genTokens,
		ttftMs: tFirst ? Math.round(tFirst - tStart) : null,
		totalMs: Math.round(now - tStart),
		tokPerSec:
			final?.eval_count && final?.eval_duration
				? +(final.eval_count / (final.eval_duration / 1e9)).toFixed(1)
				: null,
		decode: {temperature: config.temperature ?? 0.7},
	})
	return {text: full, toolCalls: null}
}

// ---------------------------------------------------------------------------
// Predict: a single forward pass → the next-token distribution at the cursor.
// Powers "predict as you type" without generating. Local reads the real logits;
// OpenRouter is best-effort via the /completions logprobs (chat-only models
// won't return any — the caller just sees an empty list).
// ---------------------------------------------------------------------------

async function predictLocal(text, config) {
	const topk = Math.max(1, config.topk | 0 || 10)
	const tokenizer = generator.tokenizer
	let candidates = []
	await generator(text || " ", {
		max_new_tokens: 1,
		do_sample: false,
		logits_processor: [
			(inputIds, logits) => {
				if (!candidates.length) {
					try {
						const vocab = logits.dims.at(-1)
						candidates = topkFromLogits(logits.data, vocab, topk).map(({id, p}) => ({
							token: tokenizer.decode([id]),
							p: +p.toFixed(4),
						}))
					} catch {}
				}
				return logits
			},
		],
	})
	return candidates
}

// Score every token position in the input — one forward pass per position,
// extracting exact probability (from full vocab), rank, entropy, and top-k
// alternatives. Powers the attention heatmap: "how surprised was the model
// by what you actually wrote?"
async function scoreTokensLocal(gen, text, config) {
	await ensureModel(config.model)
	const tokenizer = generator.tokenizer
	const ids = tokenizer.encode(text)
	const scores = []

	for (let i = 0; i < ids.length; i++) {
		if (gen.abortController.signal.aborted) break

		const prefix = i === 0 ? "" : tokenizer.decode(ids.slice(0, i), {skip_special_tokens: true})
		let result = null

		await generator(prefix || " ", {
			max_new_tokens: 1,
			do_sample: false,
			logits_processor: [
				(inputIds, logits) => {
					if (result) return logits // only first call matters
					const vocab = logits.dims.at(-1)
					const data = logits.data
					const actualId = ids[i]

					// Softmax (numerically stable)
					let mx = -Infinity
					for (let j = 0; j < vocab; j++) if (data[j] > mx) mx = data[j]
					let sm = 0
					for (let j = 0; j < vocab; j++) sm += Math.exp(data[j] - mx)

					// Exact probability + rank of actual next token
					const actualP = Math.exp(data[actualId] - mx) / sm
					let rank = 1
					const actualLogit = data[actualId]
					for (let j = 0; j < vocab; j++) {
						if (data[j] > actualLogit + 1e-8) rank++
					}

					// Full-distribution entropy
					let ent = 0
					for (let j = 0; j < vocab; j++) {
						const p = Math.exp(data[j] - mx) / sm
						if (p > 0) ent -= p * Math.log2(p)
					}

					// Top-k alternatives for context
					const topk = topkFromLogits(data, vocab, 10).map(({id, p}) => ({
						token: tokenizer.decode([id]),
						p: +p.toFixed(4),
					}))

					result = {
						token: tokenizer.decode([actualId]),
						p: +actualP.toFixed(6),
						rank,
						entropy: +ent.toFixed(3),
						topk,
					}
					return logits
				},
			],
		})

		if (result) scores.push(result)
		post(gen, {type: "score-progress", step: i, total: ids.length})
	}

	post(gen, {type: "token-scores", scores})
}

async function predictOpenRouter(text, config, signal) {
	const topk = Math.min(Math.max(1, config.topk | 0 || 10), 20)
	// Chat with the continuation framing (raw /completions doesn't work for
	// chat-only models); the first token's logprobs are the next-token dist.
	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: "Bearer " + config.apiKey,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			messages: config.continuation
				? [{role: "system", content: CONTINUE_SYS}, {role: "user", content: text || " "}]
				: [{role: "user", content: text || " "}],
			max_tokens: 1,
			temperature: 0,
			logprobs: true,
			top_logprobs: topk,
		}),
		signal,
	})
	if (!res.ok) throw new Error("OpenRouter predict: " + (await res.text()))
	const data = await res.json()
	const top = data.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs
	if (!top) return []
	return top
		.map((tl) => ({token: tl.token, p: +Math.exp(tl.logprob).toFixed(4)}))
		.sort((a, b) => b.p - a.p)
}

function handlePredict(port, data) {
	const {id, text, config = {}} = data
	const provider = data.provider
	const reply = (candidates) =>
		port.postMessage({type: "predictions", id, candidates})
	const failPredict = (message) => port.postMessage({type: "error", id, message})

	if (provider === "openrouter") {
		predictOpenRouter(text, config, new AbortController().signal)
			.then(reply)
			.catch((e) => failPredict(e?.message || String(e)))
		return
	}
	if (provider === "ollama") {
		reply([]) // Ollama's API exposes no logprobs
		return
	}
	if (provider === "webllm") {
		predictWebLLM(text, config)
			.then(reply)
			.catch((e) => failPredict(e?.message || String(e)))
		return
	}
	const requested = config.model || DEFAULT_MODEL_ID
	const run = () =>
		predictLocal(text, config)
			.then(reply)
			.catch((e) => failPredict(e?.message || String(e)))
	if (!generator || currentModelId !== requested) {
		if (currentModelId !== requested) generator = null
		loadModel(requested).then(() =>
			generator ? run() : failPredict("Model not loaded")
		)
	} else run()
}

// ---------------------------------------------------------------------------
// WebLLM (MLC) — WebGPU, non-ONNX, loaded from a CDN like transformers.js. We're
// already in a worker, so CreateMLCEngine runs the model right here. logprobs
// give the same per-token predictions as the rest. (Mirrors rlm's WebLLMClient.)
// ---------------------------------------------------------------------------

let webllmMod = null
let webllmEngine = null
let webllmModel = null

async function ensureWebLLM(model, custom) {
	model = model || "Qwen2.5-1.5B-Instruct-q4f16_1-MLC"
	if (!webllmMod) {
		broadcast({type: "status", message: "Loading WebLLM…"})
		webllmMod = await import(/* @vite-ignore */ "https://esm.run/@mlc-ai/web-llm")
	}
	if (webllmEngine && webllmModel === model) return
	if (webllmEngine) {
		try {
			await webllmEngine.unload?.()
		} catch {}
		webllmEngine = null
	}
	webllmModel = model
	// Merge any self-compiled MLC model records into the prebuilt list so a custom
	// model_id resolves to its weights + wasm lib. We only store {model_id,
	// model_lib}; the weights URL is the model_id's HuggingFace repo. Stored in the
	// config (not localStorage), threaded through as config.custom.
	const customList = (Array.isArray(custom) ? custom : [])
		.filter((c) => c && c.model_id && c.model_lib)
		.map((c) => ({
			...c,
			// weights URL defaults to the HF repo named by model_id (matches rlm —
			// WebLLM appends the resolve path itself, so NO /resolve/main/ suffix)
			model: c.model || "https://huggingface.co/" + c.model_id,
		}))
	const appConfig = customList.length
		? {
				...webllmMod.prebuiltAppConfig,
				model_list: [...webllmMod.prebuiltAppConfig.model_list, ...customList],
		  }
		: undefined
	webllmEngine = await webllmMod.CreateMLCEngine(model, {
		appConfig,
		initProgressCallback: (r) =>
			broadcast({
				type: "status",
				message:
					r.text ||
					"Loading… " +
						(typeof r.progress === "number" ? Math.round(r.progress * 100) + "%" : ""),
			}),
	})
	broadcast({type: "status", message: "Model ready (WebLLM)"})
	broadcast({type: "ready", model, device: "WebGPU"})
}

async function doGenerateWebLLM(gen, input, config) {
	await ensureWebLLM(config.model, config.custom)
	const isText = typeof input === "string"

	// Native tool calling (chat only): non-streaming, parse message.tool_calls.
	if (config.tools && config.tools.length && !isText) {
		const t0 = performance.now()
		const res = await webllmEngine.chat.completions.create({
			messages: input,
			tools: config.tools,
			tool_choice: "auto",
			stream: false,
			temperature: config.temperature ?? 0.7,
			...(config.topP != null ? {top_p: config.topP} : {}),
			...(config.maxNewTokens ? {max_tokens: config.maxNewTokens} : {}),
		})
		const msg = res.choices?.[0]?.message || {}
		const text = msg.content || ""
		if (text) post(gen, {type: "token", delta: text, text})
		gen.fullText = text
		const toolCalls = (msg.tool_calls || []).map((tc) => ({
			id: tc.id,
			name: tc.function?.name,
			args: safeJson(tc.function?.arguments),
		}))
		post(gen, {
			type: "stats",
			provider: "webllm",
			model: config.model,
			promptTokens: res.usage?.prompt_tokens ?? null,
			genTokens: res.usage?.completion_tokens ?? null,
			ttftMs: null,
			totalMs: Math.round(performance.now() - t0),
			tokPerSec: null,
			decode: {temperature: config.temperature ?? 0.7},
		})
		return {text, toolCalls}
	}
	const temperature = config.temperature ?? 0.7
	const topk = config.topk | 0
	const common = {
		stream: true,
		stream_options: {include_usage: true},
		temperature,
		...(config.topP != null ? {top_p: config.topP} : {}),
		...(config.frequencyPenalty ? {frequency_penalty: config.frequencyPenalty} : {}),
		...(config.presencePenalty ? {presence_penalty: config.presencePenalty} : {}),
		...(config.seed != null && config.seed !== "" ? {seed: config.seed} : {}),
		...(config.maxNewTokens ? {max_tokens: config.maxNewTokens} : {}),
		...(topk > 0 ? {logprobs: true, top_logprobs: topk} : {}),
	}
	const tStart = performance.now()
	let tFirst = 0
	let full = ""
	let usage = null
	let step = 0
	const stream = isText
		? await webllmEngine.completions.create({prompt: input, ...common})
		: await webllmEngine.chat.completions.create({messages: input, ...common})
	for await (const chunk of stream) {
		if (gen.abortController.signal.aborted) break
		if (chunk.usage) usage = chunk.usage
		const ch = chunk.choices?.[0]
		const delta = isText ? ch?.text : ch?.delta?.content
		const lp = ch?.logprobs?.content
		if (lp && topk > 0) {
			for (const e of lp) {
				if (step >= PREDICTION_CAP) break
				const candidates = (e.top_logprobs || []).map((c) => ({
					token: c.token,
					p: +Math.exp(c.logprob).toFixed(4),
				}))
				if (candidates.length) post(gen, {type: "prediction", step, candidates})
				step++
			}
		}
		if (delta) {
			if (!tFirst) tFirst = performance.now()
			full += delta
			gen.fullText = full
			post(gen, {type: "token", delta, text: full})
		}
	}
	const now = performance.now()
	const genTokens = usage?.completion_tokens ?? null
	post(gen, {
		type: "stats",
		provider: "webllm",
		model: config.model,
		promptTokens: usage?.prompt_tokens ?? null,
		genTokens,
		ttftMs: tFirst ? Math.round(tFirst - tStart) : null,
		totalMs: Math.round(now - tStart),
		tokPerSec:
			tFirst && genTokens ? +(genTokens / ((now - tFirst) / 1000)).toFixed(1) : null,
		decode: {temperature, top_p: config.topP},
	})
	return {text: full, toolCalls: null}
}

async function predictWebLLM(text, config) {
	await ensureWebLLM(config.model, config.custom)
	const topk = Math.max(1, config.topk | 0 || 10)
	const res = await webllmEngine.completions.create({
		prompt: text || " ",
		max_tokens: 1,
		temperature: 0,
		logprobs: true,
		top_logprobs: topk,
		stream: false,
	})
	const lp = res.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs
	if (!lp) return []
	return lp
		.map((c) => ({token: c.token, p: +Math.exp(c.logprob).toFixed(4)}))
		.sort((a, b) => b.p - a.p)
}

// ---------------------------------------------------------------------------
// Dispatch + lifecycle
// ---------------------------------------------------------------------------

function post(gen, msg) {
	try {
		gen.port.postMessage({...msg, id: gen.id})
	} catch {}
}

function finalize(sessionKey, gen, text, toolCalls) {
	gen.done = true
	gen.finalText = text
	try {
		gen.port.postMessage({type: "result", id: gen.id, text, toolCalls: toolCalls || null})
	} catch {}
	broadcast({type: "status", message: ""})
	if (sessionKey) setTimeout(() => activeGenerations.delete(sessionKey), 5000)
}

function fail(sessionKey, gen, message) {
	try {
		gen.port.postMessage({type: "error", id: gen.id, message})
	} catch {}
	broadcast({type: "status", message: ""})
	if (sessionKey) activeGenerations.delete(sessionKey)
}

// `input` is either chat messages (array → chat-templated) or a raw string
// (→ plain continuation, what the loom editor wants).
async function runGeneration(sessionKey, gen, provider, input, config) {
	try {
		broadcast({type: "status", message: "Thinking…"})
		let out
		if (provider === "openrouter") out = await doGenerateOpenRouter(gen, input, config)
		else if (provider === "ollama") out = await doGenerateOllama(gen, input, config)
		else if (provider === "webllm") out = await doGenerateWebLLM(gen, input, config)
		else out = await doGenerateLocal(gen, input, config)
		finalize(sessionKey, gen, out.text, out.toolCalls)
	} catch (err) {
		if (gen.abortController.signal.aborted) return
		if (gen.fullText) finalize(sessionKey, gen, gen.fullText)
		else fail(sessionKey, gen, err?.message || String(err))
	}
}

function handleMessage(port, data) {
	const {type, id} = data
	const sessionKey = data.sessionKey || id

	if (type === "list-local-models") {
		port.postMessage({type: "local-models", models: LOCAL_MODELS})
		return
	}
	if (type === "predict") {
		handlePredict(port, data)
		return
	}
	if (type === "score-tokens") {
		const {provider, config = {}} = data
		if (provider !== "local") {
			port.postMessage({type: "token-scores", id, scores: []})
			return
		}
		const gen = {id, port, fullText: "", done: false, finalText: "", abortController: new AbortController()}
		activeGenerations.set(sessionKey, gen)
		const requested = config.model || DEFAULT_MODEL_ID
		const run = () =>
			scoreTokensLocal(gen, data.text, config)
				.then(() => { gen.done = true; activeGenerations.delete(sessionKey) })
				.catch((e) => {
					if (!gen.abortController.signal.aborted)
						port.postMessage({type: "error", id, message: e?.message || String(e)})
					activeGenerations.delete(sessionKey)
				})
		if (!generator || currentModelId !== requested) {
			if (currentModelId !== requested) generator = null
			loadModel(requested).then(() => {
				if (!generator) { port.postMessage({type: "error", id, message: "Model not loaded"}); return }
				run()
			})
		} else run()
		return
	}
	if (type === "register-local-model") {
		const files = new Map((data.files || []).map((f) => [f.path, f.blob]))
		localModelFiles.set(data.id, {files, dtype: data.dtype || "q4f16"})
		ensureLocalFetchPatch()
		if (currentModelId === data.id) generator = null // force a reload
		port.postMessage({type: "local-model-registered", id: data.id, count: files.size})
		return
	}
	if (type === "preload") {
		if (data.provider === "local") {
			if (!generator && !loading) loadModel(data.config?.model)
			if (generator) port.postMessage({type: "ready"})
		} else port.postMessage({type: "ready"})
		return
	}
	if (type === "resume") {
		const key = data.sessionKey
		const gen = activeGenerations.get(key)
		if (gen && !gen.done) {
			gen.port = port // re-point the live stream at the reconnecting tab
			port.postMessage({type: "resumed", id: gen.id, sessionKey: key, text: gen.fullText})
		} else if (gen && gen.done) {
			port.postMessage({type: "resume-result", id: gen.id, sessionKey: key, text: gen.finalText})
			activeGenerations.delete(key)
		} else port.postMessage({type: "no-active-generation", sessionKey: key})
		return
	}
	if (type === "abort") {
		const gen = activeGenerations.get(data.sessionKey)
		if (gen && !gen.done) {
			gen.abortController.abort()
			activeGenerations.delete(data.sessionKey)
		}
		return
	}
	if (type === "generate") {
		const {provider, config = {}} = data
		const input = data.text != null ? data.text : data.messages
		const gen = {
			id,
			port,
			fullText: "",
			done: false,
			finalText: "",
			abortController: new AbortController(),
		}
		activeGenerations.set(sessionKey, gen)
		if (provider === "local") {
			const requested = config.model || DEFAULT_MODEL_ID
			if (!generator || currentModelId !== requested) {
				if (currentModelId !== requested) generator = null
				loadModel(requested).then(() => {
					if (!generator) return fail(sessionKey, gen, "Model not loaded")
					runGeneration(sessionKey, gen, provider, input, config)
				})
			} else runGeneration(sessionKey, gen, provider, input, config)
		} else {
			runGeneration(sessionKey, gen, provider, input, config)
		}
	}
}

// SharedWorker entry — one port per connecting tab.
self.onconnect = (e) => {
	const port = e.ports[0]
	ports.add(port)
	port.onmessage = (ev) => handleMessage(port, ev.data)
	if (generator) port.postMessage({type: "ready"})
	port.start()
}

// Dedicated-Worker fallback (browsers without module SharedWorker, e.g. Safari):
// treat `self` as the single port. `self.postMessage` reaches the main thread.
if (typeof SharedWorkerGlobalScope === "undefined") {
	ports.add(self)
	self.onmessage = (ev) => handleMessage(self, ev.data)
}
