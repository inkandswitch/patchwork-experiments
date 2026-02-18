import {
  AutoTokenizer,
  AutoModel,
  mean_pooling,
  layer_norm,
} from '@huggingface/transformers';
import { JSONPath } from 'jsonpath-plus';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { LeafDoc } from './tool.tsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';
const EMBED_DIM = 768;
const TASK_PREFIX = 'clustering: ';
const LONG_DOC_WORD_THRESHOLD = 6000;
// nomic uses standard O(n²) attention — at large sequence lengths ONNX Runtime
// OOMs in the browser. WebGPU can handle more, WASM less.
const MAX_TOKENS_WEBGPU = 8192;
const MAX_TOKENS_WASM = 2048;
const DB_NAME = 'embeddings-map';
const STORE_NAME = 'embeddings';
const DB_VERSION = 2;

// ---------------------------------------------------------------------------
// Extraction rules (per doc type → JSONPath expressions)
// ---------------------------------------------------------------------------

export type ExtractionRules = Map<string, string>;

const LS_KEY = 'embeddings-map:extraction-rules';

export function loadExtractionRules(): ExtractionRules {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Map(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Map();
}

export function saveExtractionRules(rules: ExtractionRules): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Array.from(rules.entries())));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Recursive string extraction (universal fallback)
// ---------------------------------------------------------------------------

function extractAllStrings(obj: unknown, minLen = 5): string[] {
  const results: string[] = [];

  function walk(val: unknown) {
    if (typeof val === 'string') {
      if (val.length >= minLen) results.push(val);
    } else if (Array.isArray(val)) {
      for (const item of val) walk(item);
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) walk(v);
    }
  }

  walk(obj);
  return results;
}

// ---------------------------------------------------------------------------
// JSONPath extraction
// ---------------------------------------------------------------------------

