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
import { useMemo, useCallback, useRef, useEffect, useState, useContext } from 'react';
import {
  getSupportedToolsForType,
  getRegistry,
  type LoadedTool,
  type DatatypeDescription,
  type LoadedDatatype,
} from '@inkandswitch/patchwork-plugins';
import { openDocument } from '@inkandswitch/patchwork-elements';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';

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
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

// ---------------------------------------------------------------------------
// Mac OS 7.5 titlebar styling
// ---------------------------------------------------------------------------

// Horizontal lines with clear 1px gaps at top and bottom of the titlebar
// Mac OS 7.5 used light grey stripes, not black
const TITLEBAR_STRIPES = [
  'linear-gradient(#fff, #fff)',        // top clear line
  'linear-gradient(#fff, #fff)',        // bottom clear line
  'repeating-linear-gradient(#d0d0d0 0px, #d0d0d0 1px, transparent 1px, transparent 2px)',
].join(', ');

const TITLEBAR_BG_SIZE = '100% 1px, 100% 1px, 100% 100%';
const TITLEBAR_BG_POS = 'top, bottom, center';
const TITLEBAR_BG_REPEAT = 'no-repeat, no-repeat, repeat';

// ---------------------------------------------------------------------------
// Inner React component (so we can use hooks like useEditor)
// ---------------------------------------------------------------------------

async function loadDatatype(id: string): Promise<LoadedDatatype | undefined> {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return (await registry.load(id)) as unknown as LoadedDatatype | undefined;
  } catch {
    return undefined;
  }
}

function PatchworkDocComponent({ shape }: { shape: PatchworkDocShape }) {
  const { docUrl, docName, docType, toolId } = shape.props;
  const editor = useEditor();
  const repo = useContext(RepoContext);
  const tools = useSupportedToolsForDatatype(docType);
  const isSelectTool = useValue('is select tool', () => editor.getCurrentToolId() === 'select', [
    editor,
  ]);

  const [isEditingName, setIsEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the name input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  const handleToolChange = useCallback(
    (newToolId: string) => {
      editor.updateShape({
        id: shape.id,
        type: PATCHWORK_DOC_SHAPE_TYPE,
        props: { toolId: newToolId },
      } as any);
    },
    [editor, shape.id],
  );

  const handleOpenDocument = useCallback(() => {
    const el = containerRef.current;
    if (!el || !docUrl) return;
    console.log('[spatial-folder] patchwork:open-document', { url: docUrl, toolId: toolId || undefined });
    openDocument(el, docUrl as AutomergeUrl, toolId || undefined);
  }, [docUrl, toolId]);

  const handleRename = useCallback(
    async (newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === docName || !repo || !docUrl || !docType) {
        setIsEditingName(false);
        return;
      }

      // Set title on the child doc via its datatype
      const datatype = await loadDatatype(docType);
      if (datatype?.module.setTitle) {
        const childHandle = await repo.find(docUrl as any);
        childHandle.change((d: any) => {
          datatype.module.setTitle!(d, trimmed);
        });

        // Read back the canonical title
        const childDoc = childHandle.doc();
        const canonicalName = childDoc ? datatype.module.getTitle(childDoc) : trimmed;

        editor.updateShape({
          id: shape.id,
          type: PATCHWORK_DOC_SHAPE_TYPE,
          props: { docName: canonicalName },
        } as any);
      }

      setIsEditingName(false);
    },
    [editor, shape.id, docName, docUrl, docType, repo],
  );

  const effectiveToolId = toolId || '';

  const selectedTool = tools.find((t) => t.id === effectiveToolId);
  const pillLabel = selectedTool ? selectedTool.name : docType || '';

  return (
    <HTMLContainer>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '2px 2px 8px rgba(0,0,0,0.15)',
          border: '1px solid #ccc',
          background: '#ffffff',
          pointerEvents: 'all',
        }}
      >
      {/* ---- Mac OS 7.5 Titlebar ---- */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          padding: '3px 5px',
          backgroundImage: TITLEBAR_STRIPES,
          backgroundSize: TITLEBAR_BG_SIZE,
          backgroundPosition: TITLEBAR_BG_POS,
          backgroundRepeat: TITLEBAR_BG_REPEAT,
          backgroundColor: '#fff',
          borderBottom: '1px solid #ccc',
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
          minHeight: '22px',
        }}
      >
        {/* Open-document box (System 7 close-box style) */}
        <button
          title="Open document"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenDocument();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            width: '12px',
            height: '12px',
            border: '1px solid #999',
            background: '#fff',
            padding: 0,
            cursor: 'pointer',
            flexShrink: 0,
            zIndex: 1,
          }}
        />

        {/* Document name — absolutely centered over the titlebar */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            maxWidth: '70%',
            zIndex: 1,
          }}
        >
          {isEditingName ? (
            <input
              ref={nameInputRef}
              defaultValue={docName}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') handleRename((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setIsEditingName(false);
              }}
              onBlur={(e) => handleRename(e.target.value)}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: '"Chicago", "Geneva", system-ui, sans-serif',
                color: '#000',
                background: '#fff',
                border: 'none',
                padding: '0 6px',
                outline: 'none',
                textAlign: 'center',
                width: '100%',
              }}
            />
          ) : (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setIsEditingName(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#000',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: '"Chicago", "Geneva", system-ui, sans-serif',
                textAlign: 'center',
                padding: '0 6px',
                background: '#fff',
                cursor: 'text',
                display: 'block',
              }}
            >
              {docName}
            </span>
          )}
        </div>

        {/* Tool selector — pushed right */}
        <div style={{ position: 'relative', flexShrink: 0, marginLeft: 'auto', zIndex: 1 }}>
          <input
            list={`tool-list-${shape.id}`}
            defaultValue={effectiveToolId || pillLabel}
            placeholder={docType || 'tool id'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onFocus={(e) => {
              const input = e.target as HTMLInputElement;
              input.dataset.prev = input.value;
              input.value = '';
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                handleToolChange((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === 'Escape') {
                const input = e.target as HTMLInputElement;
                input.value = input.dataset.prev || '';
                input.blur();
              }
            }}
            onBlur={(e) => {
              const input = e.target as HTMLInputElement;
              const val = input.value.trim();
              if (val) {
                handleToolChange(val);
              } else {
                input.value = input.dataset.prev || '';
              }
            }}
            style={{
              fontSize: '10px',
              color: '#555',
              padding: '1px 4px',
              background: '#fff',
              border: '1px solid #ccc',
              fontFamily: '"Geneva", "Chicago", system-ui, sans-serif',
              outline: 'none',
              width: '90px',
              cursor: 'text',
            }}
          />
          <datalist id={`tool-list-${shape.id}`}>
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </datalist>
        </div>
      </div>

      {/* ---- Content area ---- */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          position: 'relative',
          pointerEvents: isSelectTool ? 'auto' : 'none',
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
              color: '#000',
              fontSize: '12px',
              fontFamily: '"Geneva", "Chicago", system-ui, sans-serif',
            }}
          >
            No document
          </div>
        )}
      </div>
      </div>
    </HTMLContainer>
  );
}
