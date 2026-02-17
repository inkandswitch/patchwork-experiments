import { Tldraw, Editor, createShapeId, TLShapeId, TLUiComponents, TLRecord } from 'tldraw';
import 'tldraw/tldraw.css';
import { DocHandle, type DocHandleChangePayload } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useMemo } from 'react';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import { PatchworkDocShapeUtil, PATCHWORK_DOC_SHAPE_TYPE } from './PatchworkDocShape';
import {
  applyTLStoreChangesToAutomergeDoc,
  applyAutomergePatchesToTLStore,
  readStoredRecord,
} from './automerge-tldraw-sync';
import {
  NewDocShapeTool,
  newDocUiOverrides,
  NewDocToolbar,
  setNewDocToolContext,
} from './NewDocTool';
import '@inkandswitch/patchwork-elements';

// ---- Logging ----------------------------------------------------------------

const LOG = '[spatial-folder]';

// ---- Types ------------------------------------------------------------------

type SpatialFolderDoc = FolderDoc & {
  /**
   * Automerge URL pointing at a dedicated tldraw document.
   * Legacy: may be a `{ [recordId: string]: any }` object — migrated on first load.
   */
  tldraw?: string | { [recordId: string]: any };
};

/** The dedicated tldraw document — record IDs are top-level keys. */
type TldrawDoc = {
  '@patchwork'?: { type: 'tldraw' };
  [recordId: string]: any;
};

// ---- Constants --------------------------------------------------------------

const GRID_COLS = 3;
const DEFAULT_W = 640;
const DEFAULT_H = 480;
const GAP = 60;

const customShapeUtils = [PatchworkDocShapeUtil];
const customTools = [NewDocShapeTool];

// Keep everything except the page picker; use custom toolbar with new-doc tool.
const uiComponents: TLUiComponents = {
  PageMenu: null,
  Toolbar: NewDocToolbar,
};

// ---- Helpers ----------------------------------------------------------------

function makeShapeId(docUrl: string): TLShapeId {
  return createShapeId(docUrl.replace(/[^a-zA-Z0-9]/g, '_'));
}

function defaultPosition(index: number) {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  return { x: col * (DEFAULT_W + GAP), y: row * (DEFAULT_H + GAP) };
}

async function filterTldrawDocs(repo: any, docLinks: DocLink[]): Promise<DocLink[]> {
  const filtered: DocLink[] = [];

  for (const docLink of docLinks) {
    try {
      const docHandle = await repo.find(docLink.url);
      const doc = docHandle.doc();

      // Skip documents with @patchwork.type === "tldraw"
      if (doc?.['@patchwork']?.type === 'tldraw') {
        console.log(LOG, 'filtering out tldraw doc:', docLink.name);
        continue;
      }

      filtered.push(docLink);
    } catch (error) {
      console.warn(LOG, 'error checking doc', docLink.url, error);
      // Include the doc if we can't check it
      filtered.push(docLink);
    }
  }

  return filtered;
}

// ---- Tool entry point -------------------------------------------------------

export const SpatialFolderTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <SpatialFolderCanvas handle={handle as DocHandle<SpatialFolderDoc>} element={element} />
    </RepoContext.Provider>,
  );
  return () => {
    console.log(LOG, 'tool unmounting');
    root.unmount();
  };
};

// ---- React component --------------------------------------------------------

