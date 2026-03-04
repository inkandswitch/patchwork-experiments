import {
  EditorAtom,
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  useEditor,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from '@tldraw/tldraw';
import React, { useCallback, useLayoutEffect, useRef } from 'react';

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
// DOM-driven sizing via EditorAtom + ResizeObserver
// ---------------------------------------------------------------------------

const TokenShapeSizes = new EditorAtom(
  'token shape sizes',
  (editor) => {
    const map = new Map<TLShapeId, { width: number; height: number }>();
    editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      TokenShapeSizes.update(editor, (m) => {
        if (!m.has(shape.id)) return m;
        const next = new Map(m);
        next.delete(shape.id);
        return next;
      });
    });
    return map;
  },
);

function useTokenShapeSize(shapeId: TLShapeId) {
  const ref = useRef<HTMLDivElement>(null);
  const editor = useEditor();

  const updateSize = useCallback(() => {
    if (!ref.current) return;
    const { offsetWidth: width, offsetHeight: height } = ref.current;
    TokenShapeSizes.update(editor, (map) => {
      const existing = map.get(shapeId);
      if (existing?.width === width && existing?.height === height) return map;
      const next = new Map(map);
      next.set(shapeId, { width, height });
      return next;
    });
  }, [editor, shapeId]);

  // Measure after every render
  useLayoutEffect(() => {
    updateSize();
  });

  // Watch for DOM size changes
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(updateSize);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [updateSize]);

  return ref;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function DocIcon() {
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

function ChevronIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared chip components (used by both canvas shapes and the EmbedShape titlebar)
// ---------------------------------------------------------------------------

export interface DocChipProps {
  docUrl: string;
  name: string;
  chipRef?: React.Ref<HTMLDivElement>;
  onDragEnd?: (e: React.DragEvent) => void;
}

export function DocChip({ docUrl, name, chipRef, onDragEnd }: DocChipProps) {
  return (
    <div
      ref={chipRef}
      draggable
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        setTokenDragData(e.dataTransfer, docUrl, { type: 'document', name });
      }}
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
        cursor: 'grab',
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
}

export function ToolChip({
  docUrl,
  name,
  path,
  chipRef,
  onDragEnd,
  hasDropdown,
  onPickerOpen,
}: ToolChipProps) {
  return (
    <div
      ref={chipRef}
      draggable
      onPointerDown={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        setTokenDragData(e.dataTransfer, docUrl, { type: 'tool', name, path: path ?? '' });
      }}
      onDragEnd={onDragEnd}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        height: '24px',
        padding: hasDropdown ? '0 28px 0 14px' : '0 14px',
        cursor: 'grab',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        pointerEvents: 'all',
        boxSizing: 'border-box',
      }}
    >
      {/* Rounded background with indigo border */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: '#eef2ff',
          borderRadius: '12px',
          border: '1px solid rgba(99,102,241,0.3)',
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
      {/* Chevron button — click opens picker, cursor: pointer only here */}
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

// ---------------------------------------------------------------------------
// tile-token-doc
// ---------------------------------------------------------------------------

export const DOC_TOKEN_SHAPE_TYPE = 'tile-token-doc' as const;

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    [DOC_TOKEN_SHAPE_TYPE]: {
      docUrl: string;
      name: string;
    };
  }
}

export type DocTokenShape = TLShape<typeof DOC_TOKEN_SHAPE_TYPE>;

function DocTokenComponent({ shape }: { shape: DocTokenShape }) {
  const { docUrl, name } = shape.props;
  const editor = useEditor();
  const sizeRef = useTokenShapeSize(shape.id);
  return (
    <HTMLContainer>
      <DocChip
        docUrl={docUrl}
        name={name}
        chipRef={sizeRef}
        onDragEnd={(e) => {
          if (e.dataTransfer.dropEffect !== 'none') {
            editor.deleteShapes([shape.id]);
          }
        }}
      />
    </HTMLContainer>
  );
}

export class DocTokenShapeUtil extends ShapeUtil<DocTokenShape> {
  static override type = DOC_TOKEN_SHAPE_TYPE;

  static override props: RecordProps<DocTokenShape> = {
    docUrl: T.string,
    name: T.string,
  };

  getDefaultProps(): DocTokenShape['props'] {
    return { docUrl: '', name: 'Untitled' };
  }

  getGeometry(shape: DocTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    return new Rectangle2d({ width: size?.width ?? 120, height: 24, isFilled: true });
  }

  override canResize() { return false; }
  override hideRotateHandle() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canCull() { return false; }

  component(shape: DocTokenShape) {
    return <DocTokenComponent shape={shape} />;
  }

  indicator(shape: DocTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    const w = size?.width ?? 120;
    return <rect width={w} height={24} rx={12} />;
  }
}

// ---------------------------------------------------------------------------
// tile-token-tool
// ---------------------------------------------------------------------------

export const TOOL_TOKEN_SHAPE_TYPE = 'tile-token-tool' as const;

declare module '@tldraw/tldraw' {
  export interface TLGlobalShapePropsMap {
    [TOOL_TOKEN_SHAPE_TYPE]: {
      docUrl: string;
      name: string;
      path: string;
    };
  }
}

export type ToolTokenShape = TLShape<typeof TOOL_TOKEN_SHAPE_TYPE>;

function ToolTokenComponent({ shape }: { shape: ToolTokenShape }) {
  const { docUrl, name, path } = shape.props;
  const editor = useEditor();
  const sizeRef = useTokenShapeSize(shape.id);
  return (
    <HTMLContainer>
      <ToolChip
        docUrl={docUrl}
        name={name}
        path={path}
        chipRef={sizeRef}
        onDragEnd={(e) => {
          if (e.dataTransfer.dropEffect !== 'none') {
            editor.deleteShapes([shape.id]);
          }
        }}
      />
    </HTMLContainer>
  );
}

export class ToolTokenShapeUtil extends ShapeUtil<ToolTokenShape> {
  static override type = TOOL_TOKEN_SHAPE_TYPE;

  static override props: RecordProps<ToolTokenShape> = {
    docUrl: T.string,
    name: T.string,
    path: T.string,
  };

  getDefaultProps(): ToolTokenShape['props'] {
    return { docUrl: '', name: 'Untitled', path: '' };
  }

  getGeometry(shape: ToolTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    return new Rectangle2d({ width: size?.width ?? 120, height: 24, isFilled: true });
  }

  override canResize() { return false; }
  override hideRotateHandle() { return true; }
  override hideSelectionBoundsBg() { return true; }
  override hideSelectionBoundsFg() { return true; }
  override canCull() { return false; }

  component(shape: ToolTokenShape) {
    return <ToolTokenComponent shape={shape} />;
  }

  indicator(shape: ToolTokenShape) {
    const size = TokenShapeSizes.get(this.editor).get(shape.id);
    const w = size?.width ?? 120;
    return <rect width={w} height={24} rx={12} />;
  }
}