function extractViaJsonPath(doc: unknown, pathExpr: string): string[] {
  const exprs = pathExpr.split(',').map((s) => s.trim()).filter(Boolean);
  const results: string[] = [];

  for (const expr of exprs) {
    try {
      const matches = JSONPath({ path: expr, json: doc as object, flatten: true });
      if (Array.isArray(matches)) {
        for (const m of matches) {
          if (typeof m === 'string' && m.length > 0) results.push(m);
        }
      }
    } catch {
      // invalid expression — skip
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Doc serialization
// ---------------------------------------------------------------------------

export type SerializeResult = {
  text: string;
  extractionFailed: boolean;
};

/**
 * Load a doc by URL and serialize it to embeddable text.
 * Uses per-type JSONPath rules when available, falls back to recursive string extraction.
 * Returns null if the document is unavailable.
 */
export async function serializeDoc(
  repo: Repo,
  leaf: LeafDoc,
  rules: ExtractionRules,
): Promise<SerializeResult | null> {
  try {
    const handle = await repo.find(leaf.doc.url);
    if (handle.isUnavailable() || handle.isDeleted() || handle.isUnloaded()) {
      return null;
    }
    if (!handle.isReady()) {
      try {
        await handle.whenReady(undefined, { signal: AbortSignal.timeout(5000) });
      } catch {
        return null;
      }
    }
    const doc = handle.doc();
    const pathStr = leaf.path.length > 0 ? leaf.path.join('/') + '/' : '';
    const header = `Name: ${leaf.doc.name}\nPath: ${pathStr}\n---\n`;

    let bodyParts: string[] = [];
    let extractionFailed = false;

    const rule = rules.get(leaf.doc.type);
    if (rule) {
      bodyParts = extractViaJsonPath(doc, rule);
      if (bodyParts.length === 0) {
        // JSONPath matched nothing — fallback
        bodyParts = extractAllStrings(doc);
        extractionFailed = true;
      }
    } else {
      // No rule defined — use universal fallback
      bodyParts = extractAllStrings(doc);
    }

    const body = bodyParts.join('\n');
    const text = TASK_PREFIX + header + body;
    return { text, extractionFailed };
  } catch {
    return null;
  }
}

/**
 * Preview extraction for a single doc type (for the UI).
 * Returns the extracted text length, or null on failure.
 */
export async function previewExtraction(
  repo: Repo,
  leaf: LeafDoc,
  rule: string,
): Promise<{ charCount: number; failed: boolean } | null> {
  try {
    const handle = await repo.find(leaf.doc.url);
    if (!handle.isReady()) {
      try {
        await handle.whenReady(undefined, { signal: AbortSignal.timeout(3000) });
      } catch {
        return null;
      }
    }
    const doc = handle.doc();
    const parts = extractViaJsonPath(doc, rule);
    if (parts.length > 0) {
      return { charCount: parts.join('\n').length, failed: false };
    }
    const fallback = extractAllStrings(doc);
    return { charCount: fallback.join('\n').length, failed: true };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simple string hash (FNV-1a)
// ---------------------------------------------------------------------------

function hashString(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// ---------------------------------------------------------------------------
// IndexedDB cache
// ---------------------------------------------------------------------------

type CachedEmbedding = {
  url: AutomergeUrl;
  vector: number[];
  textHash: string;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Drop old store on version upgrade (dimensionality change)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'url' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(
  db: IDBDatabase,
  url: AutomergeUrl,
): Promise<CachedEmbedding | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(url);
    req.onsuccess = () => resolve(req.result as CachedEmbedding | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function putCached(
  db: IDBDatabase,
  entry: CachedEmbedding,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public: check if all embeddings are cached (fast, no model needed)
// ---------------------------------------------------------------------------

export async function getCachedEmbeddings(
  repo: Repo,
  leaves: LeafDoc[],
  rules: ExtractionRules,
  onProgress?: (current: number, total: number) => void,
): Promise<{ vectors: Map<AutomergeUrl, number[]>; docTexts: Map<AutomergeUrl, string> } | null> {
  const db = await openDB();
  const vectors = new Map<AutomergeUrl, number[]>();
  const docTexts = new Map<AutomergeUrl, string>();

  try {
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      onProgress?.(i, leaves.length);

      const cached = await getCached(db, leaf.doc.url);
      if (!cached) return null;

      const result = await serializeDoc(repo, leaf, rules);
      if (result === null) continue;
      const hash = hashString(result.text);
      if (cached.textHash !== hash) return null;

      vectors.set(leaf.doc.url, cached.vector);
      docTexts.set(leaf.doc.url, result.text);
    }
  } finally {
    db.close();
  }

  return { vectors, docTexts };
}

// ---------------------------------------------------------------------------
// Public: compute embeddings (with caching + progress)
// ---------------------------------------------------------------------------

export type EmbedProgress = {
  phase: 'serializing' | 'checking-cache' | 'loading-model' | 'embedding' | 'projecting' | 'clustering' | 'done';
  current: number;
  total: number;
  detail?: string;
  skipped?: number;
  longDocs?: string[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokenizerInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelInstance: any = null;
let activeDevice: 'webgpu' | 'wasm' = 'wasm';

function makeProgressCallback(onProgress?: (p: EmbedProgress) => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (event: any) => {
    if (event?.status === 'download' && onProgress) {
      const pct = event.total
        ? `${Math.round((event.loaded / event.total) * 100)}%`
        : `${Math.round((event.loaded ?? 0) / 1024 / 1024)}MB`;
      onProgress({
        phase: 'loading-model',
        current: 0,
        total: 0,
        detail: `Downloading model... ${pct}`,
      });
    }
  };
}

async function loadModel(onProgress?: (p: EmbedProgress) => void) {
  const cb = makeProgressCallback(onProgress);

  if (!tokenizerInstance) {
    tokenizerInstance = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: cb,
    });
  }

  if (!modelInstance) {
    // Try WebGPU first (fp32 — quantized dtypes not supported on WebGPU),
    // fall back to WASM (q8 quantized for smaller memory footprint).
    // WebGPU supports fp32 and fp16, but nomic-embed-text uses RoPE whose Cos
    // kernel has a known fp16 shape bug in ONNX Runtime WebGPU. Use fp32 on
    // WebGPU (547MB) and q8 on WASM (137MB) as fallback.
    const attempts: { device: 'webgpu' | 'wasm'; dtype: 'fp32' | 'q8' }[] = [
      { device: 'webgpu', dtype: 'fp32' },
      { device: 'wasm',   dtype: 'q8'   },
    ];

    for (const attempt of attempts) {
      try {
        modelInstance = await AutoModel.from_pretrained(MODEL_ID, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback: cb,
        });
        activeDevice = attempt.device;
        console.log(`[embeddings-map] Model loaded on ${attempt.device} (${attempt.dtype})`);
        break;
      } catch (e) {
        console.warn(`[embeddings-map] Failed to load on ${attempt.device}/${attempt.dtype}:`, e);
        if (attempt.device === 'wasm') throw e; // all options exhausted
      }
    }
  }

  return { tokenizer: tokenizerInstance, model: modelInstance };
}

/**
 * Embed a single text string. Handles tokenization, forward pass,
 * mean pooling, layer norm, and L2 normalization.
 * Prepends the clustering task prefix if not already present.
 */
export async function embedText(text: string): Promise<number[]> {
  const { tokenizer, model } = await loadModel();
  const prefixed = text.startsWith(TASK_PREFIX) ? text : TASK_PREFIX + text;
  return runEmbedding(tokenizer, model, prefixed);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runEmbedding(tokenizer: any, model: any, text: string): Promise<number[]> {
  // Cap sequence length based on device — WASM/CPU will OOM on very long sequences
  // because nomic uses O(n²) standard attention (not linear attention).
  const maxLength = activeDevice === 'webgpu' ? MAX_TOKENS_WEBGPU : MAX_TOKENS_WASM;
  const inputs = tokenizer(text, { padding: true, truncation: true, max_length: maxLength });
  const { last_hidden_state } = await model(inputs);
  const pooled = mean_pooling(last_hidden_state, inputs.attention_mask);
  const normed = layer_norm(pooled, [EMBED_DIM]);
  const final = normed.normalize(2, -1);
  return Array.from(final.data as Float32Array);
}

/** Exported for display in the UI */
export function getActiveDevice(): 'webgpu' | 'wasm' {
  return activeDevice;
}

export type EmbedResult = {
  vectors: Map<AutomergeUrl, number[]>;
  docTexts: Map<AutomergeUrl, string>;
};

export async function computeEmbeddings(
  repo: Repo,
  leaves: LeafDoc[],
  rules: ExtractionRules,
  onProgress: (p: EmbedProgress) => void,
): Promise<EmbedResult> {
  const db = await openDB();
  const vectors = new Map<AutomergeUrl, number[]>();
  const docTexts = new Map<AutomergeUrl, string>();
  const total = leaves.length;
  const longDocs: string[] = [];

  try {
    type WorkItem = { leaf: LeafDoc; text: string; hash: string };
    const toEmbed: WorkItem[] = [];
    let skipped = 0;

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      onProgress({
        phase: 'serializing',
        current: i,
        total,
        detail: leaf.doc.name,
        skipped,
      });

      const result = await serializeDoc(repo, leaf, rules);
      if (result === null) {
        skipped++;
        console.warn(`Skipping unavailable doc: ${leaf.doc.name} (${leaf.doc.url})`);
        continue;
      }

      // Warn about docs that might exceed 8k token context
      const wordCount = result.text.split(/\s+/).length;
      if (wordCount > LONG_DOC_WORD_THRESHOLD) {
        longDocs.push(leaf.doc.name);
        console.warn(`Long doc (${wordCount} words, may be truncated): ${leaf.doc.name}`);
      }

      if (result.extractionFailed) {
        console.warn(`JSONPath extraction failed for "${leaf.doc.name}" (type: ${leaf.doc.type}), used fallback`);
      }

      const hash = hashString(result.text);
      docTexts.set(leaf.doc.url, result.text);

      onProgress({
        phase: 'checking-cache',
        current: i,
        total,
        detail: leaf.doc.name,
        skipped,
      });

      const cached = await getCached(db, leaf.doc.url);
      if (cached && cached.textHash === hash) {
        vectors.set(leaf.doc.url, cached.vector);
      } else {
        toEmbed.push({ leaf, text: result.text, hash });
      }
    }

    const embeddableTotal = total - skipped;

    if (toEmbed.length > 0) {
      onProgress({
        phase: 'loading-model',
        current: vectors.size,
        total: embeddableTotal,
        detail: `${toEmbed.length} to embed, ${vectors.size} cached, ${skipped} skipped — first download is ~137MB`,
        skipped,
        longDocs,
      });

      const { tokenizer, model } = await loadModel(onProgress);

      for (let i = 0; i < toEmbed.length; i++) {
        const { leaf, text, hash } = toEmbed[i];

        onProgress({
          phase: 'embedding',
          current: vectors.size,
          total: embeddableTotal,
          detail: leaf.doc.name,
          skipped,
          longDocs,
        });

        const vector = await runEmbedding(tokenizer, model, text);

        vectors.set(leaf.doc.url, vector);
        await putCached(db, { url: leaf.doc.url, vector, textHash: hash });
      }
    }

    onProgress({ phase: 'done', current: embeddableTotal, total: embeddableTotal, skipped, longDocs });
    return { vectors, docTexts };
  } finally {
    db.close();
  }
}
