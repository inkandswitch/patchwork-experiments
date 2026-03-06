import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import {
  computeEmbeddings,
  getCachedEmbeddings,
  embedText,
  loadExtractionRules,
  saveExtractionRules,
  previewExtraction,
  getActiveDevice,
  type EmbedProgress,
  type ExtractionRules,
} from './embeddings';
import { projectToUMAP, type Projector } from './projection';
import { clusterAndLabel, type Cluster } from './clustering';
import { MapView, type MapPoint } from './MapView';
import * as tasklib from '@awarth/tasklib';
import './index.css';

const taskQueue = tasklib.queue('automerge:3AXXV4FHVom6sWu1rD8kBRWq9Bmd' as AutomergeUrl);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeafDoc = {
  doc: DocLink;
  path: string[];
};

type ViewState =
  | { kind: 'table' }
  | { kind: 'embedding'; progress: EmbedProgress }
  | {
      kind: 'scene';
      points: MapPoint[];
      clusters: Cluster[];
      vectors: Map<AutomergeUrl, number[]>;
      projector: Projector;
    };

// ---------------------------------------------------------------------------
// localStorage persistence for filters
// ---------------------------------------------------------------------------

const LS_TYPE_FILTERS = 'embeddings-map:type-filters';
const LS_OVERRIDES = 'embeddings-map:overrides';
const DEFAULT_INCLUDED_TYPES = new Set(['essay']);

function loadTypeFilters(): Map<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_TYPE_FILTERS);
    if (raw) return new Map(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return new Map();
}

function saveTypeFilters(filters: Map<string, boolean>): void {
  try {
    localStorage.setItem(LS_TYPE_FILTERS, JSON.stringify(Array.from(filters.entries())));
  } catch {
    /* ignore */
  }
}

