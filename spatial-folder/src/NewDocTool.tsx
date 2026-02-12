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
  ToolbarItem,
  type TLShape,
  type TLUiOverrides,
  type TLUiToolsContextType,
  type Editor,
  useEditor,
  useValue,
  DefaultToolbar,
} from 'tldraw';
import { useState, useEffect, useMemo } from 'react';
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

  /**
   * Called by BaseBoxShapeTool after the user finishes drawing the box.
   * The shape already exists on the canvas with the drawn x/y/w/h.
   * We kick off the async doc creation and update the shape when done.
   */
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

    // Async: load the datatype module, create document, update shape, add to folder
    (async () => {
      try {
        // IMPORTANT: load the datatype so its .module.init() is available
        const datatype = await loadDatatype(datatypeId);
        if (!datatype) {
          throw new Error(`Could not load datatype: ${datatypeId}`);
        }

        const docHandle = await (createDocOfDatatype2 as any)(datatype, repo, undefined, hive);
        const docUrl = docHandle.url;

        // Fill in the real doc URL
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

        // Add the new doc to the folder
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
    const datatypes = getListedDatatypeDescriptions();
    if (datatypes.length === 0) return tools;

    // Auto-select the first datatype if nothing chosen yet
    if (!_selectedDatatypeId && datatypes.length > 0) {
      _selectedDatatypeId = datatypes[0].id;
    }

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
// Custom Toolbar — default tldraw tools + "new-doc" + datatype picker
// ---------------------------------------------------------------------------

export function NewDocToolbar() {
  const editor = useEditor();
  const isActive = useValue('new-doc active', () => editor.getCurrentToolId() === 'new-doc', [
    editor,
  ]);

  const datatypes = useMemo(() => getListedDatatypeDescriptions(), []);
  const [selected, setSelected] = useState(() => getSelectedDatatypeId() || datatypes[0]?.id || '');

  // Keep module state in sync
  useEffect(() => {
    if (selected) setSelectedDatatypeId(selected);
  }, [selected]);

  // If the registry loads late, pick the first entry
  useEffect(() => {
    if (!selected && datatypes.length > 0) {
      setSelected(datatypes[0].id);
    }
  }, [datatypes, selected]);

  const selectedName = datatypes.find((d) => d.id === selected)?.name ?? 'document';

  return (
    <DefaultToolbar>
      <DefaultToolbarContent />
      {datatypes.length > 0 && (
        <>
          {/* Separator */}
          <div
            style={{
              width: '1px',
              height: '20px',
              background: '#ddd',
              margin: '0 2px',
              flexShrink: 0,
            }}
          />

          {/* The new-doc tool button in the toolbar */}
          <ToolbarItem tool="new-doc" />

          {/* Datatype pill picker right next to the button */}
          <div
            style={{
              position: 'relative',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '3px',
                fontSize: '11px',
                color: isActive ? '#2f80ed' : '#666',
                padding: '2px 8px',
                background: isActive ? '#e8f0fe' : '#eee',
                borderRadius: '9999px',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
                lineHeight: '16px',
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {selectedName}
              {datatypes.length > 1 && (
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

            {datatypes.length > 1 && (
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  // Also activate the tool when the user picks a type
                  editor.setCurrentTool('new-doc');
                }}
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
                {datatypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}
    </DefaultToolbar>
  );
}
