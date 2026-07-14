/**
 * Compilation backend: real TeX Live 2025 in WASM (Siglum / busytex),
 * loaded lazily from CDN so the tool bundle stays light and vite never
 * sees the WASM.
 *
 * Unlike V1 there is no latex.js HTML path — the preview, the download,
 * and every connected output document all flow from the same compiled
 * PDF. This is the only way to support arbitrary LaTeX (packages, fonts,
 * TikZ, bibliographies) at full fidelity.
 *
 * PDF compilation requires SharedArrayBuffer, which the browser only
 * exposes on a cross-origin-isolated page (COOP + COEP headers). The
 * current Patchwork host (sub.patchwork.inkandswitch.com) sets these, so
 * the engine runs; `pdfSupported()` gates the UI for anywhere that
 * doesn't (e.g. older Safari without COEP:credentialless).
 */

import type { SiglumCompiler as SiglumCompilerType } from "@siglum/engine";

// ─── Siglum (PDF) ────────────────────────────────────────────────────────────

const SIGLUM_VERSION = "0.1.4";
const SIGLUM_TEXLIVE_URL = "https://cdn.siglum.org/tl2025";
const SIGLUM_MODULE_URL = `https://esm.sh/@siglum/engine@${SIGLUM_VERSION}`;
const SIGLUM_WORKER_URL = `https://cdn.jsdelivr.net/npm/@siglum/engine@${SIGLUM_VERSION}/src/worker.js`;

/**
 * CTAN proxy endpoint. When set, packages outside Siglum's pre-bundled
 * set (amsmath, tikz, biblatex, …) are fetched from CTAN / TeX Live on
 * demand during compilation and cached in the browser. Empty string =
 * pre-bundled packages only. Fill this in once a proxy is hosted (see the
 * CTAN proxy notes).
 */
export const CTAN_PROXY_URL = "";

/**
 * The PDF engine needs SharedArrayBuffer, which is only available when the
 * page is cross-origin isolated. `crossOriginIsolated` is the correct
 * signal; fall back to a constructor check on browsers that predate it.
 */
export function pdfSupported(): boolean {
  if (typeof globalThis !== "undefined" && "crossOriginIsolated" in globalThis) {
    return globalThis.crossOriginIsolated === true;
  }
  return typeof SharedArrayBuffer !== "undefined";
}

// ─── progress fanout ─────────────────────────────────────────────────────────
// The compiler is a process-wide singleton created once, so its progress
// callback can't close over a single component. Listeners subscribe here
// instead and the constructor's callback fans out to all of them.

type ProgressListener = (stage: string, detail: string) => void;
const progressListeners = new Set<ProgressListener>();

export function onCompilerProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emitProgress(stage: string, detail: string) {
  for (const l of progressListeners) l(stage, detail);
}

// ─── log capture ─────────────────────────────────────────────────────────────
// The engine reports TeX errors and worker status through `onLog` even when
// `verbose` is off. We keep a bounded buffer of the most recent lines so the
// log drawer has something to show even when a failure produces no `.log`.

const LOG_MAX = 800;
let logLines: string[] = [];

function pushLog(line: string) {
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
}

function resetLog() {
  logLines = [];
}

function capturedLog(): string {
  return logLines.join("\n").trim();
}

// ─── compiler lifecycle ──────────────────────────────────────────────────────

async function fetchWorkerBlobUrl(): Promise<string> {
  const resp = await fetch(SIGLUM_WORKER_URL);
  const text = await resp.text();
  const blob = new Blob([text], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

let compilerInstance: SiglumCompilerType | null = null;
let compilerInitPromise: Promise<SiglumCompilerType> | null = null;

async function buildCompiler(): Promise<SiglumCompilerType> {
  const [{ SiglumCompiler }, workerUrl] = await Promise.all([
    import(/* @vite-ignore */ SIGLUM_MODULE_URL) as Promise<
      typeof import("@siglum/engine")
    >,
    fetchWorkerBlobUrl(),
  ]);

  const compiler = new SiglumCompiler({
    bundlesUrl: `${SIGLUM_TEXLIVE_URL}/bundles`,
    wasmUrl: `${SIGLUM_TEXLIVE_URL}/busytex.wasm`,
    workerUrl,
    ...(CTAN_PROXY_URL ? { ctanProxyUrl: CTAN_PROXY_URL } : {}),
    onProgress: emitProgress,
    onLog: pushLog,
    verbose: false,
  });

  await compiler.init();
  compilerInstance = compiler;
  return compiler;
}

export async function getOrCreateCompiler(): Promise<SiglumCompilerType> {
  if (compilerInstance?.isReady()) return compilerInstance;
  if (!compilerInitPromise) {
    compilerInitPromise = buildCompiler();
    // Let a failed init be retried on the next call rather than caching it.
    compilerInitPromise.catch(() => {
      compilerInitPromise = null;
    });
  }
  return compilerInitPromise;
}

/**
 * Kick off engine download + format load in the background so the first
 * real compile is fast. Fire-and-forget; safe to call on mount.
 */
export function prewarmCompiler(): void {
  if (!pdfSupported()) return;
  void getOrCreateCompiler().catch(() => {
    /* surfaced on the next real compile */
  });
}

// ─── compilation ─────────────────────────────────────────────────────────────

export type PdfResult =
  | {
      ok: true;
      bytes: Uint8Array;
      syncTex: string | null;
      log: string | null;
      cached: boolean;
    }
  | { ok: false; error: string; log: string | null };

export async function compileLatexToPdf(
  content: string,
  onProgress?: (message: string) => void
): Promise<PdfResult> {
  try {
    if (!pdfSupported()) {
      return {
        ok: false,
        error:
          "This browser/host can't run the TeX engine — it needs cross-origin isolation (SharedArrayBuffer).",
        log: null,
      };
    }
    onProgress?.("Loading TeX engine…");
    const compiler = await getOrCreateCompiler();
    onProgress?.("Compiling…");
    resetLog();
    // No `engine` option: Siglum auto-detects (pdflatex, or xelatex when it
    // sees fontspec/unicode-math). Passing "auto" would be taken as a literal
    // engine name and fail.
    const result = await compiler.compile(content);
    const captured = capturedLog();

    if (result.success && result.pdf) {
      // Copy into a plain ArrayBuffer so Blob/pdf.js accept it (the source
      // may be a view onto WASM/shared memory).
      const buf = new ArrayBuffer(result.pdf.byteLength);
      new Uint8Array(buf).set(result.pdf);
      return {
        ok: true,
        bytes: new Uint8Array(buf),
        syncTex:
          typeof result.syncTexData === "string" ? result.syncTexData : null,
        log: result.log || captured || null,
        cached: result.cached === true,
      };
    }

    return {
      ok: false,
      error:
        result.error ||
        extractTexError(result.log || captured) ||
        "Compilation failed",
      log: result.log || captured || null,
    };
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "PDF compilation failed";
    return { ok: false, error, log: null };
  }
}

/**
 * Pull a concise human error out of a TeX log: the first `! …` message and
 * the `l.<n>` line it points at, if present.
 */
export function extractTexError(log?: string | null): string {
  if (!log) return "";
  const lines = log.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("! ")) {
      const message = line.slice(2).trim();
      // The line locator usually shows up a couple of lines later.
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const loc = lines[j].match(/^l\.(\d+)/);
        if (loc) return `Line ${loc[1]}: ${message}`;
      }
      return message;
    }
  }
  return "";
}

// ─── shared helpers ──────────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