function loadOverrides(): Map<AutomergeUrl, boolean> {
  try {
    const raw = localStorage.getItem(LS_OVERRIDES);
    if (raw) return new Map(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return new Map();
}

function saveOverrides(overrides: Map<AutomergeUrl, boolean>): void {
  try {
    localStorage.setItem(LS_OVERRIDES, JSON.stringify(Array.from(overrides.entries())));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Recursive folder walker
// ---------------------------------------------------------------------------

async function collectLeafDocs(
  repo: Repo,
  folderUrl: AutomergeUrl,
  path: string[] = [],
): Promise<LeafDoc[]> {
  try {
    const handle = await repo.find<FolderDoc>(folderUrl);
    if (handle.isUnavailable() || handle.isDeleted()) return [];
    const folder = handle.doc();
    if (!folder?.docs) return [];

    const results: LeafDoc[] = [];
    await Promise.all(
      folder.docs.map(async (docLink: DocLink) => {
        try {
          if (docLink.type === 'folder') {
            const nested = await collectLeafDocs(repo, docLink.url, [...path, docLink.name]);
            results.push(...nested);
          } else {
            results.push({ doc: docLink, path });
            taskQueue.addTask<AutomergeUrl, void>({
              input: docLink.url,
              importUrl: new URL(/* @vite-ignore */ '../task.js', import.meta.url),
            });
          }
        } catch (e) {
          console.warn(`Skipping doc "${docLink.name}" (${docLink.url}):`, e);
        }
      }),
    );
    return results;
  } catch (e) {
    console.warn(`Failed to load folder ${folderUrl}:`, e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// JSONPath placeholder examples per type
// ---------------------------------------------------------------------------

const JSONPATH_EXAMPLES: Record<string, string> = {
  essay: '$.content',
  markdown: '$.content',
  tldraw: '$.store.*.props.text',
  todo: '$.title, $.todos[*].description',
  chat: '$.title, $.messages[*].content.text',
  file: '$.content',
};

// ---------------------------------------------------------------------------
// React entry point
// ---------------------------------------------------------------------------

export const EmbeddingsMapTool: ToolRender = (handle, element) => {
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.position = 'relative';
  element.style.overflow = 'hidden';

  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <EmbeddingsMap docUrl={handle.url} hostElement={element} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ---------------------------------------------------------------------------
// Progress display helper
// ---------------------------------------------------------------------------

function progressLabel(p: EmbedProgress): string {
  const skippedNote = p.skipped ? ` (${p.skipped} unavailable)` : '';
  switch (p.phase) {
    case 'serializing':
      return `Loading docs... ${p.current}/${p.total}${skippedNote}`;
    case 'checking-cache':
      return `Checking cache... ${p.current}/${p.total}${skippedNote}`;
    case 'loading-model': {
      const detail = p.detail ? ` — ${p.detail}` : ' (first download ~137MB)';
      return `Loading model${detail}${skippedNote}`;
    }
    case 'embedding': {
      const device = getActiveDevice();
      const tag = device === 'webgpu' ? ' [GPU]' : ' [CPU]';
      return `Embedding ${p.current}/${p.total}${p.detail ? ` — ${p.detail}` : ''}${tag}${skippedNote}`;
    }
    case 'projecting':
      return `PCA + UMAP projection...${skippedNote}`;
    case 'clustering':
      return `Clustering & labeling (c-TF-IDF)...${skippedNote}`;
    case 'done':
      return `Done${skippedNote}`;
  }
}

// ---------------------------------------------------------------------------
// Cluster lookup helper
// ---------------------------------------------------------------------------

function buildClusterLookup(
  clusters: Cluster[],
  leaves: LeafDoc[],
): Map<AutomergeUrl, { clusterId: number; color: [number, number, number] }> {
  const lookup = new Map<AutomergeUrl, { clusterId: number; color: [number, number, number] }>();
  for (const cluster of clusters) {
    for (const idx of cluster.memberIndices) {
      const leaf = leaves[idx];
      if (leaf) {
        lookup.set(leaf.doc.url, { clusterId: cluster.id, color: cluster.color });
      }
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Scene builder (shared between cache and fresh-embed paths)
// ---------------------------------------------------------------------------

async function buildScene(
  leaves: LeafDoc[],
  vectors: Map<AutomergeUrl, number[]>,
  docTexts: Map<AutomergeUrl, string>,
): Promise<{ points: MapPoint[]; clusters: Cluster[]; projector: Projector } | null> {
  const embeddedLeaves = leaves.filter((l) => vectors.has(l.doc.url));
  if (embeddedLeaves.length < 2) return null;

  const { positions, projector } = await projectToUMAP(vectors);
  const clusters = await clusterAndLabel(embeddedLeaves, positions, vectors, docTexts, embedText);
  const clusterLookup = buildClusterLookup(clusters, embeddedLeaves);

  const points: MapPoint[] = embeddedLeaves.map((leaf) => {
    const info = clusterLookup.get(leaf.doc.url);
    return {
      leaf,
      position: positions.get(leaf.doc.url) ?? [0, 0],
      clusterId: info?.clusterId ?? -1,
      color: info?.color ?? [120, 120, 120],
    };
  });

  return { points, clusters, projector };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const EmbeddingsMap = ({
  docUrl,
  hostElement,
}: {
  docUrl: AutomergeUrl;
  hostElement: HTMLElement;
}) => {
  const repo = useRepo();
  const [folder] = useDocument<FolderDoc>(docUrl);
  const [leafDocs, setLeafDocs] = useState<LeafDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [overrides, setOverrides] = useState<Map<AutomergeUrl, boolean>>(loadOverrides);
  const [typeFilters, setTypeFilters] = useState<Map<string, boolean>>(loadTypeFilters);

  const [extractionRules, setExtractionRules] = useState<ExtractionRules>(loadExtractionRules);
  const [previewResults, setPreviewResults] = useState<
    Map<string, { charCount: number; failed: boolean }>
  >(() => new Map());
  const [showRulesEditor, setShowRulesEditor] = useState(false);

  const [view, setView] = useState<ViewState>({ kind: 'table' });
  const cacheChecked = useRef(false);
  const [longDocs, setLongDocs] = useState<string[]>([]);

  // ---- Collect leaf docs ----

  const refresh = useCallback(async () => {
    setLoadingDocs(true);
    setError(null);
    try {
      setLeafDocs(await collectLeafDocs(repo, docUrl));
    } catch (e) {
      setError(`Failed to load folder contents: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingDocs(false);
    }
  }, [repo, docUrl]);

  useEffect(() => {
    if (folder) refresh();
  }, [folder, refresh]);

  // ---- Type counts ----

  const uniqueTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const leaf of leafDocs) {
      counts.set(leaf.doc.type, (counts.get(leaf.doc.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [leafDocs]);

  // Initialize newly-discovered types: default to included only for essay, off for everything else
  useEffect(() => {
    if (leafDocs.length === 0) return;
    setTypeFilters((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const leaf of leafDocs) {
        if (!next.has(leaf.doc.type)) {
          next.set(leaf.doc.type, DEFAULT_INCLUDED_TYPES.has(leaf.doc.type));
          changed = true;
        }
      }
      if (changed) saveTypeFilters(next);
      return changed ? next : prev;
    });
  }, [leafDocs]);

  // ---- Derive included/excluded rows ----

  const rows = useMemo(
    () =>
      leafDocs.map((leaf) => {
        const override = overrides.get(leaf.doc.url);
        const typeEnabled =
          typeFilters.get(leaf.doc.type) ?? DEFAULT_INCLUDED_TYPES.has(leaf.doc.type);
        const included = override !== undefined ? override : typeEnabled;
        return { leaf, included };
      }),
    [leafDocs, overrides, typeFilters],
  );

  const includedLeaves = useMemo(() => rows.filter((r) => r.included).map((r) => r.leaf), [rows]);

  const includedCount = includedLeaves.length;

  // ---- Extraction rule preview ----

  const runPreview = useCallback(
    async (type: string, rule: string) => {
      const sampleLeaf = leafDocs.find((l) => l.doc.type === type);
      if (!sampleLeaf || !rule.trim()) {
        setPreviewResults((prev) => {
          const next = new Map(prev);
          next.delete(type);
          return next;
        });
        return;
      }
      const result = await previewExtraction(repo, sampleLeaf, rule);
      if (result) {
        setPreviewResults((prev) => {
          const next = new Map(prev);
          next.set(type, result);
          return next;
        });
      }
    },
    [repo, leafDocs],
  );

  const updateRule = useCallback(
    (type: string, rule: string) => {
      setExtractionRules((prev) => {
        const next = new Map(prev);
        if (rule.trim()) next.set(type, rule);
        else next.delete(type);
        saveExtractionRules(next);
        return next;
      });
      runPreview(type, rule);
    },
    [runPreview],
  );

  // ---- Cache check on first load ----

  useEffect(() => {
    if (cacheChecked.current || loadingDocs || includedLeaves.length === 0) return;
    cacheChecked.current = true;

    (async () => {
      try {
        const cached = await getCachedEmbeddings(repo, includedLeaves, extractionRules);
        if (!cached || cached.vectors.size < 2) return;

        const scene = await buildScene(includedLeaves, cached.vectors, cached.docTexts);
        if (scene) {
          setView({ kind: 'scene', vectors: cached.vectors, ...scene });
        }
      } catch (e) {
        console.warn('Cache check failed:', e);
      }
    })();
  }, [loadingDocs, includedLeaves, repo, extractionRules]);

  // ---- Start embedding pipeline ----

  const startEmbedding = useCallback(async () => {
    setError(null);
    setLongDocs([]);
    setView({
      kind: 'embedding',
      progress: { phase: 'serializing', current: 0, total: includedCount },
    });

    try {
      const result = await computeEmbeddings(repo, includedLeaves, extractionRules, (p) => {
        setView({ kind: 'embedding', progress: p });
        if (p.longDocs?.length) setLongDocs(p.longDocs);
      });

      const { vectors, docTexts } = result;

      setView({
        kind: 'embedding',
        progress: { phase: 'projecting', current: vectors.size, total: vectors.size },
      });
      const scene = await buildScene(includedLeaves, vectors, docTexts);

      if (!scene) {
        setError(`Only ${vectors.size} document(s) could be embedded — need at least 2.`);
        setView({ kind: 'table' });
        return;
      }

      setView({ kind: 'scene', vectors, ...scene });
    } catch (e) {
      setError(`Embedding failed: ${e instanceof Error ? e.message : String(e)}`);
      setView({ kind: 'table' });
    }
  }, [repo, includedLeaves, includedCount, extractionRules]);

  // ---- Filter toggles (persisted) ----

  const toggleOverride = useCallback((url: AutomergeUrl, currentIncluded: boolean) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(url, !currentIncluded);
      saveOverrides(next);
      return next;
    });
  }, []);

  const toggleTypeFilter = useCallback(
    (type: string) => {
      setTypeFilters((prev) => {
        const next = new Map(prev);
        next.set(type, !(next.get(type) ?? DEFAULT_INCLUDED_TYPES.has(type)));
        saveTypeFilters(next);
        return next;
      });
      // Clear per-doc overrides for this type so the type toggle takes effect cleanly
      setOverrides((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const leaf of leafDocs) {
          if (leaf.doc.type === type && next.has(leaf.doc.url)) {
            next.delete(leaf.doc.url);
            changed = true;
          }
        }
        if (changed) saveOverrides(next);
        return changed ? next : prev;
      });
    },
    [leafDocs],
  );

  const goBackToTable = useCallback(() => {
    cacheChecked.current = false;
    setView({ kind: 'table' });
  }, []);

  // ---- Render ----

  if (!folder || loadingDocs) {
    return (
      <div className="flex items-center justify-center h-full p-4 gap-3">
        <span className="loading loading-spinner loading-md" />
        <span className="text-base-content/60">Loading folder contents...</span>
      </div>
    );
  }

  if (view.kind === 'scene') {
    return (
      <MapView
        points={view.points}
        clusters={view.clusters}
        vectors={view.vectors}
        projector={view.projector}
        repo={repo}
        extractionRules={extractionRules}
        onBack={goBackToTable}
        hostElement={hostElement}
      />
    );
  }

  const isEmbedding = view.kind === 'embedding';
  const progress = isEmbedding ? view.progress : null;

  return (
    <div className="p-4 h-full overflow-hidden flex flex-col gap-3">
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {longDocs.length > 0 && (
        <div className="alert alert-warning text-sm">
          <span>
            {longDocs.length} doc(s) exceed ~6 000 words and may be truncated:{' '}
            {longDocs.slice(0, 5).join(', ')}
            {longDocs.length > 5 ? ` (+${longDocs.length - 5} more)` : ''}
          </span>
          <button className="btn btn-ghost btn-xs" onClick={() => setLongDocs([])}>
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center border-b border-base-300 pb-2">
        <h2 className="text-lg font-semibold">Embeddings Map (taskified)</h2>
        <div className="flex items-center gap-3">
          <span className="badge badge-ghost">
            {includedCount}/{rows.length} included
          </span>
          <button
            className={`btn btn-xs ${showRulesEditor ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setShowRulesEditor((v) => !v)}
            disabled={isEmbedding}
          >
            Extraction Rules
          </button>
          <button
            className="btn btn-sm btn-primary"
            disabled={isEmbedding || includedCount === 0}
            onClick={startEmbedding}
          >
            {isEmbedding ? 'Embedding...' : 'Compute Embeddings'}
          </button>
        </div>
      </div>

      {/* Extraction rules editor */}
      {showRulesEditor && (
        <div className="border border-base-300 rounded-lg p-3 flex flex-col gap-2 bg-base-200/50">
          <div className="flex items-center gap-2 text-xs text-base-content/60">
            <span className="font-semibold">Per-type JSONPath extraction</span>
            <a
              href="https://goessner.net/articles/JsonPath/"
              target="_blank"
              rel="noopener noreferrer"
              className="link link-primary"
            >
              Syntax reference
            </a>
          </div>
          {uniqueTypes.map(([type, count]) => {
            const enabled = typeFilters.get(type) ?? DEFAULT_INCLUDED_TYPES.has(type);
            if (!enabled) return null;
            const currentRule = extractionRules.get(type) ?? '';
            const preview = previewResults.get(type);
            const placeholder = JSONPATH_EXAMPLES[type] ?? '$.content';
            return (
              <div key={type} className="flex items-center gap-2">
                <span className="badge badge-xs badge-outline w-20 shrink-0 justify-center">
                  {type}
                  <span className="ml-1 opacity-50">({count})</span>
                </span>
                <input
                  type="text"
                  className="input input-xs input-bordered flex-1 font-mono"
                  placeholder={placeholder}
                  value={currentRule}
                  onChange={(e) => updateRule(type, e.target.value)}
                  disabled={isEmbedding}
                />
                {preview && (
                  <span
                    className={`text-xs whitespace-nowrap ${preview.failed ? 'text-warning' : 'text-success'}`}
                  >
                    {preview.failed ? 'fallback: ' : ''}
                    {preview.charCount} chars
                  </span>
                )}
                {!preview && currentRule && (
                  <button
                    className="btn btn-xs btn-ghost"
                    onClick={() => runPreview(type, currentRule)}
                  >
                    Preview
                  </button>
                )}
              </div>
            );
          })}
          <div className="text-xs text-base-content/40 mt-1">
            Leave empty to use recursive string extraction (universal fallback). Comma-separate
            multiple JSONPath expressions.
          </div>
        </div>
      )}

      {/* Type filters */}
      {uniqueTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-base-content/50 mr-1">Types:</span>
          {uniqueTypes.map(([type, count]) => {
            const enabled = typeFilters.get(type) ?? DEFAULT_INCLUDED_TYPES.has(type);
            return (
              <button
                key={type}
                className={`btn btn-xs ${enabled ? 'btn-outline btn-primary' : 'btn-ghost opacity-50'}`}
                disabled={isEmbedding}
                onClick={() => toggleTypeFilter(type)}
              >
                {type}
                <span className="badge badge-xs ml-1">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-base-content/60">
            <span>{progressLabel(progress)}</span>
            <span>{Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%</span>
          </div>
          <progress
            className="progress progress-primary w-full"
            value={progress.current}
            max={progress.total}
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-y-auto flex-1">
        {rows.length === 0 ? (
          <div className="text-center text-base-content/60 py-8">No documents found</div>
        ) : (
          <table className="table table-xs table-pin-rows w-full">
            <thead>
              <tr>
                <th className="w-8" />
                <th>Path</th>
                <th>Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.leaf.doc.url}-${i}`} className={row.included ? '' : 'opacity-40'}>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={row.included}
                      disabled={isEmbedding}
                      onChange={() => toggleOverride(row.leaf.doc.url, row.included)}
                    />
                  </td>
                  <td className="font-mono text-base-content/50 truncate max-w-[200px]">
                    {row.leaf.path.length > 0 ? row.leaf.path.join('/') + '/' : ''}
                  </td>
                  <td className="truncate max-w-[250px]">{row.leaf.doc.name}</td>
                  <td>
                    <span className="badge badge-xs badge-outline">{row.leaf.doc.type}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