function SpatialFolderCanvas({
  handle,
  element,
}: {
  handle: DocHandle<SpatialFolderDoc>;
  element: ToolElement;
}) {
  // useDocument is ONLY used to derive the folder-doc list key and for
  // the loading overlay.  We never pass the reactive `doc` into any
  // tldraw-touching code-path — that caused the previous unmount/flicker bug.
  const [doc] = useDocument<SpatialFolderDoc>(handle.url);

  const editorRef = useRef<Editor | null>(null);
  const initializedRef = useRef(false);
  const cleanupFnsRef = useRef<(() => void)[]>([]);

  // Guards to break the tldraw ↔ automerge feedback loop.
  const isSyncingToTldrawRef = useRef(false);
  const isSyncingToAutomergeRef = useRef(false);
  const isReconcilingRef = useRef(false);

  // ---- Tldraw mount callback (stable reference, never changes) ----
  const handleMountRef = useRef((editor: Editor) => {
    console.log(LOG, 'tldraw editor mounted, waiting for doc…');
    editorRef.current = editor;

    handle.whenReady().then(() => {
      if (initializedRef.current) {
        console.log(LOG, 'doc ready but already initialized — skipping');
        return;
      }
      initializedRef.current = true;
      console.log(LOG, 'doc ready — running initializeSync');
      setNewDocToolContext(element, handle);
      initializeSync(
        editor,
        handle,
        element.repo,
        isSyncingToTldrawRef,
        isSyncingToAutomergeRef,
        isReconcilingRef,
        cleanupFnsRef,
      );
    });
  });

  // ---- Folder-doc-list reconciliation (add / remove patchwork-doc shapes) ---
  const docUrlsKey = useMemo(
    () => (doc?.docs ?? []).map((d) => `${d.url}|${d.name}|${d.type}`).join('\n'),
    [doc?.docs],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !initializedRef.current) return;

    const currentDoc = handle.doc();
    if (!currentDoc?.docs) {
      console.log(LOG, 'reconcile effect: no doc yet');
      return;
    }

    console.log(
      LOG,
      'folder doc list changed (',
      currentDoc.docs.length,
      'docs) — reconciling patchwork-doc shapes',
    );

    // Filter out tldraw documents before reconciling
    filterTldrawDocs(element.repo, currentDoc.docs).then((filteredDocs) => {
      isReconcilingRef.current = true;
      reconcilePatchworkDocShapes(editor, filteredDocs);
      isReconcilingRef.current = false;
    });
  }, [docUrlsKey, handle, element.repo]);

  // ---- Cleanup on unmount ---------------------------------------------------
  useEffect(() => {
    return () => {
      console.log(LOG, 'component unmounting — cleaning up', cleanupFnsRef.current.length, 'fns');
      for (const fn of cleanupFnsRef.current) {
        try {
          fn();
        } catch (e) {
          console.warn(LOG, 'cleanup error', e);
        }
      }
      cleanupFnsRef.current = [];
    };
  }, []);

  // ---- Render ---------------------------------------------------------------
  // IMPORTANT: <Tldraw> is ALWAYS rendered.  We never conditionally
  // switch it out for a loading indicator — that would destroy the
  // editor instance and all shapes.  Instead we overlay a translucent
  // loading screen until the doc arrives.

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        tools={customTools}
        overrides={newDocUiOverrides}
        onMount={handleMountRef.current}
        components={uiComponents}
      />
      {!doc && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.85)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#888',
            fontSize: '16px',
            zIndex: 9999,
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}

// =============================================================================
//  resolveTldrawHandle — find, create, or migrate the dedicated tldraw doc
// =============================================================================

async function resolveTldrawHandle(
  handle: DocHandle<SpatialFolderDoc>,
  repo: any,
): Promise<DocHandle<TldrawDoc>> {
  const doc = handle.doc();
  const existing = doc?.tldraw;

  if (typeof existing === 'string') {
    // Already migrated — it's an automerge URL.
    console.log(LOG, 'tldraw doc URL found:', existing);
    const tldrawHandle = (await repo.find(existing)) as DocHandle<TldrawDoc>;
    return tldrawHandle;
  }

  if (existing && typeof existing === 'object') {
    // Legacy: tldraw data stored inline — migrate to a new doc.
    console.log(LOG, 'migrating inline tldraw data to dedicated doc');
    const initial: TldrawDoc = { '@patchwork': { type: 'tldraw' } };
    for (const [id, value] of Object.entries(existing)) {
      initial[id] = value;
    }
    const tldrawHandle = (await repo.create2(initial)) as DocHandle<TldrawDoc>;

    // Point the folder doc at the new tldraw doc URL.
    handle.change((d: any) => {
      d.tldraw = tldrawHandle.url;
    });
    console.log(LOG, 'migration complete, tldraw doc:', tldrawHandle.url);
    return tldrawHandle;
  }

  // No tldraw data yet — create an empty doc.
  console.log(LOG, 'creating new tldraw doc');
  const tldrawHandle = (await repo.create2({
    '@patchwork': { type: 'tldraw' },
  })) as DocHandle<TldrawDoc>;

  handle.change((d: any) => {
    d.tldraw = tldrawHandle.url;
  });
  console.log(LOG, 'new tldraw doc created:', tldrawHandle.url);
  return tldrawHandle;
}

// =============================================================================
//  initializeSync — called exactly once when editor + doc are both ready
// =============================================================================

