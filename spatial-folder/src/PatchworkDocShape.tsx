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
} from 'tldraw';

export const PATCHWORK_DOC_SHAPE_TYPE = 'patchwork-doc' as const;

// Register the shape's props in tldraw's global type system
declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [PATCHWORK_DOC_SHAPE_TYPE]: {
      w: number;
      h: number;
      docUrl: string;
      docName: string;
      docType: string;
    };
  }
}

export type PatchworkDocShape = TLShape<typeof PATCHWORK_DOC_SHAPE_TYPE>;

export class PatchworkDocShapeUtil extends ShapeUtil<PatchworkDocShape> {
  static override type = PATCHWORK_DOC_SHAPE_TYPE;

  static override props: RecordProps<PatchworkDocShape> = {
    w: T.number,
    h: T.number,
    docUrl: T.string,
    docName: T.string,
    docType: T.string,
  };

  getDefaultProps(): PatchworkDocShape['props'] {
    return {
      w: 400,
      h: 300,
      docUrl: '',
      docName: 'Untitled',
      docType: '',
    };
  }

  // Geometry for hit-testing & bounds
  getGeometry(shape: PatchworkDocShape): Geometry2d {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  // Allow resize but not rotation
  override canResize() {
    return true;
  }

  override canEdit() {
    return false;
  }

  override isAspectRatioLocked() {
    return false;
  }

  // Hide the rotation handle so documents can't be rotated
  override hideRotateHandle() {
    return true;
  }

  override onResize(shape: any, info: TLResizeInfo<any>) {
    return resizeBox(shape, info);
  }

  component(shape: PatchworkDocShape) {
    const { docUrl, docName, docType } = shape.props;

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
        {/* Titlebar – the drag handle for moving the shape */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            background: '#f5f5f5',
            borderBottom: '1px solid #e0e0e0',
            cursor: 'grab',
            userSelect: 'none',
            flexShrink: 0,
            minHeight: '32px',
          }}
        >
          <span
            style={{
              fontSize: '13px',
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
          {docType && (
            <span
              style={{
                fontSize: '10px',
                color: '#888',
                padding: '1px 6px',
                background: '#e8e8e8',
                borderRadius: '4px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                flexShrink: 0,
              }}
            >
              {docType}
            </span>
          )}
        </div>

        {/* Patchwork view content */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
          }}
          // Stop pointer events from reaching tldraw so embedded
          // views stay interactive when the shape is selected
          onPointerDown={(e) => e.stopPropagation()}
        >
          {docUrl ? (
            // @ts-expect-error Custom element from patchwork-elements
            <patchwork-view
              doc-url={docUrl}
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

  indicator(shape: PatchworkDocShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }
}
