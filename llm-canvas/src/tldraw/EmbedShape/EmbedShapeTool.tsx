/**
 * EmbedShapeTool — a tldraw tool that lets users draw a box to create a new
 * embedded patchwork document of a chosen datatype.
 *
 * Exports:
 *   - EmbedShapeTool         — pass in Tldraw `tools` prop
 *   - embedUiOverrides        — spread into Tldraw `overrides` prop
 *   - EmbedToolbar            — pass as Tldraw `components.Toolbar`
 *   - setEmbedToolContext()   — call once per editor during init
 */

import {
  StateNode,
  createShapeId,
  DefaultToolbar,
  DefaultToolbarContent,
  type TLPointerEventInfo,
  type TLUiOverrides,
  type TLUiToolsContextType,
  type Editor,
  useEditor,
  useValue,
} from '@tldraw/tldraw';
import { useState, useCallback, useRef } from 'react';
import {
  getRegistry,
  createDocOfDatatype2,
  getSupportedToolsForType,
  type DatatypeDescription,
  type ToolElement,
} from '@inkandswitch/patchwork-plugins';
import { EMBED_SHAPE_TYPE, makeEmbedShapeId } from './EmbedShapeUtil.tsx';
import { EmbedShapeMenu, getListedDatatypes } from './EmbedShapeMenu.tsx';

// ---------------------------------------------------------------------------
// Per-editor context — keyed by editor instance to support nested canvases
// ---------------------------------------------------------------------------

interface EmbedToolContext {
  element: ToolElement;
}

const _contextByEditor = new WeakMap<Editor, EmbedToolContext>();
let _selectedDatatypeId = '';

export function setEmbedToolContext(element: ToolElement, editor: Editor) {
  _contextByEditor.set(editor, { element });
}

// ---------------------------------------------------------------------------
// Datatype helpers
// ---------------------------------------------------------------------------

export async function loadDatatype(id: string) {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return (await registry.load(id)) as any;
  } catch {
    return undefined;
  }
}

/**
 * Returns the id of the best default tool for `datatypeId`.
 * Prefers tools that explicitly list the datatype over wildcard ("*") tools.
 */
export function getDefaultToolId(datatypeId: string): string {
  const tools = getSupportedToolsForType(datatypeId).filter((t) => !(t as any).unlisted);
  const specific = tools.find((t) => {
    const supported = (t as any).supportedDatatypes;
    return Array.isArray(supported) && supported.includes(datatypeId);
  });
  return (specific ?? tools[0])?.id ?? '';
}

// ---------------------------------------------------------------------------
// EmbedShapeTool — draws a preview rect and creates an embed shape on release
// ---------------------------------------------------------------------------

