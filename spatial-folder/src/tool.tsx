import {
  Tldraw,
  Editor,
  createShapeId,
  TLShapeId,
  TLUiComponents,
  TLRecord,
  TLAssetId,
  TLAsset,
  TLContent,
  createTLStore,
  defaultShapeUtils,
  getMediaAssetInfoPartial,
  getUserPreferences,
  setUserPreferences,
  defaultUserPreferences,
  createPresenceStateDerivation,
  InstancePresenceRecordType,
  computed,
  react,
  sortById,
} from 'tldraw';
import type { VecLike } from 'tldraw';
import 'tldraw/tldraw.css';
import { DocHandle, type AutomergeUrl, type DocHandleChangePayload } from '@automerge/automerge-repo';
import { useDocument, useLocalAwareness, useRemoteAwareness, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import { automergeUrlToServiceWorkerUrl } from '@inkandswitch/patchwork-filesystem';
import type { ToolRender, ToolElement } from '@inkandswitch/patchwork-plugins';
import { PatchworkDocShapeUtil, PATCHWORK_DOC_SHAPE_TYPE } from './PatchworkDocShape';
import { applyTLStoreChangesToAutomerge, tldrawValueToAutomergeValue } from './TLStoreToAutomerge';
import type { TldrawDoc } from './TLStoreToAutomerge';
import { applyAutomergePatchesToTLStore } from './AutomergeToTLStore';
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

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function extensionForMimeType(mimeType: string): string {
  return MIME_TO_EXT[mimeType] || mimeType.split('/')[1] || 'bin';
}

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

// ---- Presence ---------------------------------------------------------------

interface ContactDoc {
  type: string;
  name?: string;
  color?: string;
}

function useContactInfo() {
  const [contactUrl, setContactUrl] = useState<AutomergeUrl | undefined>();

  useEffect(() => {
    const accountDocHandle = (
      window as any
    ).accountDocHandle as DocHandle<{ contactUrl: AutomergeUrl }> | undefined;
    if (!accountDocHandle) return;
    accountDocHandle.whenReady().then(() => {
      const doc = accountDocHandle.doc();
      if (doc?.contactUrl) {
        setContactUrl(doc.contactUrl);
      }
    });
  }, []);

  const [contactDoc] = useDocument<ContactDoc>(contactUrl);

  return {
    userId: contactUrl ?? (window as any).repo?.peerId ?? 'anonymous',
    name: contactDoc?.name ?? 'Anonymous',
    color: contactDoc?.color,
  };
}

function usePresence(
  handle: DocHandle<SpatialFolderDoc>,
  editorRef: React.MutableRefObject<Editor | null>,
) {
  const { userId, name, color } = useContactInfo();

  const [, updateLocalState] = useLocalAwareness({
    handle: handle as DocHandle<any>,
    userId,
    initialState: {},
  });

  const [peerStates] = useRemoteAwareness({
    handle: handle as DocHandle<any>,
    localUserId: userId,
  });

  // Sync remote presence records into the editor's store
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const toPut: TLRecord[] = Object.values(peerStates).filter(
      (record: any) => record && Object.keys(record).length !== 0,
    );

    const toRemove = editor.store.query
      .records('instance_presence')
      .get()
      .sort(sortById)
      .map((record) => record.id)
      .filter((id) => !toPut.find((record) => record.id === id));

    if (toRemove.length) editor.store.remove(toRemove);
    if (toPut.length) editor.store.put(toPut);
  }, [peerStates, editorRef]);

  // Broadcast local presence state derived from the editor
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    setUserPreferences({ id: userId, color, name });

    const userPreferences = computed<{
      id: string;
      color: string;
      name: string;
    }>('userPreferences', () => {
      const user = getUserPreferences();
      return {
        id: user.id,
        color: user.color ?? defaultUserPreferences.color,
        name: user.name ?? defaultUserPreferences.name,
      };
    });

    const presenceId = InstancePresenceRecordType.createId(userId);
    const presenceDerivation = createPresenceStateDerivation(
      userPreferences,
      presenceId,
    )(editor.store);

    return react('when presence changes', () => {
      const presence = presenceDerivation.get();
      requestAnimationFrame(() => {
        updateLocalState(presence);
      });
    });
  }, [editorRef.current, userId, updateLocalState, name, color]);
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

  // Guard to break the tldraw ↔ automerge feedback loop.
  const preventPatchApplicationsRef = useRef(false);
  const isReconcilingRef = useRef(false);

  // ---- Presence (cursors, selections visible to other users) ----
  usePresence(handle, editorRef);

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
      setNewDocToolContext(element, handle, editor);
      initializeSync(
        editor,
        handle,
        element.repo,
        preventPatchApplicationsRef,
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

    // Synchronously exclude our own tldraw doc, then async-filter any others.
    const tldrawUrl = typeof currentDoc.tldraw === 'string' ? currentDoc.tldraw : null;
    const withoutOwn = tldrawUrl
      ? currentDoc.docs.filter((d) => d.url !== tldrawUrl)
      : currentDoc.docs;

    // Immediately reconcile with the synchronous filter so there's no
    // flash of a tldraw-doc shape on canvas.
    isReconcilingRef.current = true;
    reconcilePatchworkDocShapes(editor, withoutOwn);
    isReconcilingRef.current = false;

    // Then async-filter any remaining tldraw docs from other sources.
    // Use a stale flag so that if docUrlsKey changes before this resolves,
    // we don't reconcile with outdated data (which could delete valid shapes).
    let stale = false;
    filterTldrawDocs(element.repo, withoutOwn).then((filteredDocs) => {
      if (stale) return;
      isReconcilingRef.current = true;
      reconcilePatchworkDocShapes(editor, filteredDocs);
      isReconcilingRef.current = false;
    });

    return () => { stale = true; };
  }, [docUrlsKey, handle, element.repo]);

  // ---- patchwork:open-document → pan/zoom to matching shape -----------------
  // Only handle events originating from the sideboard panel; let others bubble.
  const sideboardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      // Only intercept events from inside the sideboard panel
      const sideboardEl = sideboardRef.current;
      if (!sideboardEl) return;
      const path = e.composedPath();
      if (!path.includes(sideboardEl)) return;

      const editor = editorRef.current;
      if (!editor) return;
      const detail = (e as CustomEvent).detail as { url?: string };
      if (!detail?.url) return;

      // Find the shape whose docUrl matches the requested URL
      const targetId = makeShapeId(detail.url);
      const shape = editor.getShape(targetId);
      if (!shape) {
        console.log(LOG, 'open-document: no shape found for', detail.url);
        return;
      }

      // Stop the event from bubbling further — we're handling it
      e.stopPropagation();

      // Select the shape and zoom to it with some padding
      editor.setSelectedShapes([targetId]);
      editor.zoomToSelection({ animation: { duration: 300 } });
      console.log(LOG, 'open-document: zoomed to shape for', detail.url);
    };

    element.addEventListener('patchwork:open-document', handler);
    return () => element.removeEventListener('patchwork:open-document', handler);
  }, [element]);

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
    <div
      className="spatial-folder-root"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <style>{`
        .spatial-folder-root > .tl-container .tl-background {
          background: #ece8f4 !important;
        }
      `}</style>
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
      <SideboardPanel containerRef={sideboardRef} docUrl={handle.url} title={doc?.title} />
    </div>
  );
}

