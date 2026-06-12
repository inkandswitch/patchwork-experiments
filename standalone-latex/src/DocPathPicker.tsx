import { useState } from "react";
import { X } from "lucide-react";
import { isStringLeaf } from "./outputs";

/**
 * Shown when a dropped Patchwork doc isn't a plain file doc: renders the
 * document structure as an outline so the user can pick which string slot
 * the compiled HTML should be written into.
 */
export function DocPathPicker({
  title,
  doc,
  onPick,
  onCancel,
}: {
  title: string;
  doc: unknown;
  onPick: (path: string[]) => void;
  onCancel: () => void;
}) {
  return (
    <div className="ltx-modal-backdrop" onClick={onCancel}>
      <div className="ltx-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ltx-modal-header">
          <div>
            <h3>{title}</h3>
            <p>Pick the text field the compiled HTML should be written into.</p>
          </div>
          <button className="ltx-icon-btn" onClick={onCancel} title="Cancel">
            <X size={14} />
          </button>
        </div>
        <div className="ltx-modal-body">
          <DocTree value={doc} path={[]} depth={0} onPick={onPick} />
        </div>
        <div className="ltx-modal-footer">
          <button className="ltx-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

const MAX_CHILDREN = 100;

function previewOf(value: unknown): string {
  if (isStringLeaf(value)) {
    const s = String(value).replace(/\s+/g, " ").trim();
    return s.length > 70 ? `${s.slice(0, 70)}…` : s;
  }
  if (value instanceof Uint8Array) return `${value.byteLength} bytes`;
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  return `{${Object.keys(value as object).length}}`;
}

function entriesOf(value: unknown): [string, unknown][] {
  if (value == null || typeof value !== "object") return [];
  if (value instanceof Uint8Array || isStringLeaf(value)) return [];
  if (Array.isArray(value)) {
    return value.slice(0, MAX_CHILDREN).map((item, i) => [String(i), item]);
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "@patchwork")
    .slice(0, MAX_CHILDREN);
}

function DocTree({
  value,
  path,
  depth,
  onPick,
}: {
  value: unknown;
  path: string[];
  depth: number;
  onPick: (path: string[]) => void;
}) {
  return (
    <ul className="ltx-tree">
      {entriesOf(value).map(([name, child]) => (
        <TreeNode
          key={name}
          name={name}
          value={child}
          parentPath={path}
          depth={depth}
          onPick={onPick}
        />
      ))}
    </ul>
  );
}

function TreeNode({
  name,
  value,
  parentPath,
  depth,
  onPick,
}: {
  name: string;
  value: unknown;
  parentPath: string[];
  depth: number;
  onPick: (path: string[]) => void;
}) {
  const path = [...parentPath, name];
  const isBranch =
    value != null &&
    typeof value === "object" &&
    !(value instanceof Uint8Array) &&
    !isStringLeaf(value);
  const pickable = isStringLeaf(value);
  const [open, setOpen] = useState(depth < 1);

  return (
    <li>
      <div
        className={`ltx-tree-row${pickable ? " pickable" : ""}`}
        onClick={() => {
          if (pickable) onPick(path);
          else if (isBranch) setOpen((o) => !o);
        }}
      >
        <span className="twisty">{isBranch ? (open ? "▾" : "▸") : ""}</span>
        <span className="key">{name}</span>
        <span className="preview">{previewOf(value)}</span>
        {pickable && <span className="use">Write here</span>}
      </div>
      {isBranch && open && (
        <DocTree value={value} path={path} depth={depth + 1} onPick={onPick} />
      )}
    </li>
  );
}
