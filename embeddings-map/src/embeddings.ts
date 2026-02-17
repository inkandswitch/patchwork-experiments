import { pipeline } from '@huggingface/transformers';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { LeafDoc } from './tool.tsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const DB_NAME = 'embeddings-map';
const STORE_NAME = 'embeddings';
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// Doc serialization
// ---------------------------------------------------------------------------

/**
 * Load a doc by URL and serialize it to embeddable text.
 * Prepends name + path as a header so the embedding captures context.
 * Returns null if the document is unavailable, deleted, or otherwise unloadable.
 */
export async function serializeDoc(
  repo: Repo,
  leaf: LeafDoc,
): Promise<string | null> {
  try {
    const handle = await repo.find(leaf.doc.url);
    if (handle.isUnavailable() || handle.isDeleted() || handle.isUnloaded()) {
      return null;
    }
    if (!handle.isReady()) {
      // Give it a moment to load, then bail
      try {
        await handle.whenReady(undefined, { signal: AbortSignal.timeout(5000) });
      } catch {
        return null;
      }
    }
    const doc = handle.doc();
    const pathStr = leaf.path.length > 0 ? leaf.path.join('/') + '/' : '';
    const header = `Name: ${leaf.doc.name}\nPath: ${pathStr}\n---\n`;
    return header + JSON.stringify(doc, null, 2);
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
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
  onProgress?: (current: number, total: number) => void,
): Promise<Map<AutomergeUrl, number[]> | null> {
  const db = await openDB();
  const results = new Map<AutomergeUrl, number[]>();

  try {
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      onProgress?.(i, leaves.length);

      const cached = await getCached(db, leaf.doc.url);
      if (!cached) return null;

      const text = await serializeDoc(repo, leaf);
      if (text === null) continue; // skip unavailable docs
      const hash = hashString(text);
      if (cached.textHash !== hash) return null;

      results.set(leaf.doc.url, cached.vector);
    }
  } finally {
    db.close();
  }

  return results;
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
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipelineInstance: any = null;

async function getEmbedder() {
  if (!pipelineInstance) {
    pipelineInstance = await (pipeline as any)('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
    });
  }
  return pipelineInstance;
}

/**
 * Embed a single text string using the cached pipeline.
 * The model must already be loaded (call computeEmbeddings first).
 */
export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function computeEmbeddings(
  repo: Repo,
  leaves: LeafDoc[],
  onProgress: (p: EmbedProgress) => void,
): Promise<Map<AutomergeUrl, number[]>> {
  const db = await openDB();
  const results = new Map<AutomergeUrl, number[]>();
  const total = leaves.length;

  try {
    // 1. Serialize all docs and check cache
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

      const text = await serializeDoc(repo, leaf);
      if (text === null) {
        skipped++;
        console.warn(`Skipping unavailable doc: ${leaf.doc.name} (${leaf.doc.url})`);
        continue;
      }

      const hash = hashString(text);

      onProgress({
        phase: 'checking-cache',
        current: i,
        total,
        detail: leaf.doc.name,
        skipped,
      });

      const cached = await getCached(db, leaf.doc.url);
      if (cached && cached.textHash === hash) {
        results.set(leaf.doc.url, cached.vector);
      } else {
        toEmbed.push({ leaf, text, hash });
      }
    }

    const embeddableTotal = total - skipped;

    // 2. Load model (if needed)
    if (toEmbed.length > 0) {
      onProgress({
        phase: 'loading-model',
        current: results.size,
        total: embeddableTotal,
        detail: `${toEmbed.length} to embed, ${results.size} cached, ${skipped} skipped`,
        skipped,
      });

      const embedder = await getEmbedder();

      // 3. Embed uncached docs
      for (let i = 0; i < toEmbed.length; i++) {
        const { leaf, text, hash } = toEmbed[i];

        onProgress({
          phase: 'embedding',
          current: results.size,
          total: embeddableTotal,
          detail: leaf.doc.name,
          skipped,
        });

        const output = await embedder(text, { pooling: 'mean', normalize: true });
        const vector = Array.from(output.data as Float32Array);

        results.set(leaf.doc.url, vector);
        await putCached(db, { url: leaf.doc.url, vector, textHash: hash });
      }
    }

    onProgress({ phase: 'done', current: embeddableTotal, total: embeddableTotal, skipped });
    return results;
  } finally {
    db.close();
  }
}