// ---- Sideboard panel — fixed overlay, collapsible -------------------------

function SideboardPanel({ containerRef, docUrl, title }: { containerRef: React.RefObject<HTMLDivElement | null>; docUrl: string; title?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      ref={containerRef as any}
      style={{
        position: 'fixed',
        top: '52px',
        left: '12px',
        zIndex: 99,
        pointerEvents: 'auto',
      }}
    >
      {open ? (
        <div
          style={{
            width: '280px',
            height: '400px',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            overflow: 'hidden',
          }}
        >
          {/* Header with collapse button on left, title on right */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 8px',
              borderBottom: '1px solid #eee',
              background: '#fafafa',
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                padding: '2px',
                lineHeight: 1,
                fontSize: '16px',
                color: '#999',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <line x1="3" y1="8" x2="13" y2="8" stroke="#999" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                color: '#333',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title || 'Sideboard'}
            </span>
          </div>
          {/* patchwork-view content */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {/* @ts-expect-error Custom element */}
            <patchwork-view
              doc-url={docUrl}
              tool-id="chee/sideboard"
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={title || 'Sideboard'}
          style={{
            width: '36px',
            height: '36px',
            border: '1px solid #ccc',
            borderRadius: '8px',
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <line x1="3" y1="5" x2="13" y2="5" stroke="#666" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="8" x2="13" y2="8" stroke="#666" strokeWidth="2" strokeLinecap="round" />
            <line x1="3" y1="11" x2="13" y2="11" stroke="#666" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
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
    // Already an automerge URL.
    console.log(LOG, 'tldraw doc URL found:', existing);
    const tldrawHandle = (await repo.find(existing)) as DocHandle<TldrawDoc>;

    // Check if this is an old-format doc (records at root, no `store` key).
    const tldrawDoc = tldrawHandle.doc();
    if (tldrawDoc && !tldrawDoc.store) {
      console.log(LOG, 'migrating old root-level tldraw doc to store/schema format');
      const tlStore = createTLStore({
        shapeUtils: [PatchworkDocShapeUtil, ...defaultShapeUtils],
      });
      const currentSchema = tlStore.schema.serialize();

      tldrawHandle.change((d: any) => {
        const store: Record<string, any> = {};
        for (const [id, value] of Object.entries(d)) {
          if (id === '@patchwork') continue;
          store[id] = JSON.parse(JSON.stringify(value));
          delete d[id];
        }
        d.store = store;
        d.schema = currentSchema;
      });
      console.log(LOG, 'migration to store/schema format complete');
    }

    return tldrawHandle;
  }

  if (existing && typeof existing === 'object') {
    // Legacy: tldraw data stored inline — migrate to a new doc with store/schema.
    console.log(LOG, 'migrating inline tldraw data to dedicated doc');
    const tlStore = createTLStore({
      shapeUtils: [PatchworkDocShapeUtil, ...defaultShapeUtils],
    });
    const currentSchema = tlStore.schema.serialize();
    const store: Record<string, any> = {};
    for (const [id, value] of Object.entries(existing)) {
      store[id] = value;
    }
    const initial: TldrawDoc = {
      '@patchwork': { type: 'tldraw' },
      store,
      schema: currentSchema,
    };
    const tldrawHandle = (await repo.create2(initial)) as DocHandle<TldrawDoc>;

    handle.change((d: any) => {
      d.tldraw = tldrawHandle.url;
    });
    console.log(LOG, 'migration complete, tldraw doc:', tldrawHandle.url);
    return tldrawHandle;
  }

  // No tldraw data yet — create with a proper snapshot.
  console.log(LOG, 'creating new tldraw doc');
  const tlStore = createTLStore({
    shapeUtils: [PatchworkDocShapeUtil, ...defaultShapeUtils],
  });
  const snapshot = tlStore.getStoreSnapshot();

  const initial: TldrawDoc = {
    '@patchwork': { type: 'tldraw' },
    store: tldrawValueToAutomergeValue(snapshot.store),
    schema: snapshot.schema,
  };
  const tldrawHandle = (await repo.create2(initial)) as DocHandle<TldrawDoc>;

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
  preventPatchApplicationsRef: React.MutableRefObject<boolean>,
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

  const storedCount = tldrawDoc?.store
    ? Object.keys(tldrawDoc.store).length
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
      if (preventPatchApplicationsRef.current) {
        console.log(LOG, 'tldraw→am SKIP (preventPatchApplications=true, source=' + source + ')');
        return;
      }

      preventPatchApplicationsRef.current = true;
      try {
        // Persist tldraw records to the dedicated tldraw doc.
        tldrawHandle.change((d: any) => {
          applyTLStoreChangesToAutomerge(d, changes);
        });

        // When patchwork-doc shapes are deleted, remove from the folder doc list.
        // When patchwork-doc shapes are added (e.g. undo), re-insert into the folder doc list.
        // When patchwork-doc shapes are renamed, sync name to the folder doc list.
        // Skip during reconciliation (those changes reflect docs already gone/synced).
        if (!isReconcilingRef.current) {
          const added = Object.values(changes.added);
          const removed = Object.values(changes.removed);
          const updatedPairs = Object.values(changes.updated);
          const updated = updatedPairs.map(([, after]) => after);

          // Shapes that were just added with a docUrl (e.g. undo)
          // Exclude shapes pointing at the folder itself (e.g. sideboard)
          const docsToAdd = added.filter(
            (r: any) => r.type === PATCHWORK_DOC_SHAPE_TYPE && r.props?.docUrl && r.props.docUrl !== handle.url,
          );

          // Shapes whose docUrl went from empty to non-empty (NewDocTool flow:
          // shape is created with docUrl='', then updated once the doc is ready)
          const newlyLinked = updatedPairs
            .filter(([before, after]: any) =>
              after.type === PATCHWORK_DOC_SHAPE_TYPE &&
              after.props?.docUrl &&
              after.props.docUrl !== handle.url &&
              !before.props?.docUrl,
            )
            .map(([, after]) => after);

          // Combine both sources of new docs
          docsToAdd.push(...newlyLinked);

          const docsToRemove = removed.filter(
            (r: any) => r.type === PATCHWORK_DOC_SHAPE_TYPE && r.props?.docUrl && r.props.docUrl !== handle.url,
          );
          const docsRenamed = updated.filter(
            (r: any) => r.type === PATCHWORK_DOC_SHAPE_TYPE && r.props?.docUrl && r.props?.docName,
          );

          if (docsToAdd.length > 0 || docsToRemove.length > 0 || docsRenamed.length > 0) {
            handle.change((d) => {
              if (!d.docs) d.docs = [];
              for (const record of docsToRemove) {
                const r = record as any;
                const idx = d.docs.findIndex((doc: any) => doc.url === r.props.docUrl);
                if (idx >= 0) {
                  d.docs.splice(idx, 1);
                }
              }
              for (const record of docsToAdd) {
                const r = record as any;
                const alreadyExists = d.docs.some((doc: any) => doc.url === r.props.docUrl);
                if (!alreadyExists) {
                  d.docs.push({
                    name: r.props.docName || '',
                    type: r.props.docType || '',
                    url: r.props.docUrl,
                  });
                  console.log(LOG, 'reinserted doc into folder list:', r.props.docUrl);
                }
              }
              for (const record of docsRenamed) {
                const r = record as any;
                const entry = d.docs.find((doc: any) => doc.url === r.props.docUrl);
                if (entry && (entry as any).name !== r.props.docName) {
                  (entry as any).name = r.props.docName;
                  console.log(LOG, 'synced doc name to folder list:', r.props.docName);
                }
              }
            });
          }
        }

        console.log(LOG, 'tldraw→am handle.change() succeeded');
      } catch (e) {
        console.error(LOG, 'tldraw→am handle.change() THREW', e);
      }
      preventPatchApplicationsRef.current = false;
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
    if (preventPatchApplicationsRef.current) {
      return;
    }

    // applyAutomergePatchesToTLStore already filters for path[0] === "store"
    // and naturally skips @patchwork patches.
    if (patches.length === 0) return;

    console.log(LOG, 'am→tldraw (remote patches)', patches.length, 'patches');

    preventPatchApplicationsRef.current = true;
    try {
      applyAutomergePatchesToTLStore(patches, editor.store);
    } catch (e) {
      console.error(LOG, 'am→tldraw applyPatches THREW', e);
    }
    preventPatchApplicationsRef.current = false;
  };

  tldrawHandle.on('change', handleTldrawDocChange as any);
  cleanupFnsRef.current.push(() => {
    console.log(LOG, 'removing tldraw handle change listener');
    tldrawHandle.off('change', handleTldrawDocChange as any);
  });

  // ------------------------------------------------------------------
  // 3.  Load stored document-scoped records into the editor
  //     Skip session-scoped records (camera, instance, pointer, etc.)
  //     and page records (tldraw generates a fresh page on each mount).
  // ------------------------------------------------------------------

  const SESSION_RECORD_TYPES = new Set([
    'camera', 'instance', 'instance_page_state', 'instance_presence', 'pointer', 'page',
  ]);

  if (tldrawDoc?.store) {
    const storedRecords: TLRecord[] = [];
    for (const [id, value] of Object.entries(tldrawDoc.store)) {
      if (!value || typeof value !== 'object') continue;
      if (SESSION_RECORD_TYPES.has(value.typeName)) continue;
      storedRecords.push(value as TLRecord);
    }

    if (storedRecords.length > 0) {
      console.log(LOG, 'loading', storedRecords.length, 'stored records into tldraw store');
      preventPatchApplicationsRef.current = true;
      try {
        editor.store.mergeRemoteChanges(() => {
          editor.store.put(storedRecords);
        });
        console.log(LOG, 'stored records loaded OK');
      } catch (e) {
        console.error(LOG, 'loading stored records THREW', e);
      }
      preventPatchApplicationsRef.current = false;
    } else {
      console.log(LOG, 'no stored records to load');
    }
  }

  // ------------------------------------------------------------------
  // 3b. Register image/file and paste handlers
  // ------------------------------------------------------------------

  editor.registerExternalAssetHandler('file', async ({ file, assetId }) => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    const id = assetId ?? (`asset:${crypto.randomUUID()}` as TLAssetId);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = extensionForMimeType(file.type);
    const name =
      file.name && file.name !== 'image.png'
        ? file.name
        : `Pasted image on ${new Date().toLocaleDateString()}.${ext}`;

    const fileHandle = await repo.create2({
      content: bytes,
      extension: ext,
      mimeType: file.type,
      name,
    });

    const asset = await getMediaAssetInfoPartial(file, id, isImage, isVideo);
    asset.props.src = automergeUrlToServiceWorkerUrl(fileHandle.url);

    return asset as TLAsset;
  });

  editor.registerExternalContentHandler(
    'tldraw',
    ({ point, content }: { point?: VecLike; content: TLContent }) => {
      editor.run(() => {
        const selectionBoundsBefore = editor.getSelectionPageBounds();
        editor.markHistoryStoppingPoint('paste');

        for (const shape of content.shapes) {
          if (content.rootShapeIds.includes(shape.id)) {
            shape.isLocked = false;
          }
        }

        content.schema = editor.store.schema.serialize();

        editor.putContentOntoCurrentPage(content, {
          point,
          select: true,
        });

        const selectedBoundsAfter = editor.getSelectionPageBounds();
        if (
          selectionBoundsBefore &&
          selectedBoundsAfter &&
          selectionBoundsBefore.collides(selectedBoundsAfter)
        ) {
          editor.updateInstanceState({ isChangingStyle: true });
        }
      });
    },
  );

  // ------------------------------------------------------------------
  // 3c. Ensure patchwork-doc shapes exist for every folder item
  //     These are created as *user* changes so the store listener
  //     (step 1) persists them to automerge automatically.
  // ------------------------------------------------------------------

  const withoutOwn = folderDocs.filter((d) => d.url !== tldrawHandle.url);

  isReconcilingRef.current = true;
  reconcilePatchworkDocShapes(editor, withoutOwn);
  isReconcilingRef.current = false;

  filterTldrawDocs(repo, withoutOwn).then((filteredDocs) => {
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