export class EmbedShapeTool extends StateNode {
  static override id = 'embed';

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
      props: { w: 1, h: 1, geo: 'rectangle', dash: 'dashed', fill: 'none' },
    });
  }

  override onPointerMove(_info: TLPointerEventInfo) {
    if (!this.previewId) return;
    const { currentPagePoint } = this.editor.inputs;
    const x = Math.min(this.startPoint.x, currentPagePoint.x);
    const y = Math.min(this.startPoint.y, currentPagePoint.y);
    const w = Math.max(1, Math.abs(currentPagePoint.x - this.startPoint.x));
    const h = Math.max(1, Math.abs(currentPagePoint.y - this.startPoint.y));
    this.editor.updateShape({ id: this.previewId, type: 'geo', x, y, props: { w, h } });
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

    const finalW = Math.max(pw, 240);
    const finalH = Math.max(ph, 180);

    const ctx = _contextByEditor.get(this.editor);
    if (!ctx) {
      console.warn('[llm-canvas] EmbedShapeTool: context not set for this editor');
      this.editor.setCurrentTool('select');
      return;
    }

    const datatypeId = _selectedDatatypeId;
    if (!datatypeId) {
      console.warn('[llm-canvas] EmbedShapeTool: no datatype selected');
      this.editor.setCurrentTool('select');
      return;
    }

    const editor = this.editor;
    const placeholderId = createShapeId();
    const { repo, hive } = ctx.element;

    editor.createShape({
      id: placeholderId,
      type: EMBED_SHAPE_TYPE,
      x: px,
      y: py,
      rotation: 0,
      parentId: editor.getCurrentPageId(),
      props: {
        w: finalW,
        h: finalH,
        docUrl: '',
        docName: 'Creating\u2026',
        docType: datatypeId,
        toolId: '',
      },
    } as any);

    editor.setCurrentTool('select');
    editor.setSelectedShapes([placeholderId]);

    (async () => {
      try {
        const datatype = await loadDatatype(datatypeId);
        if (!datatype) throw new Error(`Could not load datatype: ${datatypeId}`);

        const docHandle = await (createDocOfDatatype2 as any)(datatype, repo, undefined, hive);
        const docUrl = docHandle.url;
        const deterministicId = makeEmbedShapeId(docUrl);

        // Prefer a tool that explicitly supports this datatype; fall back to wildcards.
        const defaultToolId = getDefaultToolId(datatypeId);

        const tempShape = editor.getShape(placeholderId) as any;
        const sx = tempShape?.x ?? px;
        const sy = tempShape?.y ?? py;
        const sw = tempShape?.props?.w ?? finalW;
        const sh = tempShape?.props?.h ?? finalH;

        if (editor.getShape(placeholderId)) {
          editor.deleteShapes([placeholderId]);
        }

        if (editor.getShape(deterministicId)) {
          editor.updateShape({
            id: deterministicId,
            type: EMBED_SHAPE_TYPE,
            props: {
              docUrl,
              docName: datatype.name ?? datatypeId,
              docType: datatypeId,
              toolId: defaultToolId,
            },
          } as any);
        } else {
          editor.createShape({
            id: deterministicId,
            type: EMBED_SHAPE_TYPE,
            x: sx,
            y: sy,
            rotation: 0,
            parentId: editor.getCurrentPageId(),
            props: {
              w: sw,
              h: sh,
              docUrl,
              docName: datatype.name ?? datatypeId,
              docType: datatypeId,
              toolId: defaultToolId,
            },
          } as any);
        }

        editor.setSelectedShapes([deterministicId]);
      } catch (err) {
        console.error('[llm-canvas] EmbedShapeTool: doc creation failed:', err);
        if (editor.getShape(placeholderId)) {
          editor.updateShape({
            id: placeholderId,
            type: EMBED_SHAPE_TYPE,
            props: { docName: `Error` },
          } as any);
        }
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// UI overrides — registers 'embed' in the tldraw tools context
// ---------------------------------------------------------------------------

export const embedUiOverrides: TLUiOverrides = {
  tools(_editor: Editor, tools: TLUiToolsContextType) {
    tools['embed'] = {
      id: 'embed',
      icon: 'plus' as any,
      label: 'Embed document' as any,
      onSelect() { _editor.setCurrentTool('embed'); },
    };
    return tools;
  },
};

// ---------------------------------------------------------------------------
// EmbedToolbar — default toolbar + a "+" button that opens the picker first
// ---------------------------------------------------------------------------

export function EmbedToolbar() {
  const editor = useEditor();
  const isActive = useValue('embed active', () => editor.getCurrentToolId() === 'embed', [editor]);

  const [datatypes, setDatatypes] = useState<DatatypeDescription[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState(_selectedDatatypeId);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handlePlusClick = useCallback(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    // Compute position from the button
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setMenuPos({ x: rect.left + rect.width / 2, y: rect.top });
    }

    // Refresh the datatype list and resolve the pre-selected item
    const freshDatatypes = getListedDatatypes();
    setDatatypes(freshDatatypes);

    const selectedEmbed = editor.getSelectedShapes().find((s) => s.type === EMBED_SHAPE_TYPE) as any;
    const nextId = selectedEmbed?.props?.docType || _selectedDatatypeId || freshDatatypes[0]?.id || '';
    _selectedDatatypeId = nextId;
    setSelectedId(nextId);
    setMenuOpen(true);
  }, [menuOpen, editor]);

  const handlePickDatatype = useCallback(
    (id: string) => {
      _selectedDatatypeId = id;
      setSelectedId(id);
      setMenuOpen(false);
      editor.setCurrentTool('embed');
    },
    [editor],
  );

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />

      <div style={{ width: '1px', height: '20px', background: '#ddd', margin: '0 4px', flexShrink: 0 }} />

      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <button
          ref={buttonRef}
          type="button"
          onClick={handlePlusClick}
          title="Embed a document"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '32px',
            height: '32px',
            border: 'none',
            borderRadius: '6px',
            background: isActive || menuOpen ? 'var(--color-selected, #e8f0fe)' : 'transparent',
            cursor: 'pointer',
            color: isActive || menuOpen ? 'var(--color-selected-contrast, #2f80ed)' : 'currentColor',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        {menuOpen && menuPos && datatypes.length > 0 && (
          <EmbedShapeMenu
            datatypes={datatypes}
            selectedId={selectedId}
            pos={menuPos}
            anchorRef={buttonRef}
            onPick={handlePickDatatype}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </DefaultToolbar>
  );
}