async function initializeSync(
  editor: Editor,
  handle: DocHandle<SpatialFolderDoc>,
  repo: any,
  isSyncingToTldrawRef: React.MutableRefObject<boolean>,
  isSyncingToAutomergeRef: React.MutableRefObject<boolean>,
  isReconcilingRef: React.MutableRefObject<boolean>,
  cleanupFnsRef: React.MutableRefObject<(() => void)[]>,
) {
  const currentDoc = handle.doc?.();
  if (!currentDoc) {
    console.error(LOG, 'initializeSync called but .doc() returned null!');
    return;
  }

  const folderDocs: DocLink[] = currentDoc.docs ?? [];

  // Resolve (or create/migrate) the dedicated tldraw document.
  const tldrawHandle = await resolveTldrawHandle(handle, repo);
  const tldrawDoc = tldrawHandle.doc();

  const storedCount = tldrawDoc
    ? Object.keys(tldrawDoc).filter((k) => k !== '@patchwork').length
    : 0;

  console.log(
    LOG,
    'initializeSync',
    '| folder docs:',
    folderDocs.length,
    '| stored tldraw records:',
    storedCount,
    '| tldraw doc:',
    tldrawHandle.url,
  );

  // ------------------------------------------------------------------
  // 1.  Set up tldraw → automerge listener FIRST so that shapes created
  //     by reconcile (step 3) get persisted.
  // ------------------------------------------------------------------

  const unsubStore = editor.store.listen(
    ({ changes, source }) => {
      if (isSyncingToTldrawRef.current) {
        console.log(LOG, 'tldraw→am SKIP (isSyncingToTldraw=true, source=' + source + ')');
        return;
      }

      const added = Object.values(changes.added);
      const updated = Object.values(changes.updated).map(([, after]) => after);
      const removed = Object.values(changes.removed);

      // Filter out page records — we never persist those because tldraw
      // generates a fresh page id on every mount and we don't want stale
      // page references.
      const filterPage = (r: TLRecord) => r.typeName !== 'page';
      const addedFiltered = added.filter(filterPage);
      const updatedFiltered = updated.filter(filterPage);
      const removedFiltered = removed.filter(filterPage);

      const total = addedFiltered.length + updatedFiltered.length + removedFiltered.length;
      if (total === 0) return;

      console.log(
        LOG,
        'tldraw→am',
        '+' + addedFiltered.length,
        '~' + updatedFiltered.length,
        '-' + removedFiltered.length,
        '(source=' + source + ')',
      );

      isSyncingToAutomergeRef.current = true;
      try {
        // Persist tldraw records to the dedicated tldraw doc.
        tldrawHandle.change((d: any) => {
          applyTLStoreChangesToAutomergeDoc(d, {
            added: addedFiltered,
            updated: updatedFiltered,
            removed: removedFiltered,
          });
        });

        // When patchwork-doc shapes are deleted, remove from the folder doc list.
        // Skip during reconciliation (those deletions reflect docs already gone).
        if (!isReconcilingRef.current) {
          const docsToRemove = removedFiltered.filter(
            (r: any) => r.type === PATCHWORK_DOC_SHAPE_TYPE && r.props?.docUrl,
          );
          if (docsToRemove.length > 0) {
            handle.change((d) => {
              if (!d.docs) return;
              for (const record of docsToRemove) {
                const r = record as any;
                const idx = d.docs.findIndex((doc: any) => doc.url === r.props.docUrl);
                if (idx >= 0) {
                  d.docs.splice(idx, 1);
                }
              }
            });
          }
        }

        console.log(LOG, 'tldraw→am handle.change() succeeded');
      } catch (e) {
        console.error(LOG, 'tldraw→am handle.change() THREW', e);
      }
      isSyncingToAutomergeRef.current = false;
    },
    { source: 'user', scope: 'document' },
  );
  cleanupFnsRef.current.push(() => {
    console.log(LOG, 'unsubscribing store listener');
    unsubStore();
  });

  // ------------------------------------------------------------------
  // 2.  Set up automerge → tldraw listener (on the dedicated tldraw doc)
  // ------------------------------------------------------------------

  const handleTldrawDocChange = ({ patches }: DocHandleChangePayload<TldrawDoc>) => {
    if (isSyncingToAutomergeRef.current) {
      // This is the echo from our own tldrawHandle.change() — ignore it.
      return;
    }

    const currentPageId = editor.getCurrentPageId();

    // Filter out @patchwork metadata patches; everything else is a tldraw record.
    const tldrawPatches = patches.filter((p) => p.path.length >= 1 && p.path[0] !== '@patchwork');

    if (tldrawPatches.length === 0) return;

    console.log(LOG, 'am→tldraw (remote patches)', tldrawPatches.length, 'patches');

    isSyncingToTldrawRef.current = true;
    try {
      applyAutomergePatchesToTLStore(tldrawPatches, editor.store, currentPageId);
    } catch (e) {
      console.error(LOG, 'am→tldraw applyPatches THREW', e);
    }
    isSyncingToTldrawRef.current = false;
  };

  tldrawHandle.on('change', handleTldrawDocChange as any);
  cleanupFnsRef.current.push(() => {
    console.log(LOG, 'removing tldraw handle change listener');
    tldrawHandle.off('change', handleTldrawDocChange as any);
  });

  // ------------------------------------------------------------------
  // 3.  Load stored tldraw records into the editor
  // ------------------------------------------------------------------

  const currentPageId = editor.getCurrentPageId();
  const storedRecords: TLRecord[] = [];
  if (tldrawDoc) {
    for (const [id, value] of Object.entries(tldrawDoc)) {
      if (id === '@patchwork') continue;
      const rec = readStoredRecord(value);
      if (!rec) {
        console.warn(LOG, 'bad stored record', id);
        continue;
      }
      // Skip page records — we use tldraw's fresh page.
      if (rec.typeName === 'page') continue;
      storedRecords.push(remapParentPage(rec, currentPageId));
    }
  }

  if (storedRecords.length > 0) {
    console.log(LOG, 'loading', storedRecords.length, 'stored records into tldraw store');
    isSyncingToTldrawRef.current = true;
    try {
      editor.store.mergeRemoteChanges(() => {
        editor.store.put(storedRecords);
      });
      console.log(LOG, 'stored records loaded OK');
    } catch (e) {
      console.error(LOG, 'loading stored records THREW', e);
    }
    isSyncingToTldrawRef.current = false;
  } else {
    console.log(LOG, 'no stored records to load');
  }

  // ------------------------------------------------------------------
  // 4.  Ensure patchwork-doc shapes exist for every folder item
  //     These are created as *user* changes so the store listener
  //     (step 1) persists them to automerge automatically.
  // ------------------------------------------------------------------

  filterTldrawDocs(repo, folderDocs).then((filteredDocs) => {
    isReconcilingRef.current = true;
    reconcilePatchworkDocShapes(editor, filteredDocs);
    isReconcilingRef.current = false;
  });

  // ------------------------------------------------------------------
  // 5.  Zoom to fit
  // ------------------------------------------------------------------

  const shapeCount = editor.getCurrentPageShapes().length;
  if (shapeCount > 0) {
    console.log(LOG, 'zooming to fit', shapeCount, 'shapes');
    requestAnimationFrame(() => {
      try {
        editor.zoomToFit({ animation: { duration: 300 } });
      } catch {
        /* editor may have been disposed */
      }
    });
  }

  console.log(LOG, 'initializeSync complete ✓');
}

