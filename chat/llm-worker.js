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

// ---- Local model (Phi-3.5) ----
const MODEL_ID = "onnx-community/Phi-3.5-mini-instruct-onnx-web"
let pipelineFn = null
let generator = null
let loading = false

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + " timed out after " + (ms / 1000) + "s")), ms)
    ),
  ])
}

async function loadModel() {
  if (generator || loading) return
  loading = true

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
    return
  }

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu

  if (hasWebGPU) {
    try {
      broadcast({ type: "status", message: "Compiling model for WebGPU… (this can take a minute)" })
      generator = await withTimeout(
        pipelineFn("text-generation", MODEL_ID, {
          dtype: "q4f16", device: "webgpu",
          progress_callback: (p) => {
            if (p.status === "progress" && p.progress != null)
              broadcast({ type: "status", message: `Downloading model… ${Math.round(p.progress)}%` })
            else if (p.status === "initiate")
              broadcast({ type: "status", message: "Initializing " + (p.file || "model") + "…" })
          },
        }),
        90000, "WebGPU pipeline"
      )
      broadcast({ type: "status", message: "Model ready (WebGPU)" })
      broadcast({ type: "ready" })
      loading = false
      return
    } catch (err) {
      console.warn("[llm-worker] WebGPU failed:", err.message || err)
      broadcast({ type: "status", message: "WebGPU failed — trying WASM…" })
    }
  }

  try {
    broadcast({ type: "status", message: "Compiling model for WASM…" })
    generator = await withTimeout(
      pipelineFn("text-generation", MODEL_ID, {
        dtype: "q4f16",
        progress_callback: (p) => {
          if (p.status === "progress" && p.progress != null)
            broadcast({ type: "status", message: `Downloading model… ${Math.round(p.progress)}%` })
          else if (p.status === "initiate")
            broadcast({ type: "status", message: "Initializing " + (p.file || "model") + "…" })
        },
      }),
      120000, "WASM pipeline"
    )
    broadcast({ type: "status", message: "Model ready (WASM)" })
    broadcast({ type: "ready" })
  } catch (err) {
    console.error("[llm-worker] Model load failed:", err.message || err)
    // Don't broadcast — this only matters for local provider
  } finally {
    loading = false
  }
}

// ---- Message handling ----

function handleMessage(port, data) {
  const { type, id, chatUrl } = data
  console.log("[llm-worker] Received:", type, id || "", chatUrl || "")

  if (type === "preload") {
    // Only preload local model if explicitly requested
    if (data.provider === "local") {
      if (!generator && !loading) loadModel()
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
      if (!generator) {
        loadModel().then(() => {
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
            gen.fullText = partial
            try { gen.port.postMessage({ type: "token", id: gen.id, text: partial }) } catch {}
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

// ---- Shared finalization ----

function finalize(chatUrl, gen, text) {
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
