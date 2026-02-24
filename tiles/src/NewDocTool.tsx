/**
 * NewDocTool — a tldraw tool that lets users draw a box to create a new
 * patchwork document of a chosen datatype.
 *
 * Adapted from spatial-folder/src/NewDocTool.tsx for the tiles canvas.
 * Creates patchwork-view shapes (with auto-selected toolId) instead of
 * patchwork-doc shapes.
 *
 * Exports:
 *   - NewDocShapeTool        — pass in Tldraw `tools` prop
 *   - newDocUiOverrides      — spread into Tldraw `overrides` prop
 *   - NewDocToolbar          — pass as Tldraw `components.Toolbar`
 *   - setNewDocToolContext()  — call once during init
 */

import {
  StateNode,
  createShapeId,
  DefaultToolbarContent,
  type TLPointerEventInfo,
  type TLUiOverrides,
  type TLUiToolsContextType,
  type Editor,
  useEditor,
  useValue,
  DefaultToolbar,
} from '@tldraw/tldraw';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Repo } from '@automerge/automerge-repo';
import {
  getRegistry,
  createDocOfDatatype2,
  type DatatypeDescription,
  type ToolDescription,
} from '@inkandswitch/patchwork-plugins';
import { PATCHWORK_VIEW_TYPE } from './PatchworkViewShape.tsx';

// ---------------------------------------------------------------------------
// Per-editor context
// ---------------------------------------------------------------------------

interface NewDocContext {
  repo: Repo;
}

const _contextByEditor = new WeakMap<Editor, NewDocContext>();
let _selectedDatatypeId = '';

export function setNewDocToolContext(repo: Repo, editor: Editor) {
  _contextByEditor.set(editor, { repo });
}

export function setSelectedDatatypeId(id: string) {
  _selectedDatatypeId = id;
}

// ---------------------------------------------------------------------------
// Datatype + tool helpers
// ---------------------------------------------------------------------------

function getListedDatatypeDescriptions(): DatatypeDescription[] {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return registry.filter((d) => !d.unlisted) as unknown as DatatypeDescription[];
  } catch {
    return [];
  }
}

function getDatatypeDescription(id: string): DatatypeDescription | undefined {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return registry.get(id);
  } catch {
    return undefined;
  }
}

function findToolForDatatype(datatypeId: string): string {
  try {
    const registry = getRegistry<ToolDescription>('patchwork:tool');
    const tools = registry.filter(
      (t) => t.supportedDatatypes === '*' || (Array.isArray(t.supportedDatatypes) && t.supportedDatatypes.includes(datatypeId)),
    );
    const specific = tools.find(
      (t) => Array.isArray(t.supportedDatatypes) && t.supportedDatatypes.includes(datatypeId),
    );
    if (specific) return specific.id;
    if (tools.length > 0) return tools[0].id;
  } catch {
    // ignore
  }
  return '';
}

// ---------------------------------------------------------------------------
// NewDocShapeTool — draws a preview rectangle, then creates a patchwork-view
// ---------------------------------------------------------------------------

export class NewDocShapeTool extends StateNode {
  static override id = 'new-doc';

  private startPoint = { x: 0, y: 0 };
  private previewId: ReturnType<typeof createShapeId> | null = null;

  override onPointerDown(_info: TLPointerEventInfo) {
    const { currentPagePoint } = this.editor.inputs;
    this.startPoint = { x: currentPagePoint.x, y: currentPagePoint.y };

    this.previewId = createShapeId();
    this.editor.createShape({
      id: this.previewId,
      type: 'geo',
      x: currentPagePoint.x,
      y: currentPagePoint.y,
      parentId: this.editor.getCurrentPageId(),
      props: {
        w: 1,
        h: 1,
        geo: 'rectangle',
        dash: 'dashed',
        fill: 'none',
      },
    });
  }

