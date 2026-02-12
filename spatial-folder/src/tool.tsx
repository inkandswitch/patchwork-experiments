import { Tldraw, Editor, createShapeId, TLShapeId, TLUiComponents, TLRecord } from 'tldraw';
import 'tldraw/tldraw.css';
import { DocHandle } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useMemo } from 'react';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { PatchworkDocShapeUtil, PATCHWORK_DOC_SHAPE_TYPE } from './PatchworkDocShape';
import '@inkandswitch/patchwork-elements';

// ---- Logging ----------------------------------------------------------------

const LOG = '[spatial-folder]';

// ---- Types ------------------------------------------------------------------

type LayoutEntry = { x: number; y: number; w: number; h: number };

type SpatialFolderDoc = FolderDoc & {
  /** Every document-scope tldraw record, keyed by record id, stored as JSON. */
  tldraw?: { [recordId: string]: string };
};

// ---- Constants --------------------------------------------------------------

const GRID_COLS = 3;
const DEFAULT_W = 400;
const DEFAULT_H = 300;
const GAP = 40;

const customShapeUtils = [PatchworkDocShapeUtil];

// Keep everything except the page picker.
const uiComponents: TLUiComponents = {
  PageMenu: null,
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

// ---- Tool entry point -------------------------------------------------------

export const SpatialFolderTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <SpatialFolderCanvas handle={handle as DocHandle<SpatialFolderDoc>} />
    </RepoContext.Provider>,
  );
  return () => {
    console.log(LOG, 'tool unmounting');
    root.unmount();
  };
};

// ---- React component --------------------------------------------------------

function SpatialFolderCanvas({ handle }: { handle: DocHandle<SpatialFolderDoc> }) {
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
      initializeSync(editor, handle, isSyncingToTldrawRef, isSyncingToAutomergeRef, cleanupFnsRef);
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

    const currentDoc = handle.docSync?.() ?? (handle as any).doc?.();
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
    reconcilePatchworkDocShapes(editor, currentDoc.docs);
  }, [docUrlsKey, handle]);

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
//  initializeSync — called exactly once when editor + doc are both ready
// =============================================================================

function initializeSync(
  editor: Editor,
  handle: DocHandle<SpatialFolderDoc>,
  isSyncingToTldrawRef: React.MutableRefObject<boolean>,
  isSyncingToAutomergeRef: React.MutableRefObject<boolean>,
  cleanupFnsRef: React.MutableRefObject<(() => void)[]>,
) {
  const currentDoc = handle.docSync?.() ?? (handle as any).doc?.();
  if (!currentDoc) {
    console.error(LOG, 'initializeSync called but docSync() returned null!');
    return;
  }

  const folderDocs: DocLink[] = currentDoc.docs ?? [];
  const stored: Record<string, string> = currentDoc.tldraw ?? {};

  console.log(
    LOG,
    'initializeSync',
    '| folder docs:',
    folderDocs.length,
    '| stored tldraw records:',
    Object.keys(stored).length,
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

      if (addedFiltered.length <= 5) {
        for (const r of addedFiltered)
          console.log(LOG, '  + ', r.id, r.typeName, (r as any).type ?? '');
      }
      if (updatedFiltered.length <= 5) {
        for (const r of updatedFiltered)
          console.log(LOG, '  ~ ', r.id, r.typeName, (r as any).type ?? '');
      }
      if (removedFiltered.length <= 5) {
        for (const r of removedFiltered)
          console.log(LOG, '  - ', r.id, r.typeName, (r as any).type ?? '');
      }

      isSyncingToAutomergeRef.current = true;
      try {
        handle.change((d) => {
          if (!d.tldraw) {
            (d as any).tldraw = {};
          }
          for (const r of addedFiltered) d.tldraw![r.id] = JSON.stringify(r);
          for (const r of updatedFiltered) d.tldraw![r.id] = JSON.stringify(r);
          for (const r of removedFiltered) delete d.tldraw![r.id];
        });
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
  // 2.  Set up automerge → tldraw listener (for remote peer changes)
  // ------------------------------------------------------------------

  const handleDocChange = () => {
    if (isSyncingToAutomergeRef.current) {
      // This is the echo from our own handle.change() — ignore it.
      return;
    }

    const latestDoc = handle.docSync?.() ?? (handle as any).doc?.();
    if (!latestDoc?.tldraw) return;

    const currentPageId = editor.getCurrentPageId();

    // Parse every stored record.
    const storedById = new Map<string, TLRecord>();
    for (const [id, json] of Object.entries(latestDoc.tldraw)) {
      try {
        storedById.set(id, JSON.parse(json as string));
      } catch {}
    }

    // Diff against tldraw's store.
    const toPut: TLRecord[] = [];
    const toRemove: TLRecord['id'][] = [];

    for (const [id, rec] of storedById) {
      const existing = editor.store.get(rec.id);
      if (!existing) {
        // Remap page parentId for shapes
        const remapped = remapParentPage(rec, currentPageId);
        toPut.push(remapped);
      } else {
        // Simple dirty check — compare JSON
        const existingJson = JSON.stringify(existing);
        const storedJson = JSON.stringify(rec);
        if (existingJson !== storedJson) {
          const remapped = remapParentPage(rec, currentPageId);
          toPut.push(remapped);
        }
      }
    }

    // Shapes we have locally but that are gone from automerge → remove
    // (only document-scope records; skip pages and patchwork-doc shapes)
    for (const r of editor.store.allRecords()) {
      if (r.typeName === 'page') continue;
      if (r.typeName !== 'shape' && r.typeName !== 'asset') continue;
      if ((r as any).type === PATCHWORK_DOC_SHAPE_TYPE) continue;
      if (!storedById.has(r.id)) {
        toRemove.push(r.id);
      }
    }

    if (toPut.length + toRemove.length === 0) return;

    console.log(LOG, 'am→tldraw (remote change)', 'put:', toPut.length, 'remove:', toRemove.length);

    isSyncingToTldrawRef.current = true;
    try {
      editor.store.mergeRemoteChanges(() => {
        if (toPut.length) editor.store.put(toPut);
        if (toRemove.length) editor.store.remove(toRemove);
      });
    } catch (e) {
      console.error(LOG, 'am→tldraw mergeRemoteChanges THREW', e);
    }
    isSyncingToTldrawRef.current = false;
  };

  handle.on('change', handleDocChange);
  cleanupFnsRef.current.push(() => {
    console.log(LOG, 'removing handle change listener');
    handle.off('change', handleDocChange);
  });

  // ------------------------------------------------------------------
  // 3.  Load stored tldraw records into the editor
  // ------------------------------------------------------------------

  const currentPageId = editor.getCurrentPageId();
  const storedRecords: TLRecord[] = [];
  for (const [id, json] of Object.entries(stored)) {
    try {
      const rec = JSON.parse(json) as TLRecord;
      // Skip page records — we use tldraw's fresh page.
      if (rec.typeName === 'page') continue;
      storedRecords.push(remapParentPage(rec, currentPageId));
    } catch (e) {
      console.warn(LOG, 'bad stored record', id, e);
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

  reconcilePatchworkDocShapes(editor, folderDocs);

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

// =============================================================================
//  remapParentPage — rewrite parentId so shapes land on the current page
// =============================================================================

function remapParentPage(record: TLRecord, currentPageId: string): TLRecord {
  const r = record as any;
  if (r.typeName === 'shape' && typeof r.parentId === 'string' && r.parentId.startsWith('page:')) {
    if (r.parentId !== currentPageId) {
      console.log(LOG, 'remapping parentId', r.parentId, '→', currentPageId, 'for', r.id);
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
