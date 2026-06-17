import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import { AutomergeUrl, type DocHandle } from "@automerge/automerge-repo";
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { ensureAccountSubdocs } from "./ensureSubdocs";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import {
  collectLeafIds,
  findLeaf,
  findLeafIdByUrl,
  goBackIn,
  makeLeaf,
  navigateLeafIn,
  removeLeafIn,
  setLeafToolIn,
  setSizesIn,
  splitLeafIn,
} from "./layout";
import { TopBar } from "./TopBar";
import "./styles.css";
import type {
  LayoutNode,
  LeafNode,
  PanelView,
  SplitDirection,
  TilingLayoutDoc,
  TinyPatchworkConfigDoc,
} from "./types";
import {
  useContextTools,
  useDocTitle,
  useSupportedTools,
  type ContextTool,
} from "./useDocTitle";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": {
        "doc-url"?: string;
        "tool-id"?: string;
        class?: string;
        key?: string | number;
        style?: CSSProperties;
      };
    }
  }
}

type LayoutOps = {
  activeLeafId: string | null;
  focusLeaf: (id: string) => void;
  navigate: (leafId: string, view: PanelView) => void;
  goBack: (leafId: string) => void;
  split: (leafId: string, direction: SplitDirection) => void;
  close: (leafId: string) => void;
  setSizes: (splitId: string, sizes: [number, number]) => void;
  setTool: (leafId: string, toolId: string | undefined) => void;
  /** Open a context tool (comments, history, …) as a panel beside `sourceLeafId`. */
  openContext: (sourceLeafId: string, toolId: string) => void;
  /** Context tools available to launch from a content panel. */
  contextTools: ContextTool[];
  /** Id of the content panel that is the current "selected document". */
  selectedLeafId: string | null;
  /** URL of the current selected document (what context panels describe). */
  selectedDocUrl: AutomergeUrl | undefined;
};

const SplitRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect
      x="1.5"
      y="2.5"
      width="13"
      height="11"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const SplitDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect
      x="1.5"
      y="2.5"
      width="13"
      height="11"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    <line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M10 3.5L5.5 8L10 12.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M4 4L12 12M12 4L4 12"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const ToolPicker = ({
  leaf,
  ops,
}: {
  leaf: LeafNode;
  ops: LayoutOps;
}) => {
  const { tools, fallbackId } = useSupportedTools(leaf.view.url);

  if (tools.length <= 1) {
    return null;
  }

  const selected = leaf.view.toolId ?? fallbackId ?? "";

  return (
    <select
      className="tile-panel__tool-picker"
      title="Choose a tool"
      value={selected}
      onChange={(event) => ops.setTool(leaf.id, event.target.value)}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {tools.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.name ?? tool.id}
          {tool.id === fallbackId ? " (default)" : ""}
        </option>
      ))}
    </select>
  );
};

const ContextIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const SubjectIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M5.5 3.5L10 8l-4.5 4.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** A dropdown that launches a context tool bound to this panel's document. */
const ContextLauncher = ({ leaf, ops }: { leaf: LeafNode; ops: LayoutOps }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (ops.contextTools.length === 0) return null;

  return (
    <div className="tile-context-launcher" ref={containerRef}>
      <button
        className="tile-panel__icon-btn"
        title="Open context tool"
        onClick={() => setOpen((value) => !value)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <ContextIcon />
      </button>
      {open && (
        <div
          className="tile-context-launcher__menu"
          onMouseDown={(event) => event.stopPropagation()}
        >
          {ops.contextTools.map((tool) => (
            <button
              key={tool.id}
              className="tile-context-launcher__item"
              onClick={() => {
                ops.openContext(leaf.id, tool.id);
                setOpen(false);
              }}
            >
              {tool.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** Chip shown on a context panel naming the document it currently describes. */
const SubjectChip = ({ ops }: { ops: LayoutOps }) => {
  const title = useDocTitle(ops.selectedDocUrl);
  if (!ops.selectedDocUrl) return null;
  return (
    <button
      className="tile-panel__subject"
      title={`Context for: ${title}`}
      onClick={() => {
        if (ops.selectedLeafId) ops.focusLeaf(ops.selectedLeafId);
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <SubjectIcon />
      <span className="tile-panel__subject-label">{title}</span>
    </button>
  );
};

const TilePanel = ({
  leaf,
  ops,
  canClose,
}: {
  leaf: LeafNode;
  ops: LayoutOps;
  canClose: boolean;
}) => {
  const docTitle = useDocTitle(leaf.view.url);
  const isActive = ops.activeLeafId === leaf.id;
  const isContext = leaf.view.role === "context";
  const isSelected = !isContext && ops.selectedLeafId === leaf.id;
  const contextToolName = isContext
    ? ops.contextTools.find((tool) => tool.id === leaf.view.toolId)?.name
    : undefined;
  const title = isContext ? (contextToolName ?? "Context") : docTitle;
  const { focusLeaf } = ops;

  return (
    <div
      data-leaf-id={leaf.id}
      className={`tile-panel${isActive ? " tile-panel--active" : ""}${
        isSelected ? " tile-panel--selected" : ""
      }${isContext ? " tile-panel--context" : ""}`}
      onMouseDownCapture={() => focusLeaf(leaf.id)}
    >
      <div className="tile-panel__header">
        <button
          className="tile-panel__icon-btn"
          title="Back"
          disabled={leaf.history.length === 0}
          onClick={() => ops.goBack(leaf.id)}
        >
          <BackIcon />
        </button>
        <span className="tile-panel__title" title={title}>
          {title}
        </span>
        {isContext && <SubjectChip ops={ops} />}
        <div className="tile-panel__actions">
          {!isContext && <ContextLauncher leaf={leaf} ops={ops} />}
          {!isContext && <ToolPicker leaf={leaf} ops={ops} />}
          <button
            className="tile-panel__icon-btn"
            title="Split right"
            onClick={() => ops.split(leaf.id, "horizontal")}
          >
            <SplitRightIcon />
          </button>
          <button
            className="tile-panel__icon-btn"
            title="Split down"
            onClick={() => ops.split(leaf.id, "vertical")}
          >
            <SplitDownIcon />
          </button>
          {canClose && (
            <button
              className="tile-panel__icon-btn tile-panel__icon-btn--close"
              title="Close panel"
              onClick={() => ops.close(leaf.id)}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
      <div className="tile-panel__body">
        <patchwork-view
          key={leaf.id}
          class="tile-panel__view"
          doc-url={leaf.view.url}
          tool-id={leaf.view.toolId}
        />
      </div>
    </div>
  );
};

const LayoutView = ({
  node,
  ops,
  canClose,
}: {
  node: LayoutNode;
  ops: LayoutOps;
  canClose: boolean;
}) => {
  if (node.kind === "leaf") {
    return <TilePanel leaf={node} ops={ops} canClose={canClose} />;
  }

  return (
    <PanelGroup
      id={node.id}
      direction={node.direction}
      className="tile-group"
      onLayout={(sizes) => {
        if (sizes.length === 2) {
          ops.setSizes(node.id, [sizes[0], sizes[1]]);
        }
      }}
    >
      <Panel id={`${node.id}-a`} order={1} defaultSize={node.sizes[0]} minSize={10}>
        <LayoutView node={node.children[0]} ops={ops} canClose />
      </Panel>
      <PanelResizeHandle
        className={
          node.direction === "horizontal"
            ? "tile-resize-handle tile-resize-handle--vertical"
            : "tile-resize-handle tile-resize-handle--horizontal"
        }
      />
      <Panel id={`${node.id}-b`} order={2} defaultSize={node.sizes[1]} minSize={10}>
        <LayoutView node={node.children[1]} ops={ops} canClose />
      </Panel>
    </PanelGroup>
  );
};

export const PatchworkFrame = ({
  docUrl: accountDocUrl,
}: {
  docUrl: AutomergeUrl;
  element: HTMLElement | ShadowRoot;
}) => {
  const repo = useRepo();
  const [accountDoc] = useDocument<TinyPatchworkConfigDoc>(accountDocUrl, {
    suspense: true,
  });
  const accountHandle = useDocHandle<TinyPatchworkConfigDoc>(accountDocUrl, {
    suspense: true,
  });

  const rootFolderUrl = accountDoc.rootFolderUrl;
  const rootFolderHandle = useDocHandle<FolderDoc>(rootFolderUrl, {
    suspense: false,
  });

  // The panel arrangement lives in its own document so a reload restores it.
  const layoutUrl = accountDoc.tilingLayoutUrl;
  const [layoutDoc] = useDocument<TilingLayoutDoc>(layoutUrl, {
    suspense: false,
  });
  const layoutHandle = useDocHandle<TilingLayoutDoc>(layoutUrl, {
    suspense: false,
  });

  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl,
  // contactUrl) so the frame works against a freshly-created account document.
  useEffect(() => {
    if (!accountHandle || !repo) return;
    void ensureAccountSubdocs(accountHandle, repo);
  }, [accountHandle, repo]);

  // The document is the single source of truth; React just reflects it.
  const layout = layoutDoc?.layout ?? null;
  const activeLeafId = layoutDoc?.activeLeafId ?? null;
  const focusOrder = layoutDoc?.focusOrder;
  const frameRef = useRef<HTMLDivElement>(null);

  const contextTools = useContextTools();

  // The "selected document" is the most-recently-focused *content* panel
  // (context panels are excluded so opening Comments doesn't make Comments the
  // subject). Context panels describe whatever this resolves to.
  const selectedLeafId = useMemo(() => {
    if (!layout) return null;
    const order = focusOrder ?? [];
    for (let i = order.length - 1; i >= 0; i--) {
      const leaf = findLeaf(layout, order[i]);
      if (leaf && leaf.view.role !== "context") return leaf.id;
    }
    for (const id of collectLeafIds(layout)) {
      const leaf = findLeaf(layout, id);
      if (leaf && leaf.view.role !== "context") return leaf.id;
    }
    return null;
  }, [layout, focusOrder]);

  const selectedDocUrl = useMemo<AutomergeUrl | undefined>(() => {
    if (!layout || !selectedLeafId) return undefined;
    return findLeaf(layout, selectedLeafId)?.view.url;
  }, [layout, selectedLeafId]);

  // Refs hold the latest doc/handle so the once-mounted open-document listener
  // and pointer handlers can read current state synchronously.
  const docRef = useRef<TilingLayoutDoc | undefined>(undefined);
  docRef.current = layoutDoc;
  const handleRef = useRef<DocHandle<TilingLayoutDoc> | undefined>(undefined);
  handleRef.current = layoutHandle;

  const change = useCallback((fn: (doc: TilingLayoutDoc) => void) => {
    handleRef.current?.change(fn);
  }, []);

  // Seed the document once with a root-folder panel if it has no layout yet.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !layoutHandle || layoutDoc === undefined) return;
    if (layoutDoc.layout) {
      seededRef.current = true;
      return;
    }
    if (!rootFolderUrl) return;
    seededRef.current = true;
    const leaf = makeLeaf({ url: rootFolderUrl });
    layoutHandle.change((doc) => {
      doc.layout = leaf;
      doc.activeLeafId = leaf.id;
      doc.focusOrder = [leaf.id];
    });
  }, [layoutDoc, layoutHandle, rootFolderUrl]);

  const focusLeaf = useCallback(
    (id: string) => {
      const doc = docRef.current;
      if (
        doc &&
        doc.activeLeafId === id &&
        doc.focusOrder?.[doc.focusOrder.length - 1] === id
      ) {
        return;
      }
      change((d) => {
        if (!d.focusOrder) d.focusOrder = [];
        const idx = [...d.focusOrder].indexOf(id);
        if (idx !== -1) d.focusOrder.splice(idx, 1);
        d.focusOrder.push(id);
        d.activeLeafId = id;
      });
    },
    [change],
  );

  const navigate = useCallback(
    (leafId: string, view: PanelView) => {
      change((d) => navigateLeafIn(d, leafId, view));
    },
    [change],
  );

  const goBack = useCallback(
    (leafId: string) => {
      change((d) => goBackIn(d, leafId));
    },
    [change],
  );

  const setTool = useCallback(
    (leafId: string, toolId: string | undefined) => {
      change((d) => setLeafToolIn(d, leafId, toolId));
    },
    [change],
  );

  const split = useCallback(
    (leafId: string, direction: SplitDirection) => {
      // The new panel mirrors the source panel's current view so you can
      // diverge each side independently afterwards.
      const current = docRef.current?.layout ?? null;
      const source = current ? findLeaf(current, leafId) : null;
      const newView: PanelView = source
        ? { url: source.view.url, toolId: source.view.toolId }
        : rootFolderUrl
          ? { url: rootFolderUrl }
          : { url: leafId as AutomergeUrl };
      const newLeaf = makeLeaf(newView);
      change((d) => splitLeafIn(d, leafId, direction, newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, focusLeaf, rootFolderUrl],
  );

  // Spawn a context tool as a new panel beside the source. The source becomes
  // the selected subject; the context panel is marked so it never becomes the
  // subject itself.
  const openContext = useCallback(
    (sourceLeafId: string, toolId: string) => {
      focusLeaf(sourceLeafId);
      const newLeaf = makeLeaf({
        url: accountDocUrl,
        toolId,
        role: "context",
      });
      change((d) => splitLeafIn(d, sourceLeafId, "horizontal", newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, focusLeaf, accountDocUrl],
  );

  const close = useCallback(
    (leafId: string) => {
      change((d) => {
        removeLeafIn(d, leafId);
        // Never leave an empty frame: fall back to the root folder.
        if (!d.layout && rootFolderUrl) d.layout = makeLeaf({ url: rootFolderUrl });
        const ids = d.layout ? collectLeafIds(d.layout) : [];
        const live = new Set(ids);
        if (!d.focusOrder) d.focusOrder = [];
        for (let i = d.focusOrder.length - 1; i >= 0; i--) {
          if (!live.has(d.focusOrder[i])) d.focusOrder.splice(i, 1);
        }
        if (!d.activeLeafId || !live.has(d.activeLeafId)) {
          d.activeLeafId = d.focusOrder[d.focusOrder.length - 1] ?? ids[0] ?? null;
        }
        if (d.activeLeafId && [...d.focusOrder].indexOf(d.activeLeafId) === -1) {
          d.focusOrder.push(d.activeLeafId);
        }
      });
    },
    [change, rootFolderUrl],
  );

  // Resize fires continuously while dragging; debounce per-split so only the
  // settled size is written to the document.
  const sizeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const setSizes = useCallback(
    (splitId: string, sizes: [number, number]) => {
      const timers = sizeTimers.current;
      const pending = timers.get(splitId);
      if (pending) clearTimeout(pending);
      timers.set(
        splitId,
        setTimeout(() => {
          timers.delete(splitId);
          change((d) => setSizesIn(d, splitId, sizes));
        }, 200),
      );
    },
    [change],
  );

  // Route a document-open request. A tool that triggers navigation (e.g. the
  // folder tree) should not replace itself — it navigates the last-focused
  // *other* panel, or opens a new panel beside the source when no such target
  // exists yet. `sourceId` is the panel the request came from (null for
  // app-level chrome like the top bar, which targets the active panel).
  const openView = useCallback(
    (view: PanelView, sourceId: string | null) => {
      const doc = docRef.current;
      const current = doc?.layout ?? null;
      if (!current) return;

      const leafIds = collectLeafIds(current);
      const liveIds = new Set(leafIds);
      const order = doc?.focusOrder ?? [];

      let destination: string | null = null;
      for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i];
        if (id !== sourceId && liveIds.has(id)) {
          destination = id;
          break;
        }
      }

      if (destination) {
        navigate(destination, view);
        focusLeaf(destination);
        return;
      }

      // No existing target panel: open a new one beside the source.
      const active = doc?.activeLeafId ?? null;
      const splitSource =
        (sourceId && liveIds.has(sourceId) && sourceId) ||
        (active && liveIds.has(active) && active) ||
        leafIds[0];
      if (!splitSource) return;
      const newLeaf = makeLeaf(view);
      change((d) => splitLeafIn(d, splitSource, "horizontal", newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, navigate, focusLeaf],
  );

  const handleOpenDocument = useCallback(
    (event: OpenDocumentEvent) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      const target = event.target as Element | null;
      const sourceId =
        target?.closest?.("[data-leaf-id]")?.getAttribute("data-leaf-id") ??
        null;
      openView(
        { url: event.detail.url, toolId: event.detail.toolId },
        sourceId,
      );
    },
    [openView],
  );

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const listener = handleOpenDocument as unknown as EventListener;
    el.addEventListener("patchwork:open-document", listener);
    return () => el.removeEventListener("patchwork:open-document", listener);
  }, [handleOpenDocument]);

  // Top-bar "open" actions originate outside any panel, so they target the
  // active panel (or open a new one if the frame is somehow empty).
  const openFromChrome = useCallback(
    (view: PanelView) => openView(view, null),
    [openView],
  );

  // Home: focus an existing panel showing the root folder, else open it.
  const goHome = useCallback(() => {
    if (!rootFolderUrl) return;
    const current = docRef.current?.layout ?? null;
    const existing = current ? findLeafIdByUrl(current, rootFolderUrl) : null;
    if (existing) {
      focusLeaf(existing);
      return;
    }
    openFromChrome({ url: rootFolderUrl });
  }, [rootFolderUrl, focusLeaf, openFromChrome]);

  const ops: LayoutOps = {
    activeLeafId,
    focusLeaf,
    navigate,
    goBack,
    split,
    close,
    setSizes,
    setTool,
    openContext,
    contextTools,
    selectedLeafId,
    selectedDocUrl,
  };

  return (
    <div className="tile-app">
      <TopBar
        repo={repo}
        accountDocUrl={accountDocUrl}
        moduleSettingsUrl={accountDoc.moduleSettingsUrl}
        contactUrl={accountDoc.contactUrl}
        rootFolderHandle={rootFolderHandle}
        onHome={goHome}
        onOpen={openFromChrome}
      />
      <div className="tile-frame" ref={frameRef}>
        {layout ? (
          <LayoutView
            node={layout}
            ops={ops}
            canClose={layout.kind === "split"}
          />
        ) : (
          <div className="tile-frame__empty">
            {rootFolderUrl ? "Loading…" : "Setting up your workspace…"}
          </div>
        )}
      </div>
    </div>
  );
};

export function renderPatchworkFrame(
  handle: { url: AutomergeUrl },
  element: ToolElement,
) {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <Suspense
        fallback={
          <div className="tile-frame">
            <div className="tile-frame__empty">Loading…</div>
          </div>
        }
      >
        <PatchworkFrame docUrl={handle.url} element={element} />
      </Suspense>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
}