  override onPointerMove(_info: TLPointerEventInfo) {
    if (!this.previewId) return;

    const { currentPagePoint } = this.editor.inputs;
    const x = Math.min(this.startPoint.x, currentPagePoint.x);
    const y = Math.min(this.startPoint.y, currentPagePoint.y);
    const w = Math.max(1, Math.abs(currentPagePoint.x - this.startPoint.x));
    const h = Math.max(1, Math.abs(currentPagePoint.y - this.startPoint.y));

    this.editor.updateShape({
      id: this.previewId,
      type: 'geo',
      x,
      y,
      props: { w, h },
    });
  }

  override onCancel() {
    this.cleanup();
    this.editor.setCurrentTool('select');
  }

  override onInterrupt() {
    this.cleanup();
  }

  private cleanup() {
    if (this.previewId) {
      if (this.editor.getShape(this.previewId)) {
        this.editor.deleteShapes([this.previewId]);
      }
      this.previewId = null;
    }
  }

  override onPointerUp(_info: TLPointerEventInfo) {
    if (!this.previewId) return;

    const preview = this.editor.getShape(this.previewId);
    this.editor.deleteShapes([this.previewId]);
    this.previewId = null;

    if (!preview) {
      this.editor.setCurrentTool('select');
      return;
    }

    const px = (preview as any).x as number;
    const py = (preview as any).y as number;
    const pw = (preview as any).props.w as number;
    const ph = (preview as any).props.h as number;

    const finalW = Math.max(pw, 200);
    const finalH = Math.max(ph, 150);

    const ctx = _contextByEditor.get(this.editor);
    if (!ctx) {
      console.warn('[tiles] NewDocTool: context not set for this editor');
      this.editor.setCurrentTool('select');
      return;
    }

    const datatypeId = _selectedDatatypeId;
    if (!datatypeId) {
      console.warn('[tiles] NewDocTool: no datatype selected');
      this.editor.setCurrentTool('select');
      return;
    }

    const editor = this.editor;
    const shapeId = createShapeId();
    const { repo } = ctx;

    editor.createShape({
      id: shapeId,
      type: PATCHWORK_VIEW_TYPE,
      x: px,
      y: py,
      rotation: 0,
      parentId: editor.getCurrentPageId(),
      props: {
        w: finalW,
        h: finalH,
        docUrl: '',
        docName: 'Creating\u2026',
        toolId: '',
      },
    } as any);

    editor.setCurrentTool('select');
    editor.setSelectedShapes([shapeId]);

    (async () => {
      try {
        const datatype = getDatatypeDescription(datatypeId);
        if (!datatype) {
          throw new Error(`Could not find datatype: ${datatypeId}`);
        }

        const docHandle = await createDocOfDatatype2(datatype, repo);
        const docUrl = docHandle.url;
        const toolId = findToolForDatatype(datatypeId);

        editor.updateShape({
          id: shapeId,
          type: PATCHWORK_VIEW_TYPE,
          props: {
            docUrl,
            docName: datatype.name ?? datatypeId,
            toolId,
          },
        } as any);

        console.log('[tiles] new doc created:', datatypeId, docUrl, 'tool:', toolId);
      } catch (err) {
        console.error('[tiles] new doc creation failed:', err);
        editor.updateShape({
          id: shapeId,
          type: PATCHWORK_VIEW_TYPE,
          props: { docName: `Error creating ${datatypeId}` },
        } as any);
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// Tldraw UI overrides
// ---------------------------------------------------------------------------

export const newDocUiOverrides: TLUiOverrides = {
  tools(_editor: Editor, tools: TLUiToolsContextType) {
    tools['new-doc'] = {
      id: 'new-doc',
      icon: 'plus' as any,
      label: 'New document' as any,
      kbd: 'c',
      onSelect(_source) {
        _editor.setCurrentTool('new-doc');
      },
    };
    return tools;
  },
};

// ---------------------------------------------------------------------------
// Custom Toolbar — default tools + a "+" button with datatype dropdown
// ---------------------------------------------------------------------------

export function NewDocToolbar() {
  const editor = useEditor();
  const isActive = useValue('new-doc active', () => editor.getCurrentToolId() === 'new-doc', [
    editor,
  ]);

  const [datatypes, setDatatypes] = useState<DatatypeDescription[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const dt = getListedDatatypeDescriptions();
    setDatatypes(dt);
    if (dt.length > 0 && !_selectedDatatypeId) {
      _selectedDatatypeId = dt[0].id;
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inContainer && !inMenu) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [menuOpen]);

  const activateTool = useCallback(() => {
    if (datatypes.length > 0 && !_selectedDatatypeId) {
      _selectedDatatypeId = datatypes[0].id;
    }
    editor.setCurrentTool('new-doc');
  }, [datatypes, editor]);

  const openMenu = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.left + rect.width / 2, y: rect.top });
    }
    setMenuOpen(true);
  }, []);

