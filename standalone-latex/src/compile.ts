/**
 * The two compilation backends:
 *
 *  - latex.js  → HTML   (fast, in-process; drives the live preview and
 *                        everything written to connected output documents)
 *  - Siglum    → PDF    (real TeX Live in WASM; loaded lazily from CDN so
 *                        the tool bundle stays light and vite never sees
 *                        the WASM)
 */

import type { SiglumCompiler as SiglumCompilerType } from "@siglum/engine";
import type { HtmlGenerator as HtmlGeneratorType } from "latex.js";

// ─── latex.js (HTML) ─────────────────────────────────────────────────────────

const LATEXJS_BASE_URL = "https://cdn.jsdelivr.net/npm/latex.js/dist/";

type LatexJsModule = typeof import("latex.js");
let latexjsModule: LatexJsModule | null = null;

export async function loadLatexJs(): Promise<LatexJsModule> {
  if (latexjsModule) return latexjsModule;
  latexjsModule = await import("latex.js");
  return latexjsModule;
}

export type HtmlResult =
  | { ok: true; html: string }
  | { ok: false; error: string };

/** Render LaTeX source to a standalone HTML document string. */
export function renderLatexToHtml(
  content: string,
  mod: LatexJsModule
): HtmlResult {
  try {
    const generator = new mod.HtmlGenerator({ hyphenate: false });
    const parsed = mod.parse(content, { generator }) as HtmlGeneratorType;
    const htmlDoc = parsed.htmlDocument(LATEXJS_BASE_URL);
    return {
      ok: true,
      html: "<!DOCTYPE html>\n" + htmlDoc.documentElement.outerHTML,
    };
  } catch (e: any) {
    const error = e?.location
      ? `Line ${e.location.start.line}, Col ${e.location.start.column}: ${e.message}`
      : e?.message || "Failed to render LaTeX";
    return { ok: false, error };
  }
}

// ─── Siglum (PDF) ────────────────────────────────────────────────────────────

const SIGLUM_VERSION = "0.1.4";
const SIGLUM_TEXLIVE_URL = "https://cdn.siglum.org/tl2025";
const SIGLUM_MODULE_URL = `https://esm.sh/@siglum/engine@${SIGLUM_VERSION}`;
const SIGLUM_WORKER_URL = `https://cdn.jsdelivr.net/npm/@siglum/engine@${SIGLUM_VERSION}/src/worker.js`;

async function fetchWorkerBlobUrl(): Promise<string> {
  const resp = await fetch(SIGLUM_WORKER_URL);
  const text = await resp.text();
  const blob = new Blob([text], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

let compilerInstance: SiglumCompilerType | null = null;

export function pdfSupported(): boolean {
  return typeof SharedArrayBuffer !== "undefined";
}

export async function getOrCreateCompiler(
  onProgress?: (stage: string, detail: string) => void
): Promise<SiglumCompilerType> {
  if (compilerInstance?.isReady()) return compilerInstance;

  if (compilerInstance) {
    await compilerInstance.init();
    return compilerInstance;
  }

  const [{ SiglumCompiler }, workerUrl] = await Promise.all([
    import(/* @vite-ignore */ SIGLUM_MODULE_URL) as Promise<
      typeof import("@siglum/engine")
    >,
    fetchWorkerBlobUrl(),
  ]);

  compilerInstance = new SiglumCompiler({
    bundlesUrl: `${SIGLUM_TEXLIVE_URL}/bundles`,
    wasmUrl: `${SIGLUM_TEXLIVE_URL}/busytex.wasm`,
    workerUrl,
    onProgress,
    verbose: false,
  });

  await compilerInstance.init();
  return compilerInstance;
}

export type PdfResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string };

export async function compileLatexToPdf(
  content: string,
  onProgress?: (message: string) => void
): Promise<PdfResult> {
  try {
    const compiler = await getOrCreateCompiler((stage, detail) => {
      onProgress?.(`${stage}${detail ? `: ${detail}` : ""}`);
    });
    onProgress?.("Compiling…");
    const result = await compiler.compile(content);
    if (result.success && result.pdf) {
      // Copy into a plain ArrayBuffer so Blob constructors accept it.
      const buf = new ArrayBuffer(result.pdf.byteLength);
      new Uint8Array(buf).set(result.pdf);
      return { ok: true, bytes: new Uint8Array(buf) };
    }
    return {
      ok: false,
      error: result.error || result.log || "Compilation failed",
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "PDF compilation failed" };
  }
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
