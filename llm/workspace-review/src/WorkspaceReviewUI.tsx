import { useCallback, useEffect, useRef, useState } from "react";
import { useDocument, useRepo } from "@automerge/automerge-repo-react-hooks";
import { toolify } from "@inkandswitch/patchwork-react";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl } from "@automerge/automerge-repo";
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

  const hasChanges = changes.length > 0;

  return (
    <div className="flex flex-col h-full bg-base-100 dark:bg-base-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-base-200 dark:border-base-content/10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Workspace Review</h2>
          {loading && (
            <span className="loading loading-spinner loading-xs" />
          )}
          {!loading && !hasChanges && !merged && (
            <span className="badge badge-xs badge-ghost">No changes</span>
          )}
          {!loading && hasChanges && (
            <span className="badge badge-xs badge-info">
              {changes.length} file{changes.length !== 1 ? "s" : ""} changed
            </span>
          )}
          {merged && (
            <span className="badge badge-xs badge-success">Merged</span>
          )}
        </div>
      </div>

      {/* File list summary */}
      {hasChanges && (
        <div className="px-4 py-2 border-b border-base-200 dark:border-base-content/10 flex flex-wrap gap-2">
          {changes.map((change) => (
            <a
              key={change.path}
              href={`#diff-${encodeURIComponent(change.path)}`}
              className="flex items-center gap-1 text-xs font-mono hover:underline"
            >
              <ChangeTypeBadge type={change.changeType} />
              <span className="text-base-content/70">{change.path}</span>
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

        {!loading && !hasChanges && !merged && (
          <div className="flex items-center justify-center py-12 text-base-content/40 text-sm">
            No changes in this workspace.
          </div>
        )}

        {merged && !hasChanges && (
          <div className="flex items-center justify-center py-12 text-success text-sm">
            All changes have been merged successfully.
          </div>
        )}

        {changes.map((change) => (
          <FileDiffView key={change.path} change={change} />
        ))}
      </div>

      {/* Merge footer */}
      {hasChanges && (
        <div className="px-4 py-3 border-t border-base-200 dark:border-base-content/10 flex items-center justify-end gap-2">
          <button
            className="btn btn-primary btn-sm"
            onClick={handleMerge}
            disabled={merging}
          >
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
    <div
      id={`diff-${encodeURIComponent(change.path)}`}
      className="border-b border-base-200 dark:border-base-content/10"
    >
      {/* File header */}
      <div
        className="flex items-center gap-2 px-4 py-2 bg-base-200/50 dark:bg-base-content/5 cursor-pointer select-none sticky top-0 z-10"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="text-xs text-base-content/40">
          {collapsed ? "\u25B6" : "\u25BC"}
        </span>
        <ChangeTypeBadge type={change.changeType} />
        <span className="text-sm font-mono text-base-content/80">
          {change.path}
        </span>
        <DiffStats rows={rows} />
      </div>

      {/* Diff content */}
      {!collapsed && (
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
    </div>
  );
}

function computeFileDiffRows(change: FileChange): DiffRow[] {
  if (change.changeType === "modified") {
    return computeSideBySideDiff(
      change.originalContent ?? "",
      change.modifiedContent ?? ""
    );
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
        <span className="text-base-content/30">
          {row.left.oldLineNo ?? ""}
        </span>
      </td>
      {/* Left content */}
      <td className={`w-1/2 px-2 whitespace-pre ${lineBg(row.left.type)}`}>
        {row.left.content}
      </td>
      {/* Right gutter */}
      <td className={`w-10 text-right pr-2 select-none border-l border-base-200 dark:border-base-content/10 ${gutterBg(row.right.type)}`}>
        <span className="text-base-content/30">
          {row.right.newLineNo ?? ""}
        </span>
      </td>
      {/* Right content */}
      <td className={`w-1/2 px-2 whitespace-pre ${lineBg(row.right.type)}`}>
        {row.right.content}
      </td>
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

function ChangeTypeBadge({ type }: { type: FileChange["changeType"] }) {
  const cls =
    type === "modified"
      ? "badge-warning"
      : type === "added"
        ? "badge-success"
        : "badge-error";

  const label =
    type === "modified" ? "M" : type === "added" ? "A" : "D";

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

export const renderWorkspaceReview: ToolImplementation =
  toolify(WorkspaceReview);