  const handlePlusClick = useCallback(() => {
    if (!isActive) {
      activateTool();
    } else {
      if (menuOpen) {
        setMenuOpen(false);
      } else {
        openMenu();
      }
    }
  }, [isActive, activateTool, menuOpen, openMenu]);

  const handlePillClick = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
    } else {
      openMenu();
    }
  }, [menuOpen, openMenu]);

  const handlePickDatatype = useCallback(
    (id: string) => {
      setSelectedDatatypeId(id);
      setMenuOpen(false);
      editor.setCurrentTool('new-doc');
    },
    [editor],
  );

  if (datatypes.length === 0) {
    return (
      <DefaultToolbar>
        <DefaultToolbarContent />
      </DefaultToolbar>
    );
  }

  const selectedName = datatypes.find((d) => d.id === _selectedDatatypeId)?.name ?? 'document';

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />

      <div
        style={{
          width: '1px',
          height: '20px',
          background: '#ddd',
          margin: '0 4px',
          flexShrink: 0,
        }}
      />

      <div
        ref={containerRef}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {(isActive || hovering) && !menuOpen && (
          <button
            type="button"
            onClick={handlePillClick}
            style={{
              position: 'absolute',
              bottom: '100%',
              left: '50%',
              transform: 'translateX(-50%)',
              marginBottom: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 10px',
              background: '#e8f0fe',
              border: '1px solid #c4d7f2',
              borderRadius: '9999px',
              cursor: 'pointer',
              fontSize: '11px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              fontWeight: 500,
              color: '#2f80ed',
              whiteSpace: 'nowrap',
              lineHeight: '16px',
              zIndex: 10000,
            }}
          >
            {selectedName}
            {datatypes.length > 1 && (
              <svg width="8" height="8" viewBox="0 0 8 8" style={{ opacity: 0.6 }}>
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
          </button>
        )}

        <button
          ref={buttonRef}
          type="button"
          onClick={handlePlusClick}
          onPointerEnter={() => setHovering(true)}
          onPointerLeave={() => setHovering(false)}
          title="Create a new document (C)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '6px',
            background: isActive ? 'var(--color-selected, #e8f0fe)' : 'transparent',
            cursor: 'pointer',
            color: isActive ? 'var(--color-selected-contrast, #2f80ed)' : 'currentColor',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2v12M2 8h12"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {menuOpen &&
          datatypes.length > 1 &&
          menuPos &&
          createPortal(
            <div
              ref={menuRef}
              style={{
                position: 'fixed',
                left: menuPos.x,
                top: menuPos.y,
                transform: 'translate(-50%, -100%)',
                marginTop: '-8px',
                background: '#fff',
                border: '1px solid #ddd',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                padding: '4px',
                minWidth: '150px',
                zIndex: 100000,
              }}
            >
              {datatypes.map((dt) => (
                <button
                  key={dt.id}
                  type="button"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    handlePickDatatype(dt.id);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 10px',
                    border: 'none',
                    borderRadius: '4px',
                    background: dt.id === _selectedDatatypeId ? '#e8f0fe' : 'transparent',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    color: '#333',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                  }}
                  onPointerEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      dt.id === _selectedDatatypeId ? '#e8f0fe' : '#f5f5f5';
                  }}
                  onPointerLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      dt.id === _selectedDatatypeId ? '#e8f0fe' : 'transparent';
                  }}
                >
                  {dt.name}
                </button>
              ))}
            </div>,
            document.body,
          )}
      </div>
    </DefaultToolbar>
  );
}
