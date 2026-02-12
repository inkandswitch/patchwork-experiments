import {
  Geometry2d,
  HTMLContainer,
  RecordProps,
  Rectangle2d,
  ShapeUtil,
  T,
  TLResizeInfo,
  TLShape,
  resizeBox,
  useEditor,
  useValue,
} from 'tldraw';
import { useMemo, useCallback } from 'react';
import { getSupportedToolsForType, type LoadedTool } from '@inkandswitch/patchwork-plugins';

export const PATCHWORK_DOC_SHAPE_TYPE = 'patchwork-doc' as const;

// ---------------------------------------------------------------------------
// Module augmentation – register the shape props in tldraw's type system
// ---------------------------------------------------------------------------

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_DOC_SHAPE_TYPE]: {
      w: number;
      h: number;
      docUrl: string;
      docName: string;
      docType: string;
      toolId: string;
    };
  }
}

export type PatchworkDocShape = TLShape<typeof PATCHWORK_DOC_SHAPE_TYPE>;

// ---------------------------------------------------------------------------
// useSupportedToolsForDatatype – React hook
// ---------------------------------------------------------------------------

export function useSupportedToolsForDatatype(datatype: string): LoadedTool[] {
  return useMemo(() => {
    if (!datatype) return [];
    try {
      return getSupportedToolsForType(datatype);
    } catch {
      return [];
    }
  }, [datatype]);
}

// ---------------------------------------------------------------------------
// ShapeUtil
// ---------------------------------------------------------------------------

export class PatchworkDocShapeUtil extends ShapeUtil<PatchworkDocShape> {
  static override type = PATCHWORK_DOC_SHAPE_TYPE;

  static override props: RecordProps<PatchworkDocShape> = {
    w: T.number,
    h: T.number,
    docUrl: T.string,
    docName: T.string,
    docType: T.string,
    toolId: T.string,
  };

  getDefaultProps(): PatchworkDocShape['props'] {
    return {
      w: 640,
      h: 480,
      docUrl: '',
      docName: 'Untitled',
      docType: '',
      toolId: '',
    };
  }

  getGeometry(shape: PatchworkDocShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override canResize() {
    return true;
  }
  override canEdit() {
    return false;
  }
  override isAspectRatioLocked() {
    return false;
  }
  override hideRotateHandle() {
    return true;
  }

  override onResize(shape: any, info: TLResizeInfo<any>) {
    return resizeBox(shape, info);
  }

  component(shape: PatchworkDocShape) {
    return <PatchworkDocComponent shape={shape} />;
  }

  indicator(shape: PatchworkDocShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}

// ---------------------------------------------------------------------------
// Inner React component (so we can use hooks like useEditor)
// ---------------------------------------------------------------------------

function PatchworkDocComponent({ shape }: { shape: PatchworkDocShape }) {
  const { docUrl, docName, docType, toolId } = shape.props;
  const editor = useEditor();
  const tools = useSupportedToolsForDatatype(docType);
  const isSelectTool = useValue('is select tool', () => editor.getCurrentToolId() === 'select', [
    editor,
  ]);

  const handleToolChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      e.stopPropagation();
      const newToolId = e.target.value;
      editor.updateShape({
        id: shape.id,
        type: PATCHWORK_DOC_SHAPE_TYPE,
        props: { toolId: newToolId },
      } as any);
    },
    [editor, shape.id],
  );

  // Only pass tool-id once the user has explicitly picked one
  const effectiveToolId = toolId || '';

  // Label for the pill: show selected tool name, or the docType fallback
  const selectedTool = tools.find((t) => t.id === effectiveToolId);
  const pillLabel = selectedTool ? selectedTool.name : docType || '';

  return (
    <HTMLContainer
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '8px',
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        border: '1px solid #e0e0e0',
        background: '#ffffff',
        pointerEvents: 'all',
      }}
    >
      {/* ---- Titlebar ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          background: '#f5f5f5',
          borderBottom: '1px solid #e0e0e0',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
          minHeight: '44px',
        }}
      >
        {/* Document name */}
        <span
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#333',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {docName}
        </span>

        {/* Tool selector pill */}
        {pillLabel && (
          <div
            style={{
              position: 'relative',
              flexShrink: 0,
            }}
          >
            {/* Visible pill label */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: '#666',
                padding: '2px 8px',
                background: '#e8e8e8',
                borderRadius: '9999px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {pillLabel}
              {tools.length > 1 && (
                <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.5 }}>
                  <path
                    d="M1 2.5L4 5.5L7 2.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>

            {/* Invisible native select overlaid on the pill for interaction */}
            {tools.length > 1 && (
              <select
                value={effectiveToolId}
                onChange={handleToolChange}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                {!effectiveToolId && <option value="">{docType} (default)</option>}
                {tools.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ---- Patchwork view content ---- */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
        onPointerDown={isSelectTool ? (e) => e.stopPropagation() : undefined}
      >
        {docUrl ? (
          // @ts-expect-error Custom element from patchwork-elements
          <patchwork-view
            doc-url={docUrl}
            {...(effectiveToolId ? { 'tool-id': effectiveToolId } : {})}
            key={effectiveToolId || 'default'}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
            }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#999',
              fontSize: '14px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            No document
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
