/**
 * LLM SharedWorker
 *
 * Handles all LLM generation (local, OpenRouter, Ollama) so streaming
 * survives page refreshes. Shared across tabs of the same chat.
 *
 * Messages IN:
 *   { type: "generate", id, chatUrl, provider, messages, config }
 *     provider: "local" | "openrouter" | "ollama"
 *     config: { apiKey, model, url } (provider-specific)
 *   { type: "preload" }
 *   { type: "resume", chatUrl }
 *
 * Messages OUT:
 *   { type: "result", id, text }
 *   { type: "error", id, message }
 *   { type: "status", message }
 *   { type: "ready" }
 *   { type: "token", id, text }
 *   { type: "resumed", id, text }
 *   { type: "resume-result", id, text }
 *   { type: "no-active-generation" }
 */

const ports = new Set()

function broadcast(msg) {
  for (const port of ports) {
    try { port.postMessage(msg) } catch {}
  }
}

// Track active generations: chatUrl -> { id, port, fullText, done, finalText, abort? }
const activeGenerations = new Map()

// Global error handlers
self.addEventListener("error", (e) => {
  const msg = e.message || "Unknown worker error"
  const loc = e.filename ? ` at ${e.filename}:${e.lineno}:${e.colno}` : ""
  console.error("[llm-worker] Uncaught error:", msg + loc, e.error)
  broadcast({ type: "status", message: "Worker error: " + msg + loc })
})

self.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || e.reason || "Unhandled rejection"
  console.error("[llm-worker] Unhandled rejection:", msg, e.reason)
  broadcast({ type: "status", message: "Worker error: " + msg })
})

console.log("[llm-worker] SharedWorker starting...")

// ---- Local models ----
const LOCAL_MODELS = [
  { id: "onnx-community/Qwen3-4B-ONNX", name: "Qwen3 4B (best)", dtype: "q4f16" },
  { id: "onnx-community/Qwen3-1.7B-ONNX", name: "Qwen3 1.7B", dtype: "q4f16" },
  { id: "onnx-community/Qwen3-0.6B-ONNX", name: "Qwen3 0.6B (fast)", dtype: "q4f16" },
  { id: "onnx-community/Llama-3.2-1B-Instruct-ONNX", name: "Llama 3.2 1B", dtype: "q4f16" },
  { id: "onnx-community/Phi-3.5-mini-instruct-onnx-web", name: "Phi 3.5 Mini", dtype: "q4f16" },
  { id: "onnx-community/SmolLM2-1.7B-Instruct-ONNX", name: "SmolLM2 1.7B", dtype: "q4f16" },
]
const DEFAULT_MODEL_ID = LOCAL_MODELS[1].id

let currentModelId = DEFAULT_MODEL_ID
let pipelineFn = null
let generator = null
let loading = false
let loadingPromise = null // resolves when current load completes
// Track which models have been compiled this session (browser caches shaders between sessions)
const compiledModels = new Set()

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + " timed out after " + (ms / 1000) + "s")), ms)
    ),
  ])
}

