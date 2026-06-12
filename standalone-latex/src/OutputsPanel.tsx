import { useState } from "react";
import { FileCode2, FilePlus2, FileText, GripVertical, X } from "lucide-react";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  hasPatchworkDrop,
  parsePatchworkDrop,
  type OutputKind,
  type OutputTarget,
} from "./outputs";

/**
 * The outputs panel: where compiled output goes besides the preview.
 *
 *  - "New HTML/PDF document" creates a file doc wired to receive the
 *    compiled output; drag its chip into the sidebar to keep it (and open
 *    it anywhere as a live preview).
 *  - Dropping a Patchwork doc here writes the HTML into it — directly
 *    into `content` for file docs, or into a field you pick. (HTML only;
 *    we don't overwrite arbitrary slots with PDF bytes.)
 */
export function OutputsPanel({
  targets,
  busy,
  onNewDocument,
  onDropDoc,
  onRemove,
}: {
  targets: OutputTarget[];
  busy: boolean;
  onNewDocument: (kind: OutputKind) => void;
  onDropDoc: (url: AutomergeUrl, name?: string) => void;
  onRemove: (target: OutputTarget) => void;
}) {
  const [dragOver, setDragOver] = useState(0);

  return (
    <div
      className={`ltx-outputs${dragOver > 0 ? " drag-over" : ""}`}
      onDragEnter={(e) => {
        if (!hasPatchworkDrop(e.dataTransfer)) return;
        e.preventDefault();
        setDragOver((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (hasPatchworkDrop(e.dataTransfer)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasPatchworkDrop(e.dataTransfer)) return;
        setDragOver((n) => Math.max(0, n - 1));
      }}
      onDrop={(e) => {
        setDragOver(0);
        if (!e.dataTransfer) return;
        e.preventDefault();
        e.stopPropagation();
        for (const item of parsePatchworkDrop(e.dataTransfer)) {
          onDropDoc(item.url, item.name);
        }
      }}
    >
      <div className="ltx-outputs-head">
        <h3>Outputs</h3>
        <span>Compiled output is written to these documents as you type.</span>
      </div>

      {targets.length > 0 && (
        <ul className="ltx-target-list">
          {targets.map((t) => (
            <li
              key={`${t.kind}:${t.key}`}
              className={`ltx-target${t.error ? " errored" : ""}`}
              draggable
              title={
                t.error
                  ? `${t.title} — ${t.error}`
                  : "Drag into the sidebar (or another tool)"
              }
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "text/x-patchwork-urls",
                  JSON.stringify([t.docUrl])
                );
              }}
            >
              <GripVertical size={12} className="grip" />
              {t.kind === "pdf" ? (
                <FileText size={13} className="doc-icon pdf" />
              ) : (
                <FileCode2 size={13} className="doc-icon" />
              )}
              <span className="name">{t.title}</span>
              {t.path.length > 0 && t.path.join(".") !== "content" && (
                <span className="path">.{t.path.join(".")}</span>
              )}
              <span className={`dot${t.error ? " error" : ""}`} />
              <button
                className="ltx-icon-btn small"
                title="Disconnect"
                onClick={() => onRemove(t)}
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ltx-newdoc-row">
        <button
          className="ltx-btn new-doc"
          disabled={busy}
          onClick={() => onNewDocument("html")}
        >
          <FilePlus2 size={13} />
          New HTML doc
        </button>
        <button
          className="ltx-btn new-doc"
          disabled={busy}
          onClick={() => onNewDocument("pdf")}
        >
          <FilePlus2 size={13} />
          New PDF doc
        </button>
      </div>

      <div className="ltx-drop-hint">
        {dragOver > 0
          ? "Drop to connect"
          : "…or drop a document here to write the HTML into it"}
      </div>
    </div>
  );
}
