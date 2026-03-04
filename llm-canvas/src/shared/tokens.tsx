import React, { useCallback } from "react";
import { setDragData } from "./dnd/helpers.ts";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

export function DocIcon() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="10" height="12" rx="1.5" stroke="#9ca3af" strokeWidth="1" fill="none" />
      <path d="M2.5 4h6M2.5 6.5h6M2.5 9h4" stroke="#9ca3af" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function ToolIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
      <path d="M9.5 1.5a2 2 0 0 0-2.8 2.8L1.5 9.5a.7.7 0 0 0 1 1l5.2-5.2A2 2 0 0 0 9.5 1.5z" stroke="#6366f1" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Chip components
// ---------------------------------------------------------------------------

export interface DocChipProps {
  docUrl: string;
  name: string;
  chipRef?: React.Ref<HTMLDivElement>;
  onDragEnd?: (e: DragEvent) => void;
  onDelete?: () => void;
  dragEffect?: "copy" | "move";
  /** Set to false to disable the chip's own drag behaviour. Default: true. */
  draggable?: boolean;
}

export function DocChip({ docUrl, name, chipRef, onDragEnd, onDelete, dragEffect = "copy", draggable = true }: DocChipProps) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof chipRef === "function") chipRef(node!);
      else if (chipRef) (chipRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (!node) return;

      node.addEventListener("pointerdown", (e) => e.stopPropagation());
      if (!draggable) return;

      node.addEventListener("dragstart", (e: DragEvent) => {
        setDragData(e.dataTransfer!, { type: "document", url: docUrl, name }, dragEffect);
      });
      if (onDragEnd) node.addEventListener("dragend", onDragEnd);
    },
    [docUrl, name, draggable, dragEffect, onDragEnd, chipRef],
  );

  return (
    <div
      ref={ref}
      draggable={draggable}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        height: "24px",
        padding: onDelete ? "0 4px 0 10px" : "0 10px",
        background: "#ffffff",
        borderRadius: "12px",
        border: "1px solid rgba(0,0,0,0.12)",
        fontSize: "12px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontWeight: 500,
        color: "#374151",
        cursor: draggable ? "grab" : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
        pointerEvents: "all",
        boxSizing: "border-box",
      }}
    >
      <DocIcon />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {onDelete && <DeleteButton onDelete={onDelete} />}
    </div>
  );
}

export interface ToolChipProps {
  docUrl: string;
  name: string;
  path?: string;
  chipRef?: React.Ref<HTMLDivElement>;
  onDragEnd?: (e: React.DragEvent) => void;
  onDelete?: () => void;
  dragEffect?: "copy" | "move";
  hasDropdown?: boolean;
  onPickerOpen?: () => void;
  /** Set to false to disable the chip's own drag behaviour. Default: true. */
  draggable?: boolean;
}

export function ToolChip({ docUrl, name, path, chipRef, onDragEnd, onDelete, dragEffect = "copy", hasDropdown, onPickerOpen, draggable = true }: ToolChipProps) {
  const paddingRight = hasDropdown ? "28px" : onDelete ? "4px" : "14px";

  return (
    <div
      ref={chipRef}
      draggable={draggable}
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={
        draggable
          ? (e) => {
              setDragData(e.dataTransfer, { type: "tool", url: docUrl, name, path: path ?? "" }, dragEffect);
            }
          : undefined
      }
      onDragEnd={onDragEnd}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        height: "24px",
        padding: `0 ${paddingRight} 0 14px`,
        cursor: draggable ? "grab" : "default",
        userSelect: "none",
        whiteSpace: "nowrap",
        pointerEvents: "all",
        boxSizing: "border-box",
      }}
    >
      {/* Rounded background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#eef2ff",
          borderRadius: "12px",
          border: "1px solid rgba(99,102,241,0.3)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.10)",
          pointerEvents: "none",
        }}
      />
      {/* Text content */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "12px",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontWeight: 500,
          color: "#3730a3",
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        <ToolIcon />
        <span>{name}</span>
      </div>
      {/* Chevron button */}
      {hasDropdown && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onPickerOpen?.();
          }}
          style={{
            position: "absolute",
            right: "6px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            color: "#6366f1",
            zIndex: 2,
          }}
        >
          <ChevronIcon />
        </button>
      )}
      {/* Delete button */}
      {onDelete && !hasDropdown && (
        <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center" }}>
          <DeleteButton onDelete={onDelete} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared delete button
// ---------------------------------------------------------------------------

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onDelete();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        height: "16px",
        borderRadius: "50%",
        border: "none",
        background: "transparent",
        color: "#9ca3af",
        fontSize: "12px",
        lineHeight: 1,
        padding: 0,
        cursor: "pointer",
        flexShrink: 0,
      }}
      title="Remove"
    >
      ×
    </button>
  );
}
