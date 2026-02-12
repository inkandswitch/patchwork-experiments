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

  // Resolve which toolId to show – fall back to first available tool
  const effectiveToolId = toolId || (tools.length > 0 ? tools[0].id : '');

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

        {/* Tool selector dropdown */}
        {tools.length > 1 ? (
          <select
            value={effectiveToolId}
            onChange={handleToolChange}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: '12px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              color: '#555',
              background: '#e8e8e8',
              border: '1px solid #d0d0d0',
              borderRadius: '4px',
              padding: '2px 6px',
              cursor: 'pointer',
              flexShrink: 0,
              maxWidth: '140px',
            }}
          >
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : tools.length === 1 ? (
          <span
            style={{
              fontSize: '11px',
              color: '#888',
              padding: '2px 8px',
              background: '#e8e8e8',
              borderRadius: '4px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              flexShrink: 0,
            }}
          >
            {tools[0].name}
          </span>
        ) : docType ? (
          <span
            style={{
              fontSize: '11px',
              color: '#888',
              padding: '2px 8px',
              background: '#e8e8e8',
              borderRadius: '4px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              flexShrink: 0,
            }}
          >
            {docType}
          </span>
        ) : null}
      </div>

      {/* ---- Patchwork view content ---- */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {docUrl ? (
          // @ts-expect-error Custom element from patchwork-elements
          <patchwork-view
            doc-url={docUrl}
            {...(effectiveToolId ? { 'tool-id': effectiveToolId } : {})}
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
