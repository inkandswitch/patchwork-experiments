import { Tldraw, Editor, createShapeId, TLShapeId, TLUiComponents } from 'tldraw';
import 'tldraw/tldraw.css';
import { DocHandle } from '@automerge/automerge-repo';
import { useDocument, RepoContext } from '@automerge/automerge-repo-react-hooks';
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { FolderDoc, DocLink } from '@inkandswitch/patchwork-filesystem';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import { PatchworkDocShapeUtil, PATCHWORK_DOC_SHAPE_TYPE } from './PatchworkDocShape';
import '@inkandswitch/patchwork-elements';

// ---- Types ----------------------------------------------------------------

type LayoutEntry = { x: number; y: number; w: number; h: number };

type SpatialFolderDoc = FolderDoc & {
  layout?: { [docUrl: string]: LayoutEntry };
};

// ---- Constants -------------------------------------------------------------

const GRID_COLS = 3;
const DEFAULT_W = 400;
const DEFAULT_H = 300;
const GAP = 40;

const customShapeUtils = [PatchworkDocShapeUtil];

// Hide the page menu so users stay on a single page, but keep everything else.
const uiComponents: TLUiComponents = {
  PageMenu: null,
};

// ---- Helpers ---------------------------------------------------------------

function makeShapeId(docUrl: string): TLShapeId {
  return createShapeId(docUrl.replace(/[^a-zA-Z0-9]/g, '_'));
}

function defaultLayout(index: number): LayoutEntry {
  const col = index % GRID_COLS;
  const row = Math.floor(index / GRID_COLS);
  return {
    x: col * (DEFAULT_W + GAP),
    y: row * (DEFAULT_H + GAP),
    w: DEFAULT_W,
    h: DEFAULT_H,
  };
}

/** Return the set of docUrls that already have a patchwork-doc shape on the current page. */
function getExistingDocUrls(editor: Editor): Set<string> {
  const urls = new Set<string>();
  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type === PATCHWORK_DOC_SHAPE_TYPE) {
      urls.add((shape as any).props.docUrl as string);
    }
  }
  return urls;
}

// ---- Tool entry point ------------------------------------------------------