async function loadModel(modelId) {
  modelId = modelId || DEFAULT_MODEL_ID
  // If we already have a different model loaded, unload it
  if (generator && currentModelId !== modelId) {
    generator = null
  }
  if (generator) return
  // If already loading, wait for the existing load to finish
  if (loading && loadingPromise) return loadingPromise
  currentModelId = modelId
  loading = true
  let resolveLoading
  loadingPromise = new Promise(r => { resolveLoading = r })
  const modelDef = LOCAL_MODELS.find(m => m.id === modelId) || { dtype: "q4f16" }

  try {
    console.log("[llm-worker] Importing transformers.js...")
    broadcast({ type: "status", message: "Loading transformers.js…" })
    const mod = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3")
    pipelineFn = mod.pipeline
    mod.env.allowLocalModels = false
    mod.env.useBrowserCache = true
    console.log("[llm-worker] transformers.js loaded, cache:", typeof caches !== "undefined")
  } catch (err) {
    console.error("[llm-worker] Failed to load transformers.js:", err.message || err)
    // Don't broadcast — this only matters for local provider
    loading = false
    loadingPromise = null
    resolveLoading()
    return
  }

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu

  if (hasWebGPU) {
    try {
      const isFirstCompile = !compiledModels.has(modelId)
      let compilePhase = false
      let compileStart = 0
      let compileTimer = null

      // Show elapsed time during shader compilation so users know it's alive
      function startCompileTimer() {
        compilePhase = true
        compileStart = Date.now()
        const prefix = isFirstCompile
          ? "⚠️ Compiling shaders for WebGPU (first time — might freeze for a bit)"
          : "Compiling shaders for WebGPU"
        broadcast({ type: "status", message: prefix + "…" })
        compileTimer = setInterval(() => {
          const elapsed = Math.round((Date.now() - compileStart) / 1000)
          broadcast({ type: "status", message: `${prefix}… ${elapsed}s` })
        }, 2000)
      }

      function stopCompileTimer() {
        compilePhase = false
        if (compileTimer) { clearInterval(compileTimer); compileTimer = null }
      }

      generator = await withTimeout(
        pipelineFn("text-generation", modelId, {
          dtype: modelDef.dtype, device: "webgpu",
          progress_callback: (p) => {
            if (p.status === "progress" && p.progress != null) {
              stopCompileTimer()
              broadcast({ type: "status", message: `Downloading model… ${Math.round(p.progress)}%` })
            } else if (p.status === "initiate") {
              stopCompileTimer()
              broadcast({ type: "status", message: "Initializing " + (p.file || "model") + "…" })
            } else if (p.status === "done" && !compilePhase) {
              // Download/init finished — compilation phase starts
              startCompileTimer()
            }
          },
        }),
        180000, "WebGPU pipeline"
      )
      stopCompileTimer()
      compiledModels.add(modelId)
      broadcast({ type: "status", message: "Model ready (WebGPU)" })
      broadcast({ type: "ready" })
      loading = false
      loadingPromise = null
      resolveLoading()
      return
    } catch (err) {
      console.warn("[llm-worker] WebGPU failed:", err.message || err)
      broadcast({ type: "status", message: "WebGPU failed — trying WASM…" })
    }
  }

  try {
    const isFirstCompile = !compiledModels.has(modelId)
    let compilePhase = false
    let compileStart = 0
    let compileTimer = null

    function startCompileTimer() {
      compilePhase = true
      compileStart = Date.now()
      const prefix = isFirstCompile
        ? "⚠️ Compiling model for WASM (first time — might freeze for a bit)"
        : "Compiling model for WASM"
      broadcast({ type: "status", message: prefix + "…" })
      compileTimer = setInterval(() => {
        const elapsed = Math.round((Date.now() - compileStart) / 1000)
        broadcast({ type: "status", message: `${prefix}… ${elapsed}s` })
      }, 2000)
    }

    function stopCompileTimer() {
      compilePhase = false
      if (compileTimer) { clearInterval(compileTimer); compileTimer = null }
    }

    generator = await withTimeout(
      pipelineFn("text-generation", modelId, {
        dtype: modelDef.dtype,
        progress_callback: (p) => {
          if (p.status === "progress" && p.progress != null) {
            stopCompileTimer()
            broadcast({ type: "status", message: `Downloading model… ${Math.round(p.progress)}%` })
          } else if (p.status === "initiate") {
            stopCompileTimer()
            broadcast({ type: "status", message: "Initializing " + (p.file || "model") + "…" })
          } else if (p.status === "done" && !compilePhase) {
            startCompileTimer()
          }
        },
      }),
      180000, "WASM pipeline"
    )
    stopCompileTimer()
    compiledModels.add(modelId)
    broadcast({ type: "status", message: "Model ready (WASM)" })
    broadcast({ type: "ready" })
  } catch (err) {
    console.error("[llm-worker] Model load failed:", err.message || err)
    // Don't broadcast — this only matters for local provider
  } finally {
    loading = false
    loadingPromise = null
    resolveLoading()
  }
}

// ---- Message handling ----

function handleMessage(port, data) {
  const { type, id, chatUrl } = data
  console.log("[llm-worker] Received:", type, id || "", chatUrl || "")

  if (type === "list-local-models") {
    port.postMessage({ type: "local-models", models: LOCAL_MODELS })
    return
  }

  if (type === "preload") {
    // Only preload local model if explicitly requested
    if (data.provider === "local") {
      if (!generator && !loading) loadModel(data.config?.model)
      if (generator) port.postMessage({ type: "ready" })
    } else {
      // Non-local providers are always ready
      port.postMessage({ type: "ready" })
    }
    return
  }

  if (type === "resume") {
    const gen = activeGenerations.get(chatUrl)
    if (gen && !gen.done) {
      console.log("[llm-worker] Resuming generation for", chatUrl)
      gen.port = port
      port.postMessage({ type: "resumed", id: gen.id, text: gen.fullText })
    } else if (gen && gen.done) {
      console.log("[llm-worker] Generation already done for", chatUrl)
      port.postMessage({ type: "resume-result", id: gen.id, text: gen.finalText })
      activeGenerations.delete(chatUrl)
    } else {
      port.postMessage({ type: "no-active-generation" })
    }
    return
  }

  if (type === "abort") {
    const gen = activeGenerations.get(chatUrl)
    if (gen && !gen.done && gen.abortController) {
      console.log("[llm-worker] Aborting generation for", chatUrl)
      gen.abortController.abort()
      activeGenerations.delete(chatUrl)
    }
    return
  }

  if (type === "generate") {
    const { provider, messages, config } = data
    const gen = { id, port, fullText: "", done: false, finalText: "", abortController: new AbortController() }
    activeGenerations.set(chatUrl, gen)

    if (provider === "openrouter") {
      doGenerateOpenRouter(chatUrl, gen, messages, config)
    } else if (provider === "ollama") {
      doGenerateOllama(chatUrl, gen, messages, config)
    } else {
      // local
      const requestedModel = config?.model || DEFAULT_MODEL_ID
      const needsReload = !generator || currentModelId !== requestedModel
      if (needsReload) {
        if (currentModelId !== requestedModel) generator = null
        loadModel(requestedModel).then(() => {
          if (!generator) {
            port.postMessage({ type: "error", id, message: "Model not loaded" })
            activeGenerations.delete(chatUrl)
            return
          }
          doGenerateLocal(chatUrl, gen, messages)
        })
      } else {
        doGenerateLocal(chatUrl, gen, messages)
      }
    }
  }
}

