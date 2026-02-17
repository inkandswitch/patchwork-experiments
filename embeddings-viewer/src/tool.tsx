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
  type EmbedProgress,
} from './embeddings';
import { projectToUMAP3D } from './projection';
import { SceneView, type ScenePoint } from './SceneView';
import './index.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A leaf document with its path through the folder tree. */
export type LeafDoc = {
  doc: DocLink;
  path: string[];
};

type ViewState =
  | { kind: 'table' }
  | { kind: 'embedding'; progress: EmbedProgress }
  | { kind: 'scene'; points: ScenePoint[] };

// ---------------------------------------------------------------------------
// Binary extension detection
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tiff', 'tif',
  'avif', 'heic', 'heif',
  'otf', 'ttf', 'woff', 'woff2', 'eot',
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'flac', 'aac', 'm4a', 'avi', 'mov',
  'mkv',
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'wasm', 'exe', 'dll', 'so', 'dylib', 'bin',
]);

function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return false;
  return BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
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
            const nested = await collectLeafDocs(repo, docLink.url, [
              ...path,
              docLink.name,
            ]);
            results.push(...nested);
          } else {
            results.push({ doc: docLink, path });
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
// React entry point
// ---------------------------------------------------------------------------

export const EmbeddingsViewerTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <EmbeddingsViewer docUrl={handle.url} />
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
    case 'loading-model':
      return `Loading embedding model (first time may download ~22MB)...${skippedNote}`;
    case 'embedding':
      return `Embedding ${p.current}/${p.total}${p.detail ? ` — ${p.detail}` : ''}${skippedNote}`;
    case 'projecting':
      return `Running UMAP projection...${skippedNote}`;
    case 'done':
      return `Done${skippedNote}`;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const EmbeddingsViewer = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const repo = useRepo();
  const [folder] = useDocument<FolderDoc>(docUrl);
  const [leafDocs, setLeafDocs] = useState<LeafDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-doc overrides: url -> true (force include) / false (force exclude)
  const [overrides, setOverrides] = useState<Map<AutomergeUrl, boolean>>(
    () => new Map(),
  );

  // Type-level filters: type -> false means exclude all of that type
  const [typeFilters, setTypeFilters] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  // View state machine
  const [view, setView] = useState<ViewState>({ kind: 'table' });
  const cacheChecked = useRef(false);

  // Collect leaf docs on folder change
  const refresh = useCallback(async () => {
    setLoadingDocs(true);
    setError(null);
    try {
      const leaves = await collectLeafDocs(repo, docUrl);
      setLeafDocs(leaves);
    } catch (e) {
      setError(`Failed to load folder contents: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingDocs(false);
    }
  }, [repo, docUrl]);

  useEffect(() => {
    if (folder) {
      refresh();
    }
  }, [folder, refresh]);

  // Collect unique types for filter UI
  const uniqueTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const leaf of leafDocs) {
      counts.set(leaf.doc.type, (counts.get(leaf.doc.type) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [leafDocs]);

  // Initialize type filters: binary-heavy types off, rest on
  useEffect(() => {
    if (leafDocs.length === 0) return;
    setTypeFilters((prev) => {
      const next = new Map(prev);
      for (const leaf of leafDocs) {
        if (!next.has(leaf.doc.type)) {
          // Default: exclude types where most files are binary
          const typeDocs = leafDocs.filter((l) => l.doc.type === leaf.doc.type);
          const binaryCount = typeDocs.filter((l) => isBinaryFile(l.doc.name)).length;
          next.set(leaf.doc.type, binaryCount < typeDocs.length / 2);
        }
      }
      return next;
    });
  }, [leafDocs]);

  // Derive included/excluded rows
  const rows = useMemo(
    () =>
      leafDocs.map((leaf) => {
        const binary = isBinaryFile(leaf.doc.name);
        const override = overrides.get(leaf.doc.url);
        const typeEnabled = typeFilters.get(leaf.doc.type) ?? true;

        // Priority: per-doc override > type filter > binary default
        let included: boolean;
        if (override !== undefined) {
          included = override;
        } else if (!typeEnabled) {
          included = false;
        } else {
          included = !binary;
        }

        return { leaf, binary, included };
      }),
    [leafDocs, overrides, typeFilters],
  );

  const includedLeaves = useMemo(
    () => rows.filter((r) => r.included).map((r) => r.leaf),
    [rows],
  );

  const includedCount = includedLeaves.length;

  // Check cache on first load — if all included docs are cached, go to scene
  useEffect(() => {
    if (cacheChecked.current || loadingDocs || includedLeaves.length === 0)
      return;
    cacheChecked.current = true;

    (async () => {
      try {
        const cached = await getCachedEmbeddings(repo, includedLeaves);
        if (cached) {
          const positions = await projectToUMAP3D(cached);
          const points: ScenePoint[] = includedLeaves.map((leaf) => ({
            leaf,
            position: positions.get(leaf.doc.url) ?? [0, 0, 0],
          }));
          setView({ kind: 'scene', points });
        }
      } catch (e) {
        // Cache check failed silently — user can still manually embed
        console.warn('Cache check failed:', e);
      }
    })();
  }, [loadingDocs, includedLeaves, repo]);

  // Start embedding pipeline
  const startEmbedding = useCallback(async () => {
    setError(null);
    setView({
      kind: 'embedding',
      progress: { phase: 'serializing', current: 0, total: includedCount },
    });

    try {
      const vectors = await computeEmbeddings(repo, includedLeaves, (p) => {
        setView({ kind: 'embedding', progress: p });
      });

      setView({
        kind: 'embedding',
        progress: { phase: 'projecting', current: includedCount, total: includedCount },
      });

      const positions = await projectToUMAP3D(vectors);
      const points: ScenePoint[] = includedLeaves.map((leaf) => ({
        leaf,
        position: positions.get(leaf.doc.url) ?? [0, 0, 0],
      }));
      setView({ kind: 'scene', points });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Embedding failed: ${msg}`);
      setView({ kind: 'table' });
    }
  }, [repo, includedLeaves, includedCount]);

  const toggleOverride = useCallback(
    (url: AutomergeUrl, currentIncluded: boolean) => {
      setOverrides((prev) => {
        const next = new Map(prev);
        next.set(url, !currentIncluded);
        return next;
      });
    },
    [],
  );

  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilters((prev) => {
      const next = new Map(prev);
      next.set(type, !(next.get(type) ?? true));
      return next;
    });
    // Clear per-doc overrides for this type so the filter takes effect cleanly
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const leaf of leafDocs) {
        if (leaf.doc.type === type) {
          next.delete(leaf.doc.url);
        }
      }
      return next;
    });
  }, [leafDocs]);

  const goBackToTable = useCallback(() => {
    cacheChecked.current = false;
    setView({ kind: 'table' });
  }, []);

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  if (!folder || loadingDocs) {
    return (
      <div className="flex items-center justify-center h-full p-4 gap-3">
        <span className="loading loading-spinner loading-md"></span>
        <span className="text-base-content/60">Loading folder contents...</span>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Scene view
  // -------------------------------------------------------------------------

  if (view.kind === 'scene') {
    return <SceneView points={view.points} onBack={goBackToTable} />;
  }

  // -------------------------------------------------------------------------
  // Table view (+ embedding progress overlay)
  // -------------------------------------------------------------------------

  const isEmbedding = view.kind === 'embedding';
  const progress = isEmbedding ? view.progress : null;

  return (
    <div className="p-4 h-full overflow-hidden flex flex-col gap-3">
      {/* Error banner */}
      {error && (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center border-b border-base-300 pb-2">
        <h2 className="text-lg font-semibold">Embeddings Viewer</h2>
        <div className="flex items-center gap-3">
          <span className="badge badge-ghost">
            {includedCount}/{rows.length} included
          </span>
          <button
            className="btn btn-sm btn-primary"
            disabled={isEmbedding || includedCount === 0}
            onClick={startEmbedding}
          >
            {isEmbedding ? 'Embedding...' : 'Compute Embeddings'}
          </button>
        </div>
      </div>

      {/* Type filters */}
      {uniqueTypes.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-base-content/50 mr-1">Types:</span>
          {uniqueTypes.map(([type, count]) => {
            const enabled = typeFilters.get(type) ?? true;
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

      {/* Progress bar */}
      {progress && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-base-content/60">
            <span>{progressLabel(progress)}</span>
            <span>
              {Math.round(
                (progress.current / Math.max(progress.total, 1)) * 100,
              )}
              %
            </span>
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
          <div className="text-center text-base-content/60 py-8">
            No documents found
          </div>
        ) : (
          <table className="table table-xs table-pin-rows w-full">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Path</th>
                <th>Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={`${row.leaf.doc.url}-${i}`}
                  className={row.included ? '' : 'opacity-40'}
                >
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={row.included}
                      disabled={isEmbedding}
                      onChange={() =>
                        toggleOverride(row.leaf.doc.url, row.included)
                      }
                    />
                  </td>
                  <td className="font-mono text-base-content/50 truncate max-w-[200px]">
                    {row.leaf.path.length > 0
                      ? row.leaf.path.join('/') + '/'
                      : ''}
                  </td>
                  <td className="truncate max-w-[250px]">
                    {row.leaf.doc.name}
                    {row.binary && (
                      <span className="badge badge-xs badge-warning ml-1">
                        binary
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-xs badge-outline">
                      {row.leaf.doc.type}
                    </span>
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
