/**
 * LLM Worker
 *
 * Loads Phi-3.5-mini-instruct via transformers.js with WebGPU (fallback WASM).
 *
 * Messages IN:
 *   { type: "generate", id, messages, options? }
 *
 * Messages OUT:
 *   { type: "result", id, text }
 *   { type: "error", id, message }
 *   { type: "status", message }
 *   { type: "ready" }
 */

// Global error handlers so crashes are reported back
self.addEventListener("error", (e) => {
  const msg = e.message || "Unknown worker error";
  const loc = e.filename ? ` at ${e.filename}:${e.lineno}:${e.colno}` : "";
  console.error("[llm-worker] Uncaught error:", msg + loc, e.error);
  self.postMessage({ type: "status", message: "Worker error: " + msg + loc });
});

self.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message || e.reason || "Unhandled rejection";
  console.error("[llm-worker] Unhandled rejection:", msg, e.reason);
  self.postMessage({ type: "status", message: "Worker error: " + msg });
});

console.log("[llm-worker] Script starting...");

const MODEL_ID = "onnx-community/Phi-3.5-mini-instruct-onnx-web";
let pipelineFn = null;
let generator = null;
let loading = false;

// Race a promise against a timeout
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + " timed out after " + (ms / 1000) + "s")), ms)
    ),
  ]);
}

async function loadModel() {
  if (generator || loading) return;
  loading = true;

  // Dynamic import of transformers.js
  try {
    console.log("[llm-worker] Importing transformers.js...");
    self.postMessage({ type: "status", message: "Loading transformers.js…" });
    const mod = await import(
      "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3"
    );
    pipelineFn = mod.pipeline;
    mod.env.allowLocalModels = false;
    // Enable caching of downloaded models and compiled shaders
    mod.env.useBrowserCache = true;
    const cacheAvailable = typeof caches !== "undefined";
    console.log("[llm-worker] transformers.js loaded, cache API available:", cacheAvailable, "useBrowserCache:", mod.env.useBrowserCache);
    if (!cacheAvailable) {
      self.postMessage({ type: "status", message: "Warning: Cache API unavailable — model will re-download each time" });
    }
  } catch (err) {
    const msg = "Failed to load transformers.js: " + (err.message || err);
    console.error("[llm-worker]", msg, err);
    self.postMessage({ type: "status", message: msg });
    self.postMessage({ type: "error", id: null, message: msg });
    loading = false;
    return;
  }

  const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;
  console.log("[llm-worker] WebGPU:", hasWebGPU);

  const onProgress = (p) => {
    if (p.status === "progress" && p.progress != null) {
      self.postMessage({
        type: "status",
        message: `Downloading model… ${Math.round(p.progress)}%`,
      });
    } else if (p.status === "done") {
      console.log("[llm-worker] done:", p.file || "");
    } else if (p.status === "initiate") {
      console.log("[llm-worker] initiate:", p.file || "");
      self.postMessage({ type: "status", message: "Initializing " + (p.file || "model") + "…" });
    } else if (p.status) {
      console.log("[llm-worker] progress:", p.status, p.file || "");
    }
  };

  if (hasWebGPU) {
    self.postMessage({ type: "status", message: "Loading LLM (WebGPU)…" });
    try {
      console.log("[llm-worker] Creating WebGPU pipeline (90s timeout)...");
      self.postMessage({ type: "status", message: "Compiling model for WebGPU… (this can take a minute)" });
      generator = await withTimeout(
        pipelineFn("text-generation", MODEL_ID, {
          dtype: "q4f16",
          device: "webgpu",
          progress_callback: onProgress,
        }),
        90000,
        "WebGPU pipeline"
      );
      console.log("[llm-worker] WebGPU ready");
      self.postMessage({ type: "status", message: "Model ready (WebGPU)" });
      self.postMessage({ type: "ready" });
      loading = false;
      return;
    } catch (err) {
      console.warn("[llm-worker] WebGPU failed:", err.message || err);
      self.postMessage({ type: "status", message: "WebGPU failed: " + (err.message || err) + " — trying WASM…" });
    }
  } else {
    self.postMessage({ type: "status", message: "Loading LLM (WASM)…" });
  }

  try {
    console.log("[llm-worker] Creating WASM pipeline...");
    self.postMessage({ type: "status", message: "Compiling model for WASM…" });
    generator = await withTimeout(
      pipelineFn("text-generation", MODEL_ID, {
        dtype: "q4",
        progress_callback: onProgress,
      }),
      120000,
      "WASM pipeline"
    );
    console.log("[llm-worker] WASM ready");
    self.postMessage({ type: "status", message: "Model ready (WASM)" });
    self.postMessage({ type: "ready" });
  } catch (err) {
    const msg = "Model load failed: " + (err.message || err);
    console.error("[llm-worker]", msg, err);
    self.postMessage({ type: "status", message: msg });
    self.postMessage({ type: "error", id: null, message: msg });
  } finally {
    loading = false;
  }
}

self.onmessage = async (ev) => {
  const { type, id, messages } = ev.data;
  console.log("[llm-worker] Received:", type, id || "");

  if (type === "preload") {
    if (!generator && !loading) {
      console.log("[llm-worker] Preloading model...");
      await loadModel();
    }
    return;
  }

  if (type === "generate") {
    if (!generator) {
      console.log("[llm-worker] No generator, loading model...");
      await loadModel();
      if (!generator) {
        self.postMessage({ type: "error", id, message: "Model not loaded" });
        return;
      }
    }

    try {
      self.postMessage({ type: "status", message: "Thinking…" });
      const t0 = Date.now();
      let tokenCount = 0;
      const output = await generator(messages, {
        do_sample: true,
        temperature: 0.7,
        repetition_penalty: 1.1,
        callback_function: (output) => {
          tokenCount++;
          // Send partial tokens every few tokens to avoid overwhelming
          if (tokenCount % 3 === 0 || tokenCount < 5) {
            try {
              const partial = generator.tokenizer.decode(output[0].output_token_ids, { skip_special_tokens: true });
              self.postMessage({ type: "token", id, text: partial });
            } catch {}
          }
        },
      });
      console.log("[llm-worker] Generated in", Date.now() - t0, "ms");
      const text = output[0].generated_text.at(-1).content;
      self.postMessage({ type: "result", id, text });
      self.postMessage({ type: "status", message: "" });
    } catch (err) {
      const msg = err.message || String(err);
      console.error("[llm-worker] Generation error:", err);
      self.postMessage({ type: "error", id, message: msg });
      self.postMessage({ type: "status", message: "" });
    }
  }
};

console.log("[llm-worker] Waiting for messages...");
