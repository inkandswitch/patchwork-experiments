import React from 'react';

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

export const PATCHWORK_TOKEN_MIME = 'text/x-patchwork-token' as const;
export const PATCHWORK_URLS_MIME = 'text/x-patchwork-urls' as const;

export interface PatchworkTokenData {
  type: 'document' | 'tool';
  name: string;
  path?: string;
}

export function setTokenDragData(
  dt: DataTransfer,
  docUrl: string,
  token: PatchworkTokenData,
) {
  dt.effectAllowed = 'move';
  dt.setData(PATCHWORK_URLS_MIME, JSON.stringify([docUrl]));
  dt.setData(PATCHWORK_TOKEN_MIME, JSON.stringify(token));
}

export function getTokenDragData(dt: DataTransfer): PatchworkTokenData | null {
  const raw = dt.getData(PATCHWORK_TOKEN_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PatchworkTokenData;
  } catch {
    return null;
  }
}

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
      <path
        d="M9.5 1.5a2 2 0 0 0-2.8 2.8L1.5 9.5a.7.7 0 0 0 1 1l5.2-5.2A2 2 0 0 0 9.5 1.5z"
        stroke="#6366f1"
        strokeWidth="1"
        fill="none"
      />
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
  onDragEnd?: (e: React.DragEvent) => void;
  /** Set to false to disable the chip's own drag behaviour (e.g. when a parent handles drag). Default: true. */
  draggable?: boolean;
}

export function DocChip({ docUrl, name, chipRef, onDragEnd, draggable = true }: DocChipProps) {
  return (
    <div
      ref={chipRef}
      draggable={draggable}
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={draggable ? (e) => {
        setTokenDragData(e.dataTransfer, docUrl, { type: 'document', name });
      } : undefined}
      onDragEnd={onDragEnd}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '24px',
        padding: '0 10px',
        background: '#ffffff',
        borderRadius: '12px',
        border: '1px solid rgba(0,0,0,0.12)',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 500,
        color: '#374151',
        cursor: draggable ? 'grab' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        pointerEvents: 'all',
        boxSizing: 'border-box',
      }}
    >
      <DocIcon />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
    </div>
  );
}

export interface ToolChipProps {
  docUrl: string;
  name: string;
  path?: string;
  chipRef?: React.Ref<HTMLDivElement>;
  onDragEnd?: (e: React.DragEvent) => void;
  hasDropdown?: boolean;
  onPickerOpen?: () => void;
  /** Set to false to disable the chip's own drag behaviour (e.g. when a parent handles drag). Default: true. */
  draggable?: boolean;
}

export function ToolChip({
  docUrl,
  name,
  path,
  chipRef,
  onDragEnd,
  hasDropdown,
  onPickerOpen,
  draggable = true,
}: ToolChipProps) {
  return (
    <div
      ref={chipRef}
      draggable={draggable}
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={draggable ? (e) => {
        setTokenDragData(e.dataTransfer, docUrl, { type: 'tool', name, path: path ?? '' });
      } : undefined}
      onDragEnd={onDragEnd}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        height: '24px',
        padding: hasDropdown ? '0 28px 0 14px' : '0 14px',
        cursor: draggable ? 'grab' : 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        pointerEvents: 'all',
        boxSizing: 'border-box',
      }}
    >
      {/* Rounded background with indigo border + shadow to match DocChip */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#eef2ff',
          borderRadius: '12px',
          border: '1px solid rgba(99,102,241,0.3)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
          pointerEvents: 'none',
        }}
      />
      {/* Text content */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          fontSize: '12px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontWeight: 500,
          color: '#3730a3',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      >
        <ToolIcon />
        <span>{name}</span>
      </div>
      {/* Chevron button — click opens picker */}
      {hasDropdown && (
        <button
          type="button"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
          onClick={(e) => { e.stopPropagation(); onPickerOpen?.(); }}
          style={{
            position: 'absolute',
            right: '6px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            color: '#6366f1',
            zIndex: 2,
          }}
        >
          <ChevronIcon />
        </button>
      )}
    </div>
  );
}
