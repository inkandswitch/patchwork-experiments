import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocument, useDocHandle, useRepo } from "@automerge/automerge-repo-react-hooks";
import { toolify } from "@inkandswitch/patchwork-react";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { parseAutomergeUrl, decodeHeads } from "@automerge/automerge-repo";
import { AnnotationSet } from "@inkandswitch/annotations";
import { annotations as globalAnnotations } from "@inkandswitch/annotations-context";
import { diffAnnotationsOfDoc, ViewHeads } from "@inkandswitch/annotations-diff";
import { ref } from "@inkandswitch/patchwork-refs";
import type { WorkspaceDoc, FileChange, DiffRow } from "./types";
import { computeChangeset, computeSideBySideDiff, mergeChanges } from "./workspace-diff";
import "./styles.css";

type ReactToolProps = {
  docUrl: AutomergeUrl;
  element: any;
};

const WorkspaceReview = ({ docUrl }: ReactToolProps) => {
  const repo = useRepo();
  const [doc] = useDocument<WorkspaceDoc>(docUrl, { suspense: true });

  const [changes, setChanges] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Compute changeset whenever the doc changes
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;

    setLoading(true);
    setError(null);

    computeChangeset(repo, doc)
      .then((result) => {
        if (!cancelled) {
          setChanges(result);
          setLoading(false);
          setMerged(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repo, doc]);

  const handleMerge = useCallback(async () => {
    if (merging) return;
    setMerging(true);
    setError(null);

    try {
      const handle = await repo.find<WorkspaceDoc>(docUrl);
      await handle.whenReady();
      await mergeChanges(repo, handle);
      setMerged(true);
      setChanges([]);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setMerging(false);
    }
  }, [repo, docUrl, merging]);

  const changedFiles = changes.filter((c) => c.changeType !== "unchanged");
  const hasChanges = changedFiles.length > 0;

  return (
    <div className="flex flex-col h-full bg-base-100 dark:bg-base-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-200 dark:border-base-content/10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Workspace Review</h2>
          {loading && <span className="loading loading-spinner loading-xs" />}
          {!loading && !hasChanges && !merged && <span className="badge badge-xs badge-ghost">No changes</span>}
          {!loading && hasChanges && (
            <span className="badge badge-xs badge-info">
              {changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""} changed
            </span>
          )}
          {merged && <span className="badge badge-xs badge-success">Merged</span>}
        </div>
      </div>

      {/* File list summary */}
      {changes.length > 0 && (
        <div className="px-4 py-2 border-b border-base-200 dark:border-base-content/10 flex flex-wrap gap-2">
          {changes.map((change) => (
            <a key={change.originalUrl ?? change.cloneUrl ?? change.path} href={`#diff-${encodeURIComponent(change.originalUrl ?? change.path)}`} className="flex items-center gap-1 text-xs font-mono hover:underline">
              <ChangeTypeBadge type={change.changeType} />
              {change.changeType === "moved" && change.oldPath ? (
                <span className="text-base-content/70">
                  <span className="text-base-content/40">{change.oldPath}</span>
                  <span className="text-base-content/30 mx-0.5">{"\u2192"}</span>
                  {change.path}
                </span>
              ) : (
                <span className={change.changeType === "unchanged" ? "text-base-content/40" : "text-base-content/70"}>{change.path}</span>
              )}
            </a>
          ))}
        </div>
      )}

      {/* Diff area */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="alert alert-error text-sm m-4">
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-base-content/40 text-sm">
            <span className="loading loading-spinner loading-sm mr-2" />
            Computing diff...
          </div>
        )}

        {!loading && changes.length === 0 && !merged && <div className="flex items-center justify-center py-12 text-base-content/40 text-sm">No changes in this workspace</div>}

        {merged && !hasChanges && <div className="flex items-center justify-center py-12 text-success text-sm">All changes have been merged successfully.</div>}

        {changes.map((change) => {
          const key = change.originalUrl ?? change.cloneUrl ?? change.path;
          if (change.changeType === "unchanged") {
            return change.docType === "file" ? <UnchangedFileView key={key} change={change} /> : <UnchangedDocView key={key} change={change} />;
          }
          return change.docType === "file" ? <FileDiffView key={key} change={change} /> : <DocDiffView key={key} change={change} />;
        })}
      </div>

      {/* Merge footer */}
      {hasChanges && (
        <div className="px-4 py-3 border-t border-base-200 dark:border-base-content/10 flex items-center justify-end gap-2">
          <button className="btn btn-primary btn-sm" onClick={handleMerge} disabled={merging}>
            {merging ? (
              <>
                <span className="loading loading-spinner loading-xs" />
                Merging...
              </>
            ) : (
              "Merge all changes"
            )}
          </button>
        </div>
      )}
    </div>
  );
};

// ---- File diff card ----

function FileDiffView({ change }: { change: FileChange }) {
  const [collapsed, setCollapsed] = useState(false);

  const rows = computeFileDiffRows(change);

  return (
    <div id={`diff-${encodeURIComponent(change.path)}`} className="border-b border-base-200 dark:border-base-content/10">
      {/* File header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 dark:bg-base-content/5 cursor-pointer select-none sticky top-0 z-10" onClick={() => setCollapsed((c) => !c)}>
        <span className="text-xs text-base-content/40">{collapsed ? "\u25B6" : "\u25BC"}</span>
        <ChangeTypeBadge type={change.changeType} />
        <FilePathLabel change={change} />
        <DiffStats rows={rows} />
      </div>

      {/* Diff content */}
      {!collapsed && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {rows.map((row, i) => (
                <DiffRowView key={i} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!collapsed && rows.length === 0 && change.changeType === "moved" && <div className="px-4 py-3 text-xs text-base-content/40 italic">File moved (no content changes)</div>}
    </div>
  );
}

// ---- Doc diff card (non-file documents rendered via patchwork-view) ----

function DocDiffView({ change }: { change: FileChange }) {
  const [collapsed, setCollapsed] = useState(false);
  const repo = useRepo();

  const cloneUrl = change.cloneUrl;

  const cloneHandle = useDocHandle(cloneUrl);

  // Compute diff annotations and register with global context
  const annotations = useMemo(() => new AnnotationSet(), []);

  useEffect(() => {
    if (!cloneHandle) return;
    if (change.changeType === "added") return;
    if (change.changeType === "moved" && !change.cloneUrl) return;
    if (!change.originalUrlWithHeads) return;

    const { heads: encodedHeads } = parseAutomergeUrl(change.originalUrlWithHeads);
    if (!encodedHeads || encodedHeads.length === 0) return;

    const beforeHeads = decodeHeads(encodedHeads);
    const diffAnns = diffAnnotationsOfDoc(cloneHandle, beforeHeads);
    const docRef = ref(cloneHandle);
    const afterHeads = cloneHandle.heads();

    globalAnnotations.add(annotations);

    annotations.change(() => {
      annotations.clear();
      annotations.add(diffAnns);
      if (afterHeads) {
        annotations.add(docRef, ViewHeads({ beforeHeads, afterHeads }));
      }
    });

    return () => {
      annotations.clear();
      globalAnnotations.remove(annotations);
    };
  }, [cloneHandle, annotations, change.changeType, change.originalUrlWithHeads]);

  return (
    <div id={`diff-${encodeURIComponent(change.path)}`} className="border-b border-base-200 dark:border-base-content/10">
      {/* File header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 dark:bg-base-content/5 cursor-pointer select-none sticky top-0 z-10" onClick={() => setCollapsed((c) => !c)}>
        <span className="text-xs text-base-content/40">{collapsed ? "\u25B6" : "\u25BC"}</span>
        <ChangeTypeBadge type={change.changeType} />
        <FilePathLabel change={change} />
        <span className="text-xs text-base-content/30 ml-auto">{change.docType}</span>
      </div>

      {/* Document view */}
      {!collapsed && cloneUrl && (
        <div className="h-[400px] border border-base-200 dark:border-base-content/10 m-2 rounded overflow-hidden">
          <patchwork-view doc-url={cloneUrl} />
        </div>
      )}

      {!collapsed && !cloneUrl && change.changeType === "moved" && <div className="px-4 py-3 text-xs text-base-content/40 italic">Document moved (no content changes)</div>}

      {!collapsed && !cloneUrl && change.changeType !== "moved" && change.originalUrl && <div className="p-4 text-sm text-base-content/50 italic">Document deleted</div>}
    </div>
  );
}

// ---- Unchanged file card (text content, no diff coloring) ----

function UnchangedFileView({ change }: { change: FileChange }) {
  const [collapsed, setCollapsed] = useState(true);
  const repo = useRepo();
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (collapsed || !change.originalUrl) return;
    let cancelled = false;

    (async () => {
      try {
        const handle = await repo.find(change.originalUrl!);
        await handle.whenReady();
        const doc = handle.doc() as any;
        const text = typeof doc?.content === "string" ? doc.content : doc?.content instanceof Uint8Array ? new TextDecoder().decode(doc.content) : doc?.content !== undefined ? String(doc.content) : "";
        if (!cancelled) setContent(text);
      } catch {
        if (!cancelled) setContent("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [collapsed, repo, change.originalUrl]);

  return (
    <div id={`diff-${encodeURIComponent(change.originalUrl ?? change.path)}`} className="border-b border-base-200 dark:border-base-content/10">
      <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 dark:bg-base-content/5 cursor-pointer select-none sticky top-0 z-10" onClick={() => setCollapsed((c) => !c)}>
        <span className="text-xs text-base-content/40">{collapsed ? "\u25B6" : "\u25BC"}</span>
        <ChangeTypeBadge type={change.changeType} />
        <FilePathLabel change={change} />
      </div>

      {!collapsed && content !== null && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {content.split("\n").map((line, i, arr) => {
                if (i === arr.length - 1 && line === "") return null;
                return (
                  <tr key={i}>
                    <td className="w-10 text-right pr-2 select-none bg-base-200/20 dark:bg-base-content/3">
                      <span className="text-base-content/30">{i + 1}</span>
                    </td>
                    <td className="px-2 whitespace-pre">{line}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Unchanged doc card (non-file, rendered via patchwork-view) ----

function UnchangedDocView({ change }: { change: FileChange }) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div id={`diff-${encodeURIComponent(change.originalUrl ?? change.path)}`} className="border-b border-base-200 dark:border-base-content/10">
      <div className="flex items-center gap-2 px-4 py-2 bg-base-200/50 dark:bg-base-content/5 cursor-pointer select-none sticky top-0 z-10" onClick={() => setCollapsed((c) => !c)}>
        <span className="text-xs text-base-content/40">{collapsed ? "\u25B6" : "\u25BC"}</span>
        <ChangeTypeBadge type={change.changeType} />
        <FilePathLabel change={change} />
        <span className="text-xs text-base-content/30 ml-auto">{change.docType}</span>
      </div>

      {!collapsed && change.originalUrl && (
        <div className="h-[400px] border border-base-200 dark:border-base-content/10 m-2 rounded overflow-hidden">
          <patchwork-view doc-url={change.originalUrl} />
        </div>
      )}
    </div>
  );
}

function computeFileDiffRows(change: FileChange): DiffRow[] {
  if (change.changeType === "modified") {
    return computeSideBySideDiff(change.originalContent ?? "", change.modifiedContent ?? "");
  }

  if (change.changeType === "moved") {
    if (change.originalContent !== undefined && change.modifiedContent !== undefined && change.originalContent !== change.modifiedContent) {
      return computeSideBySideDiff(change.originalContent, change.modifiedContent);
    }
    return [];
  }

  if (change.changeType === "added") {
    const lines = (change.modifiedContent ?? "").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line, i) => ({
      left: { type: "spacer" as const, content: "" },
      right: { type: "added" as const, newLineNo: i + 1, content: line },
    }));
  }

  if (change.changeType === "deleted") {
    const lines = (change.originalContent ?? "").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line, i) => ({
      left: { type: "removed" as const, oldLineNo: i + 1, content: line },
      right: { type: "spacer" as const, content: "" },
    }));
  }

  return [];
}

// ---- Diff row rendering ----

function DiffRowView({ row }: { row: DiffRow }) {
  return (
    <tr>
      {/* Left gutter */}
      <td className={`w-10 text-right pr-2 select-none ${gutterBg(row.left.type)}`}>
        <span className="text-base-content/30">{row.left.oldLineNo ?? ""}</span>
      </td>
      {/* Left content */}
      <td className={`w-1/2 px-2 whitespace-pre ${lineBg(row.left.type)}`}>{row.left.content}</td>
      {/* Right gutter */}
      <td className={`w-10 text-right pr-2 select-none border-l border-base-200 dark:border-base-content/10 ${gutterBg(row.right.type)}`}>
        <span className="text-base-content/30">{row.right.newLineNo ?? ""}</span>
      </td>
      {/* Right content */}
      <td className={`w-1/2 px-2 whitespace-pre ${lineBg(row.right.type)}`}>{row.right.content}</td>
    </tr>
  );
}

function lineBg(type: string): string {
  switch (type) {
    case "added":
      return "bg-success/10";
    case "removed":
      return "bg-error/10";
    case "spacer":
      return "bg-base-200/30 dark:bg-base-content/3";
    default:
      return "";
  }
}

function gutterBg(type: string): string {
  switch (type) {
    case "added":
      return "bg-success/15";
    case "removed":
      return "bg-error/15";
    case "spacer":
      return "bg-base-200/40 dark:bg-base-content/5";
    default:
      return "bg-base-200/20 dark:bg-base-content/3";
  }
}

// ---- Small components ----

function FilePathLabel({ change }: { change: FileChange }) {
  if (change.changeType === "moved" && change.oldPath) {
    return (
      <span className="text-sm font-mono text-base-content/80">
        <span className="text-base-content/40">{change.oldPath}</span>
        <span className="text-base-content/30 mx-1">{"\u2192"}</span>
        {change.path}
      </span>
    );
  }
  return <span className="text-sm font-mono text-base-content/80">{change.path}</span>;
}

function ChangeTypeBadge({ type }: { type: FileChange["changeType"] }) {
  if (type === "unchanged") {
    return <span className="badge badge-xs badge-ghost font-bold">{"\u2013"}</span>;
  }

  const cls = type === "modified" ? "badge-warning" : type === "added" ? "badge-success" : type === "moved" ? "badge-info" : "badge-error";

  const label = type === "modified" ? "M" : type === "added" ? "A" : type === "moved" ? "R" : "D";

  return <span className={`badge badge-xs font-bold ${cls}`}>{label}</span>;
}

function DiffStats({ rows }: { rows: DiffRow[] }) {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.right.type === "added") added++;
    if (row.left.type === "removed") removed++;
  }

  return (
    <span className="text-xs text-base-content/40 ml-auto">
      {added > 0 && <span className="text-success">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-error">-{removed}</span>}
    </span>
  );
}

export const renderWorkspaceReview: ToolImplementation = toolify(WorkspaceReview);
