import { useState, useEffect, useCallback, useMemo } from 'react';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import { useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import './index.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A leaf document with its path through the folder tree. */
export type LeafDoc = {
  doc: DocLink;
  path: string[];
};

// ---------------------------------------------------------------------------
// Binary extension detection
// ---------------------------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'tiff', 'tif',
  'avif', 'heic', 'heif',
  // fonts
  'otf', 'ttf', 'woff', 'woff2', 'eot',
  // audio/video
  'mp3', 'mp4', 'wav', 'ogg', 'webm', 'flac', 'aac', 'm4a', 'avi', 'mov',
  'mkv',
  // archives
  'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  // documents (binary)
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  // other binary
  'wasm', 'exe', 'dll', 'so', 'dylib', 'bin',
]);

function getExtension(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function isBinaryFile(name: string): boolean {
  const ext = getExtension(name);
  return ext !== null && BINARY_EXTENSIONS.has(ext);
}

// ---------------------------------------------------------------------------
// Recursive folder walker
// ---------------------------------------------------------------------------

async function collectLeafDocs(
  repo: Repo,
  folderUrl: AutomergeUrl,
  path: string[] = [],
): Promise<LeafDoc[]> {
  const handle = await repo.find<FolderDoc>(folderUrl);
  const folder = handle.doc();
  if (!folder?.docs) return [];

  const results: LeafDoc[] = [];

  await Promise.all(
    folder.docs.map(async (docLink: DocLink) => {
      if (docLink.type === 'folder') {
        const nested = await collectLeafDocs(repo, docLink.url, [
          ...path,
          docLink.name,
        ]);
        results.push(...nested);
      } else {
        results.push({ doc: docLink, path });
      }
    }),
  );

  return results;
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
// Main component
// ---------------------------------------------------------------------------

const EmbeddingsViewer = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const repo = useRepo();
  const [folder] = useDocument<FolderDoc>(docUrl);
  const [leafDocs, setLeafDocs] = useState<LeafDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual overrides: url -> true (force include) / false (force exclude)
  const [overrides, setOverrides] = useState<Map<AutomergeUrl, boolean>>(
    () => new Map(),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const leaves = await collectLeafDocs(repo, docUrl);
    setLeafDocs(leaves);
    setLoading(false);
  }, [repo, docUrl]);

  useEffect(() => {
    if (folder) {
      refresh();
    }
  }, [folder, refresh]);

  // Derive included/excluded state for each leaf.
  const rows = useMemo(
    () =>
      leafDocs.map((leaf) => {
        const binary = isBinaryFile(leaf.doc.name);
        const override = overrides.get(leaf.doc.url);
        // default: include unless binary
        const included = override !== undefined ? override : !binary;
        return { leaf, binary, included };
      }),
    [leafDocs, overrides],
  );

  const includedCount = rows.filter((r) => r.included).length;

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

  if (!folder || loading) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-hidden flex flex-col gap-3">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-base-300 pb-2">
        <h2 className="text-lg font-semibold">Embeddings Viewer</h2>
        <div className="flex items-center gap-2">
          <span className="badge badge-ghost">
            {includedCount}/{rows.length} included
          </span>
        </div>
      </div>

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