export const SpatialFolderTool: ToolRender = (handle, element) => {
  const repo = element.repo;
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={repo}>
      <SpatialFolderCanvas handle={handle as DocHandle<SpatialFolderDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ---- React component -------------------------------------------------------

function SpatialFolderCanvas({ handle }: { handle: DocHandle<SpatialFolderDoc> }) {
  const [doc] = useDocument<SpatialFolderDoc>(handle.url);
  const [editor, setEditor] = useState<Editor | null>(null);
  const hasZoomedRef = useRef(false);

  // Track whether *we* are currently writing layout back so we can skip the
  // resulting automerge change echo when it flows back through useDocument.
  const isSyncingToAutomergeRef = useRef(false);

  // A stable key that only changes when the *list* of doc urls/names changes
  // (not on every layout position update). This keeps the shape-sync effect
  // from running more often than necessary.
  const docUrlsKey = useMemo(
    () => (doc?.docs ?? []).map((d) => `${d.url}|${d.name}|${d.type}`).join('\n'),
    [doc?.docs],
  );

  // Keep a snapshot of docs for the effects below so they can close over a
  // stable reference that matches the docUrlsKey they were triggered by.
  const docsRef = useRef<DocLink[]>([]);
  useEffect(() => {
    docsRef.current = doc?.docs ?? [];
  }, [docUrlsKey]);

  // ------- Initialise layout entries for docs that don't have one yet -------

  useEffect(() => {
    const docs = docsRef.current;
    if (docs.length === 0) return;

    const current = handle.docSync();
    if (!current) return;

    const layout = current.layout ?? {};
    const missingUrls = docs.filter((d) => !layout[d.url]);

    if (missingUrls.length === 0) return;

    handle.change((d) => {
      if (!d.layout) {
        (d as any).layout = {};
      }
      const existingCount = Object.keys(d.layout!).length;
      let nextIdx = existingCount;
      for (const link of missingUrls) {
        if (!d.layout![link.url]) {
          d.layout![link.url] = defaultLayout(nextIdx);
          nextIdx++;
        }
      }
    });
  }, [docUrlsKey, handle]);

  // ------- Sync: automerge doc → tldraw shapes ------------------------------
  //
  // Creates shapes for new docs and removes shapes for deleted docs.
  // Position data flows automerge → tldraw **only on initial creation**; after
  // that tldraw is the source of truth for positions and writes back.
  //
  // IMPORTANT: this effect intentionally does NOT depend on doc.layout so that
  // every layout write-back from tldraw doesn't re-trigger the entire shape
  // reconciliation (which was causing the flickering).

  useEffect(() => {
    if (!editor) return;

    const docs = docsRef.current;
    if (docs.length === 0) return;

    // Read layout from handle synchronously — NOT from the reactive `doc`
    // which would force this effect to re-run on every layout change.
    const layout = handle.docSync()?.layout ?? {};

    const existingUrls = getExistingDocUrls(editor);
    const folderUrls = new Set<string>();

    for (let i = 0; i < docs.length; i++) {
      const docLink = docs[i];
      folderUrls.add(docLink.url);

      if (existingUrls.has(docLink.url)) {
        // Shape already exists – update the name / type badge if it changed.
        const shapeId = makeShapeId(docLink.url);
        const existing = editor.getShape(shapeId) as any;
        if (
          existing &&
          (existing.props.docName !== docLink.name || existing.props.docType !== docLink.type)
        ) {
          editor.updateShape({
            id: shapeId,
            type: PATCHWORK_DOC_SHAPE_TYPE,
            props: {
              docName: docLink.name,
              docType: docLink.type,
            },
          } as any);
        }
      } else {
        // New doc – create a shape at the stored (or default) position.
        const pos = layout[docLink.url] ?? defaultLayout(i);
        editor.createShape({
          id: makeShapeId(docLink.url),
          type: PATCHWORK_DOC_SHAPE_TYPE,
          x: pos.x,
          y: pos.y,
          rotation: 0,
          props: {
            w: pos.w,
            h: pos.h,
            docUrl: docLink.url,
            docName: docLink.name,
            docType: docLink.type,
          },
        } as any);
      }
    }

    // Remove patchwork-doc shapes whose docs were removed from the folder.
    for (const url of existingUrls) {
      if (!folderUrls.has(url)) {
        const id = makeShapeId(url);
        if (editor.getShape(id)) {
          editor.deleteShapes([id]);
        }
      }
    }

    // Zoom to fit all shapes on first meaningful load.
    if (!hasZoomedRef.current && docs.length > 0) {
      hasZoomedRef.current = true;
      requestAnimationFrame(() => {
        try {
          editor.zoomToFit({ animation: { duration: 300 } });
        } catch {
          // editor might have been disposed
        }
      });
    }
  }, [editor, docUrlsKey, handle]);

  // ------- Re-create patchwork-doc shapes if user deletes them --------------
  //
  // The user can freely create/delete their own drawings, text, arrows etc.
  // but patchwork-doc shapes represent the folder contents and should persist.
  // If the user deletes one we immediately recreate it.

  useEffect(() => {
    if (!editor) return;

    const unsub = editor.store.listen(
      ({ changes }) => {
        const toRecreate: any[] = [];

        for (const rec of Object.values(changes.removed)) {
          const r = rec as any;
          if (r.typeName === 'shape' && r.type === PATCHWORK_DOC_SHAPE_TYPE && r.props?.docUrl) {
            toRecreate.push(r);
          }
        }

        if (toRecreate.length === 0) return;

        // Re-create them in the next microtask so we don't mutate mid-listener.
        queueMicrotask(() => {
          for (const r of toRecreate) {
            // Only recreate if the doc is still in the folder.
            const current = handle.docSync();
            const stillInFolder = current?.docs?.some((d: DocLink) => d.url === r.props.docUrl);
            if (!stillInFolder) continue;

            editor.createShape({
              id: r.id,
              type: PATCHWORK_DOC_SHAPE_TYPE,
              x: r.x,
              y: r.y,
              rotation: 0,
              props: r.props,
            } as any);
          }
        });
      },
      { source: 'user', scope: 'document' },
    );

    return unsub;
  }, [editor, handle]);

  // ------- Sync: tldraw user changes → automerge layout ---------------------

  useEffect(() => {
    if (!editor) return;

    const unsub = editor.store.listen(
      ({ changes }) => {
        const updates: Record<string, LayoutEntry> = {};

        // Process updated shapes — only patchwork-doc shapes write layout back.
        for (const [, [, after]] of Object.entries(changes.updated)) {
          const rec = after as any;
          if (
            rec.typeName === 'shape' &&
            rec.type === PATCHWORK_DOC_SHAPE_TYPE &&
            rec.props?.docUrl
          ) {
            updates[rec.props.docUrl] = {
              x: rec.x,
              y: rec.y,
              w: rec.props.w,
              h: rec.props.h,
            };
          }
        }

        if (Object.keys(updates).length === 0) return;

        isSyncingToAutomergeRef.current = true;
        handle.change((d) => {
          if (!d.layout) {
            (d as any).layout = {};
          }
          for (const [url, entry] of Object.entries(updates)) {
            // Write each property individually so automerge can diff cleanly
            // against concurrent edits.
            if (!d.layout![url]) {
              d.layout![url] = { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
            }
            d.layout![url].x = entry.x;
            d.layout![url].y = entry.y;
            d.layout![url].w = entry.w;
            d.layout![url].h = entry.h;
          }
        });
        isSyncingToAutomergeRef.current = false;
      },
      { source: 'user', scope: 'document' },
    );

    return unsub;
  }, [editor, handle]);

  // ------- Render -----------------------------------------------------------

  if (!doc) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#888',
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Tldraw shapeUtils={customShapeUtils} onMount={setEditor} components={uiComponents} />
    </div>
  );
}