// remapParentPage is now in automerge-tldraw-sync.ts but we still need
// a local version for reconcilePatchworkDocShapes which creates shapes
// that go through the tldraw store (not automerge directly).
function remapParentPage(record: TLRecord, currentPageId: string): TLRecord {
  const r = record as any;
  if (r.typeName === 'shape' && typeof r.parentId === 'string' && r.parentId.startsWith('page:')) {
    if (r.parentId !== currentPageId) {
      return { ...r, parentId: currentPageId };
    }
  }
  return record;
}

// =============================================================================
//  reconcilePatchworkDocShapes — create / update / remove folder-item shapes
// =============================================================================

function reconcilePatchworkDocShapes(editor: Editor, folderDocs: DocLink[]) {
  const existing = new Map<string, TLShapeId>();

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type === PATCHWORK_DOC_SHAPE_TYPE) {
      existing.set((shape as any).props.docUrl, shape.id);
    }
  }

  const folderUrls = new Set<string>(folderDocs.map((d) => d.url));
  let nextIdx = existing.size;

  console.log(
    LOG,
    'reconcile: existing patchwork shapes:',
    existing.size,
    '| folder docs:',
    folderDocs.length,
  );

  for (const docLink of folderDocs) {
    if (existing.has(docLink.url)) {
      // Already on canvas — update metadata if stale
      const shapeId = existing.get(docLink.url)!;
      const shape = editor.getShape(shapeId) as any;
      if (shape && (shape.props.docName !== docLink.name || shape.props.docType !== docLink.type)) {
        console.log(LOG, 'reconcile: updating metadata for', docLink.name);
        editor.updateShape({
          id: shapeId,
          type: PATCHWORK_DOC_SHAPE_TYPE,
          props: { docName: docLink.name, docType: docLink.type },
        } as any);
      }
      continue;
    }

    // New doc — create a shape
    const pos = defaultPosition(nextIdx++);
    console.log(LOG, 'reconcile: creating shape for', docLink.name, 'at', pos.x, pos.y);
    editor.createShape({
      id: makeShapeId(docLink.url),
      type: PATCHWORK_DOC_SHAPE_TYPE,
      x: pos.x,
      y: pos.y,
      rotation: 0,
      props: {
        w: DEFAULT_W,
        h: DEFAULT_H,
        docUrl: docLink.url,
        docName: docLink.name,
        docType: docLink.type,
        toolId: '',
      },
    } as any);
  }

  // Remove shapes whose doc was removed from the folder
  for (const [url, shapeId] of existing) {
    if (!folderUrls.has(url)) {
      console.log(LOG, 'reconcile: removing shape for deleted doc', url);
      if (editor.getShape(shapeId)) {
        editor.deleteShapes([shapeId]);
      }
    }
  }
}