// ---- Local generation ----

async function doGenerateLocal(chatUrl, gen, messages) {
  try {
    broadcast({ type: "status", message: "Thinking…" })
    let tokenCount = 0
    const output = await generator(messages, {
      do_sample: true,
      temperature: 0.7,
      repetition_penalty: 1.1,
      callback_function: (output) => {
        tokenCount++
        if (tokenCount % 3 === 0 || tokenCount < 5) {
          try {
            const partial = generator.tokenizer.decode(output[0].output_token_ids, { skip_special_tokens: true })
            const stripped = stripThinkTags(partial)
            gen.fullText = stripped
            if (stripped) {
              try { gen.port.postMessage({ type: "token", id: gen.id, text: stripped }) } catch {}
            }
          } catch {}
        }
      },
    })
    const text = output[0].generated_text.at(-1).content
    finalize(chatUrl, gen, text)
  } catch (err) {
    error(chatUrl, gen, err.message || String(err))
  }
}

// ---- OpenRouter generation (SSE streaming) ----

async function doGenerateOpenRouter(chatUrl, gen, messages, config) {
  try {
    broadcast({ type: "status", message: "Thinking…" })
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model || "anthropic/claude-sonnet-4",
        messages,
        stream: true,
        max_tokens: 128000,
      }),
      signal: gen.abortController.signal,
    })
    if (!res.ok) throw new Error("OpenRouter: " + (await res.text()))

    let full = ""
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            gen.fullText = full
            try { gen.port.postMessage({ type: "token", id: gen.id, text: full }) } catch {}
          }
        } catch {}
      }
    }
    // Flush remaining buffer
    if (buf.trim()) {
      for (const line of buf.split("\n")) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            gen.fullText = full
            try { gen.port.postMessage({ type: "token", id: gen.id, text: full }) } catch {}
          }
        } catch {}
      }
    }
    finalize(chatUrl, gen, full)
  } catch (err) {
    if (gen.abortController.signal.aborted) return
    // If we already got partial text, finalize with it instead of erroring
    if (gen.fullText) {
      console.warn("[llm-worker] OpenRouter stream error, finalizing with partial text:", err.message)
      finalize(chatUrl, gen, gen.fullText)
    } else {
      error(chatUrl, gen, err.message || String(err))
    }
  }
}

// ---- Ollama generation (NDJSON streaming) ----

async function doGenerateOllama(chatUrl, gen, messages, config) {
  try {
    broadcast({ type: "status", message: "Thinking…" })
    const baseUrl = config.url || "http://localhost:11434"
    const res = await fetch(baseUrl + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model || "llama3.2",
        messages,
        stream: true,
      }),
      signal: gen.abortController.signal,
    })
    if (!res.ok) throw new Error("Ollama: " + (await res.text()))

    let full = ""
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          const content = parsed.message?.content
          if (content) {
            full += content
            gen.fullText = full
            try { gen.port.postMessage({ type: "token", id: gen.id, text: full }) } catch {}
          }
        } catch {}
      }
    }
    finalize(chatUrl, gen, full)
  } catch (err) {
    if (gen.abortController.signal.aborted) return
    if (gen.fullText) {
      console.warn("[llm-worker] Ollama stream error, finalizing with partial text:", err.message)
      finalize(chatUrl, gen, gen.fullText)
    } else {
      error(chatUrl, gen, err.message || String(err))
    }
  }
}

// ---- Strip Qwen3 <think> blocks ----

function stripThinkTags(text) {
  if (!text) return text
  // Remove complete <think>...</think> blocks (including across newlines)
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "")
  // Remove unclosed <think> at the start (model still "thinking")
  text = text.replace(/^<think>[\s\S]*$/, "")
  return text.trim()
}

// ---- Shared finalization ----

function finalize(chatUrl, gen, text) {
  text = stripThinkTags(text)
  console.log("[llm-worker] Generation complete, length:", text.length)
  gen.done = true
  gen.finalText = text
  try { gen.port.postMessage({ type: "result", id: gen.id, text }) } catch {}
  broadcast({ type: "status", message: "" })
  setTimeout(() => activeGenerations.delete(chatUrl), 5000)
}

function error(chatUrl, gen, msg) {
  console.error("[llm-worker] Generation error:", msg)
  try { gen.port.postMessage({ type: "error", id: gen.id, message: msg }) } catch {}
  broadcast({ type: "status", message: "" })
  activeGenerations.delete(chatUrl)
}

// ---- SharedWorker connection handling ----

self.onconnect = (e) => {
  const port = e.ports[0]
  ports.add(port)
  console.log("[llm-worker] Client connected, total:", ports.size)
  port.onmessage = (ev) => handleMessage(port, ev.data)
  if (generator) port.postMessage({ type: "ready" })
  port.start()
}

console.log("[llm-worker] Waiting for connections...")
