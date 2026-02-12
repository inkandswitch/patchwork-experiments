/**
 * NewDocTool — a tldraw tool that lets users draw a box to create a new
 * patchwork document of a chosen datatype.
 *
 * Exports:
 *   - NewDocShapeTool        — pass in Tldraw `tools` prop
 *   - newDocUiOverrides      — spread into Tldraw `overrides` prop
 *   - NewDocToolbar          — pass as Tldraw `components.Toolbar`
 *   - setNewDocToolContext()  — call once during init
 */

import {
  BaseBoxShapeTool,
  DefaultToolbarContent,
  type TLShape,
  type TLUiOverrides,
  type TLUiToolsContextType,
  type Editor,
  useEditor,
  useValue,
  DefaultToolbar,
} from 'tldraw';
import { useState, useEffect, useCallback } from 'react';
import type { DocHandle } from '@automerge/automerge-repo';
import {
  getRegistry,
  createDocOfDatatype2,
  type DatatypeDescription,
  type LoadedDatatype,
  type ToolElement,
} from '@inkandswitch/patchwork-plugins';
import { PATCHWORK_DOC_SHAPE_TYPE } from './PatchworkDocShape';

// ---------------------------------------------------------------------------
// Module-level context — set once from tool.tsx during initializeSync
// ---------------------------------------------------------------------------

let _element: ToolElement | null = null;
let _handle: DocHandle<any> | null = null;
let _selectedDatatypeId = '';

/** Call this once when the editor + doc are ready. */
export function setNewDocToolContext(element: ToolElement, handle: DocHandle<any>) {
  _element = element;
  _handle = handle;
}

export function setSelectedDatatypeId(id: string) {
  _selectedDatatypeId = id;
}

export function getSelectedDatatypeId(): string {
  return _selectedDatatypeId;
}

// ---------------------------------------------------------------------------
// Datatype helpers
// ---------------------------------------------------------------------------

/** Get datatype descriptions (not necessarily loaded yet) that aren't unlisted. */
function getListedDatatypeDescriptions(): DatatypeDescription[] {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return registry.filter((d) => !d.unlisted) as unknown as DatatypeDescription[];
  } catch {
    return [];
  }
}

/** Load a specific datatype by id, returning a LoadedDatatype with its module. */
async function loadDatatype(id: string): Promise<LoadedDatatype | undefined> {
  try {
    const registry = getRegistry<DatatypeDescription>('patchwork:datatype');
    return (await registry.load(id)) as unknown as LoadedDatatype | undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// NewDocShapeTool
// ---------------------------------------------------------------------------

export class NewDocShapeTool extends BaseBoxShapeTool {
  static override id = 'new-doc';
  static override initial = 'idle';
  override shapeType = PATCHWORK_DOC_SHAPE_TYPE;

  override onCreate(shape: TLShape | null) {
    if (!shape) return;

    if (!_element || !_handle) {
      console.warn(
        '[spatial-folder] NewDocTool: context not set — call setNewDocToolContext first',
      );
      return;
    }

    const datatypeId = _selectedDatatypeId;
    if (!datatypeId) {
      console.warn('[spatial-folder] NewDocTool: no datatype selected');
      return;
    }

    const editor = this.editor;
    const shapeId = shape.id;
    const repo = _element.repo;
    const hive = _element.hive;
    const handle = _handle;

    // Label the shape while the doc is being created
    editor.updateShape({
      id: shapeId,
      type: PATCHWORK_DOC_SHAPE_TYPE,
      props: {
        docName: `Creating…`,
        docType: datatypeId,
      },
    } as any);

    // Switch back to select tool immediately so the user isn't stuck
    editor.setCurrentTool('select');

    // Async: load the datatype module, create document, update shape, add to folder
    (async () => {
      try {
        const datatype = await loadDatatype(datatypeId);
        if (!datatype) {
          throw new Error(`Could not load datatype: ${datatypeId}`);
        }

        const docHandle = await (createDocOfDatatype2 as any)(datatype, repo, undefined, hive);
        const docUrl = docHandle.url;

        editor.updateShape({
          id: shapeId,
          type: PATCHWORK_DOC_SHAPE_TYPE,
          props: {
            docUrl,
            docName: datatype.name ?? datatypeId,
            docType: datatypeId,
            toolId: '',
          },
        } as any);

        handle.change((d: any) => {
          if (!d.docs) d.docs = [];
          d.docs.push({
            name: datatype.name ?? datatypeId,
            type: datatypeId,
            url: docUrl,
          });
        });

        console.log('[spatial-folder] new doc created:', datatypeId, docUrl);
      } catch (err) {
        console.error('[spatial-folder] new doc creation failed:', err);
        editor.updateShape({
          id: shapeId,
          type: PATCHWORK_DOC_SHAPE_TYPE,
          props: { docName: `Error creating ${datatypeId}` },
        } as any);
      }
    })();
  }
}

// ---------------------------------------------------------------------------
// Tldraw UI overrides — registers "new-doc" in the tools context
// ---------------------------------------------------------------------------

export const newDocUiOverrides: TLUiOverrides = {
  tools(_editor: Editor, tools: TLUiToolsContextType) {
    tools['new-doc'] = {
      id: 'new-doc',
      icon: 'plus' as any,
      label: 'New document' as any,
      onSelect(_source) {
        _editor.setCurrentTool('new-doc');
      },
    };
    return tools;
  },
};

// ---------------------------------------------------------------------------
// Custom Toolbar — default tools + a "+" button with datatype select
// ---------------------------------------------------------------------------

export function NewDocToolbar() {
  const editor = useEditor();
  const isActive = useValue('new-doc active', () => editor.getCurrentToolId() === 'new-doc', [
    editor,
  ]);

  const [datatypes, setDatatypes] = useState<DatatypeDescription[]>([]);

  // Load datatypes on mount
  useEffect(() => {
    const dt = getListedDatatypeDescriptions();
    setDatatypes(dt);
    if (dt.length > 0 && !_selectedDatatypeId) {
      _selectedDatatypeId = dt[0].id;
    }
  }, []);

  const handleSelectAndActivate = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      e.stopPropagation();
      const id = e.target.value;
      if (id) {
        setSelectedDatatypeId(id);
        editor.setCurrentTool('new-doc');
      }
    },
    [editor],
  );

  const handlePlusClick = useCallback(() => {
    if (datatypes.length === 1) {
      setSelectedDatatypeId(datatypes[0].id);
      editor.setCurrentTool('new-doc');
    }
    // If multiple, the invisible select handles it
  }, [datatypes, editor]);

  if (datatypes.length === 0) {
    return (
      <DefaultToolbar>
        <DefaultToolbarContent />
      </DefaultToolbar>
    );
  }

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />

      {/* Separator */}
      <div
        style={{
          width: '1px',
          height: '20px',
          background: '#ddd',
          margin: '0 4px',
          flexShrink: 0,
        }}
      />

      {/* + button with invisible select overlay for multi-datatype */}
      <div
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={handlePlusClick}
          title="Create a new document"
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
            pointerEvents: datatypes.length > 1 ? 'none' : 'auto',
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

        {/* For multiple datatypes: invisible native select over the button */}
        {datatypes.length > 1 && (
          <select
            value={_selectedDatatypeId}
            onChange={handleSelectAndActivate}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            <option value="" disabled>
              New…
            </option>
            {datatypes.map((dt) => (
              <option key={dt.id} value={dt.id}>
                + {dt.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </DefaultToolbar>
  );
}
