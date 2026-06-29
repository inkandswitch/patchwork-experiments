import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import {
  AutomergeUrl,
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import type {
  ToolDescription,
  ToolElement,
} from "@inkandswitch/patchwork-plugins";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  cloneLayout,
  collectLeafIds,
  ensureContentFrameIn,
  findLeaf,
  findLeafIdByUrl,
  findRootFolderLeafId,
  goBackIn,
  isContentLeaf,
  makeInitialLayout,
  makeLeaf,
  makeRootFolderLeaf,
  moveLeafIn,
  navigateLeafIn,
  normalizeRootFolderIn,
  removeLeafIn,
  setLeafToolIn,
  setSizesIn,
  splitLeafIn,
} from "./layout";
import { TopBar } from "./TopBar";
import { FrameProviders } from "./FrameProviders";
import "./styles.css";
import type {
  DropSide,
  LayoutNode,
  LeafNode,
  PanelView,
  SplitDirection,
  TilingLayoutDoc,
  TinyPatchworkConfigDoc,
  ToolPreferences,
} from "./types";
import {
  useContextTools,
  useDocTitle,
  useEffectiveTool,
  type ContextTool,
} from "./useDocTitle";
import { rememberToolInDoc } from "./toolMemory";

/**
 * Which pane *this tab* is looking at. Deliberately **not** synced: focus and
 * selection are per-tab session state. Storing them in the shared layout doc
 * (as we used to) made every tab mirror one another's focus — clicking a pane
 * in one tab moved the selection, accent, and context-tool target in all the
 * others. We keep it in component state and mirror it to `sessionStorage`,
 * which is naturally scoped to a single tab and survives that tab's reloads.
 */
type TabFocus = { activeLeafId: string | null; focusOrder: string[] };

const EMPTY_FOCUS: TabFocus = { activeLeafId: null, focusOrder: [] };

const readTabFocus = (key: string | null): TabFocus => {
  if (!key) return { ...EMPTY_FOCUS };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return { ...EMPTY_FOCUS };
    const parsed = JSON.parse(raw) as Partial<TabFocus>;
    if (Array.isArray(parsed.focusOrder)) {
      return {
        activeLeafId:
          typeof parsed.activeLeafId === "string" ? parsed.activeLeafId : null,
        focusOrder: parsed.focusOrder.filter(
          (id): id is string => typeof id === "string",
        ),
      };
    }
  } catch {
    // Corrupt/unavailable storage: fall back to empty focus.
  }
  return { ...EMPTY_FOCUS };
};

const writeTabFocus = (key: string | null, focus: TabFocus): void => {
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify(focus));
  } catch {
    // Storage may be full or disabled; focus just won't survive reload.
  }
};

const sameFocus = (a: TabFocus, b: TabFocus): boolean =>
  a.activeLeafId === b.activeLeafId &&
  a.focusOrder.length === b.focusOrder.length &&
  a.focusOrder.every((id, i) => id === b.focusOrder[i]);

const LAYOUT_TYPE = "patchwork-frame-tiling:layout";

// The page URL identifies *this tab's* layout document (`#…&layout=<docId>`),
// which makes tabs independent sessions: each gets its own arrangement, the
// arrangement survives reload, and an arrangement is shareable by copying the
// URL. The host's hash router preserves params it doesn't recognize, so this
// `layout` key coexists with its `doc`/`tool`/… keys.
const LAYOUT_PARAM = "layout";

const readLayoutParam = (): AutomergeUrl | undefined => {
  try {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get(
      LAYOUT_PARAM,
    );
    if (!raw) return undefined;
    const url = raw.startsWith("automerge:") ? raw : `automerge:${raw}`;
    return isValidAutomergeUrl(url) ? url : undefined;
  } catch {
    return undefined;
  }
};

const writeLayoutParam = (url: AutomergeUrl): void => {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    // Stored without the `automerge:` prefix to stay compact, matching `doc`.
    params.set(LAYOUT_PARAM, url.replace(/^automerge:/, ""));
    const href = `${window.location.pathname}${window.location.search}#${params.toString()}`;
    // replaceState: minting a session shouldn't add a back-button entry, and
    // (unlike assigning `location.hash`) it won't fire a spurious `hashchange`.
    window.history.replaceState(window.history.state, "", href);
  } catch {
    // Non-fatal: the session just won't be reflected in the URL.
  }
};

// The host's hash router owns the `doc`/`tool` (and `heads`/`title`/`type`)
// params: it writes them when an open bubbles up, and — crucially — re-dispatches
// `patchwork:open-document` for the URL's `doc` on every `patchwork:mounted` and
// `hashchange`. If that param ever names a doc we *don't* have open, the
// re-dispatch resurrects it (the "closing a panel reopens it" bug). So the frame
// keeps `doc`/`tool` pointed at the selected panel; the re-dispatch then always
// lands on an open doc and is a harmless focus.
const DOC_PARAM = "doc";

const readDocParam = (): string | null => {
  try {
    return new URLSearchParams(window.location.hash.slice(1)).get(DOC_PARAM);
  } catch {
    return null;
  }
};

const syncDocParam = (
  url: AutomergeUrl | undefined,
  toolId: string | null,
): void => {
  try {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const before = params.toString();
    if (url) {
      const { documentId, heads } = parseAutomergeUrl(url);
      params.set(DOC_PARAM, documentId);
      if (heads && heads.length) params.set("heads", heads.join("|"));
      else params.delete("heads");
    } else {
      params.delete(DOC_PARAM);
      params.delete("heads");
    }
    if (toolId) params.set("tool", toolId);
    else params.delete("tool");
    // `title`/`type` belonged to whatever the host last routed; the host
    // recomputes them from the doc, so dropping them is safe and stops a stale
    // `type` from being applied to a different document.
    params.delete("title");
    params.delete("type");
    if (params.toString() === before) return;
    const href = `${window.location.pathname}${window.location.search}#${params.toString()}`;
    // replaceState (not `location.hash =`) so we don't add history entries or
    // fire a `hashchange` that would loop back through the host's router.
    window.history.replaceState(window.history.state, "", href);
  } catch {
    // Non-fatal: the URL just won't reflect the selection.
  }
};

type TabLayoutSession = {
  /** This tab's layout document (from the URL, or freshly minted). */
  layoutUrl: AutomergeUrl | undefined;
  /**
   * For a freshly-minted session, the doc to clone the initial arrangement
   * from (the previous "current" layout). Captured at mint so that claiming
   * `currentLayoutUrl = this` afterwards can't change what we copy from.
   * `undefined` for resumed/shared sessions or when there's nothing to clone.
   */
  cloneSourceUrl: AutomergeUrl | undefined;
};

/**
 * Resolve this tab's layout document. If the URL names one (reload, shared
 * link, back/forward), use it. Otherwise mint a fresh session and record it in
 * the URL, capturing the account's current layout as the clone source so the
 * new tab resumes from your last session while staying independent.
 */
function useTabLayoutSession(
  repo: Repo,
  accountHandle: DocHandle<TinyPatchworkConfigDoc> | undefined,
): TabLayoutSession {
  const [layoutUrl, setLayoutUrl] = useState<AutomergeUrl | undefined>(() =>
    readLayoutParam(),
  );
  const [cloneSourceUrl, setCloneSourceUrl] = useState<
    AutomergeUrl | undefined
  >(undefined);
  const mintedRef = useRef(false);

  useEffect(() => {
    if (layoutUrl || mintedRef.current || !accountHandle) return;
    mintedRef.current = true;
    const account = accountHandle.doc();
    const source = account?.currentLayoutUrl ?? account?.tilingLayoutUrl;
    const handle = repo.create<TilingLayoutDoc>();
    handle.change((doc) => {
      doc.layout = null;
      doc["@patchwork"] = { type: LAYOUT_TYPE };
    });
    // Claim the URL synchronously so a re-mount (e.g. StrictMode) reuses this
    // doc instead of minting a second one.
    writeLayoutParam(handle.url);
    if (source && source !== handle.url) setCloneSourceUrl(source);
    setLayoutUrl(handle.url);
  }, [layoutUrl, repo, accountHandle]);

  // Follow back/forward (or a manual hash edit) to a different session.
  useEffect(() => {
    const onHashChange = () => {
      const next = readLayoutParam();
      if (next && next !== layoutUrl) {
        setCloneSourceUrl(undefined);
        setLayoutUrl(next);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [layoutUrl]);

  return { layoutUrl, cloneSourceUrl };
}

type LayoutOps = {
  activeLeafId: string | null;
  focusLeaf: (id: string) => void;
  navigate: (leafId: string, view: PanelView) => void;
  goBack: (leafId: string) => void;
  split: (leafId: string, direction: SplitDirection) => void;
  close: (leafId: string) => void;
  /** Re-tile `sourceLeafId` against `targetLeafId` on the given side (drag/drop). */
  moveLeaf: (sourceLeafId: string, targetLeafId: string, side: DropSide) => void;
  /** The panel currently being dragged (drives drop-zone overlays), or null. */
  draggingId: string | null;
  /** Begin/end a panel drag. */
  beginDrag: (leafId: string) => void;
  endDrag: () => void;
  setSizes: (splitId: string, sizes: [number, number]) => void;
  setTool: (leafId: string, toolId: string | undefined) => void;
  /** Open a context tool (comments, history, …) as a panel beside `sourceLeafId`. */
  openContext: (sourceLeafId: string, toolId: string) => void;
  /** Context tools available to launch from a content panel. */
  contextTools: ContextTool[];
  /** The viewer's own root-folder url, used to resolve `"root-folder"` panels. */
  rootFolderUrl: AutomergeUrl | undefined;
  /** Id of the content panel that is the current "selected document". */
  selectedLeafId: string | null;
  /** URL of the current selected document (what context panels describe). */
  selectedDocUrl: AutomergeUrl | undefined;
  /** The user's remembered tool choices (account-synced), for defaulting. */
  toolPreferences: ToolPreferences | undefined;
  /** Persist an explicit tool choice for this doc and its datatype. */
  rememberTool: (
    url: AutomergeUrl,
    type: string | undefined,
    toolId: string,
  ) => void;
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
  tools,
  fallbackId,
  type,
  selected,
}: {
  leaf: LeafNode;
  ops: LayoutOps;
  tools: ToolDescription[];
  fallbackId: string | undefined;
  type: string | undefined;
  selected: string | undefined;
}) => {
  if (tools.length <= 1) {
    return null;
  }

  return (
    <select
      className="tile-panel__tool-picker"
      title="Choose a tool"
      value={selected ?? ""}
      onChange={(event) => {
        const toolId = event.target.value;
        // Persist the choice on the panel and remember it (on the account) as
        // the preferred tool for this doc and datatype so future opens default
        // to it.
        ops.setTool(leaf.id, toolId);
        if (leaf.view.url) ops.rememberTool(leaf.view.url, type, toolId);
      }}
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

const GripIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <circle cx="6" cy="4" r="1.1" />
    <circle cx="10" cy="4" r="1.1" />
    <circle cx="6" cy="8" r="1.1" />
    <circle cx="10" cy="8" r="1.1" />
    <circle cx="6" cy="12" r="1.1" />
    <circle cx="10" cy="12" r="1.1" />
  </svg>
);

/** Which edge of `el` the cursor is nearest — the 4 triangular drop zones. */
const computeDropSide = (
  event: { clientX: number; clientY: number },
  el: HTMLElement,
): DropSide => {
  const r = el.getBoundingClientRect();
  const x = r.width ? (event.clientX - r.left) / r.width : 0.5;
  const y = r.height ? (event.clientY - r.top) / r.height : 0.5;
  const dist = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  let side: DropSide = "right";
  let min = Infinity;
  (Object.keys(dist) as DropSide[]).forEach((k) => {
    if (dist[k] < min) {
      min = dist[k];
      side = k;
    }
  });
  return side;
};

/**
 * Drop surface laid over a (non-source) panel's body while a drag is active.
 * It sits above the embedded view so drag events land here rather than inside
 * an iframe/tool, previews the target edge, and commits the move on drop.
 */
const DropZones = ({ leaf, ops }: { leaf: LeafNode; ops: LayoutOps }) => {
  const [side, setSide] = useState<DropSide | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="tile-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (ref.current) setSide(computeDropSide(event, ref.current));
      }}
      onDragLeave={(event) => {
        // Ignore leaves into child nodes of the overlay.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setSide(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId =
          event.dataTransfer.getData("text/plain") || ops.draggingId;
        const dropSide = ref.current
          ? computeDropSide(event, ref.current)
          : (side ?? "right");
        setSide(null);
        if (sourceId) ops.moveLeaf(sourceId, leaf.id, dropSide);
      }}
    >
      {side && (
        <div
          className={`tile-dropzone__preview tile-dropzone__preview--${side}`}
        />
      )}
    </div>
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
  const isActive = ops.activeLeafId === leaf.id;
  const isContext = leaf.view.role === "context";
  const isRootFolder = leaf.view.role === "root-folder";
  // A `"root-folder"` panel stores no url; resolve it to the *viewer's* own
  // root folder so a shared layout shows the recipient's folders, not the
  // author's.
  const resolvedUrl = isRootFolder ? ops.rootFolderUrl : leaf.view.url;
  const isEmpty = !isContext && !isRootFolder && !resolvedUrl;
  const docTitle = useDocTitle(resolvedUrl);
  const isSelected =
    !isContext && !isRootFolder && !isEmpty && ops.selectedLeafId === leaf.id;
  const contextToolName = isContext
    ? ops.contextTools.find((tool) => tool.id === leaf.view.toolId)?.name
    : undefined;
  const title = isContext
    ? (contextToolName ?? "Context")
    : isEmpty
      ? "Empty"
      : docTitle;
  const { focusLeaf } = ops;

  // Resolve the tool to render: explicit panel choice, else the remembered
  // preference for this doc / datatype, else the datatype default.
  const { toolId: effectiveToolId, tools, fallbackId, type } = useEffectiveTool(
    resolvedUrl,
    leaf.view.toolId,
    ops.toolPreferences,
  );

  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = ops.draggingId === leaf.id;
  const isDropTarget = ops.draggingId !== null && !isDragging;

  return (
    <div
      ref={panelRef}
      data-leaf-id={leaf.id}
      className={`tile-panel${isActive ? " tile-panel--active" : ""}${
        isSelected ? " tile-panel--selected" : ""
      }${isContext ? " tile-panel--context" : ""}${
        isDragging ? " tile-panel--dragging" : ""
      }`}
      onMouseDownCapture={() => focusLeaf(leaf.id)}
    >
      <div className="tile-panel__header">
        <button
          className="tile-panel__grip"
          title="Drag to rearrange"
          aria-label="Drag to rearrange panel"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", leaf.id);
            if (panelRef.current) {
              event.dataTransfer.setDragImage(panelRef.current, 24, 16);
            }
            ops.beginDrag(leaf.id);
          }}
          onDragEnd={() => ops.endDrag()}
        >
          <GripIcon />
        </button>
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
          {!isContext && !isRootFolder && !isEmpty && (
            <ContextLauncher leaf={leaf} ops={ops} />
          )}
          {!isContext && !isRootFolder && !isEmpty && (
            <ToolPicker
              leaf={leaf}
              ops={ops}
              tools={tools}
              fallbackId={fallbackId}
              type={type}
              selected={effectiveToolId}
            />
          )}
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
        {isEmpty ? (
          <div className="tile-panel__empty">
            <p>No document open</p>
            <span>Open one from the folder, or use + in the top bar.</span>
          </div>
        ) : (
          <patchwork-view
            key={leaf.id}
            className="tile-panel__view"
            doc-url={resolvedUrl}
            tool-id={effectiveToolId}
          />
        )}
        {isDropTarget && <DropZones leaf={leaf} ops={ops} />}
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
  element,
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

  // Each tab gets its own layout document, identified in the URL, so tabs are
  // independent sessions rather than one mirrored workspace. A freshly-minted
  // session clones `cloneSourceUrl` (the last session) so a new tab resumes
  // where you left off.
  const { layoutUrl, cloneSourceUrl } = useTabLayoutSession(repo, accountHandle);
  const [layoutDoc] = useDocument<TilingLayoutDoc>(layoutUrl, {
    suspense: false,
  });
  const layoutHandle = useDocHandle<TilingLayoutDoc>(layoutUrl, {
    suspense: false,
  });
  const [cloneSourceDoc] = useDocument<TilingLayoutDoc>(cloneSourceUrl, {
    suspense: false,
  });

  // Lazily populate subdoc fields (rootFolderUrl, moduleSettingsUrl,
  // contactUrl) so the frame works against a freshly-created account document.
  useEffect(() => {
    if (!accountHandle || !repo) return;
    void ensureAccountSubdocs(accountHandle, repo);
  }, [accountHandle, repo]);

  // Account-aware tools (comments, contact avatar, chat, …) read the current
  // account from `window.accountDocHandle`. Point it at the account this frame
  // manages so authorship/contact lookups resolve even if the host hasn't set
  // it (or set a different account).
  useEffect(() => {
    if (!accountHandle) return;
    (window as unknown as { accountDocHandle?: DocHandle<TinyPatchworkConfigDoc> }).accountDocHandle =
      accountHandle;
  }, [accountHandle]);

  // Make this tab's session the account's "current" layout whenever the tab is
  // the visible one, so a future new tab resumes from the session you were last
  // looking at. The previous `currentLayoutUrl` simply becomes unreferenced
  // (POSIX unlink): it stays in cold storage but is never loaded again.
  useEffect(() => {
    if (!layoutUrl || !accountHandle) return;
    const markCurrent = () => {
      if (document.visibilityState !== "visible") return;
      if (accountHandle.doc()?.currentLayoutUrl === layoutUrl) return;
      accountHandle.change((d) => {
        d.currentLayoutUrl = layoutUrl;
      });
    };
    markCurrent();
    document.addEventListener("visibilitychange", markCurrent);
    return () => document.removeEventListener("visibilitychange", markCurrent);
  }, [layoutUrl, accountHandle]);

  // The *structure* (panel tree, tools, sizes) is the synced doc's job; React
  // reflects it. Focus/selection is per-tab session state (see {@link TabFocus}).
  const layout = layoutDoc?.layout ?? null;

  const focusStorageKey = layoutUrl ? `tiling-focus:${layoutUrl}` : null;
  const [focus, setFocus] = useState<TabFocus>(() =>
    readTabFocus(focusStorageKey),
  );
  const focusRef = useRef(focus);
  focusRef.current = focus;
  // Latest storage key for write-through (kept in a ref so the stable
  // `commitFocus` always persists under the current key).
  const focusKeyRef = useRef(focusStorageKey);
  focusKeyRef.current = focusStorageKey;
  const activeLeafId = focus.activeLeafId;
  const focusOrder = focus.focusOrder;

  // Apply a focus update through the ref *and* state (so callbacks that read
  // `focusRef.current` immediately after committing see the new value) and
  // write it through to sessionStorage.
  const commitFocus = useCallback((updater: (prev: TabFocus) => TabFocus) => {
    const next = updater(focusRef.current);
    if (sameFocus(next, focusRef.current)) return;
    focusRef.current = next;
    setFocus(next);
    writeTabFocus(focusKeyRef.current, next);
  }, []);

  // `tilingLayoutUrl` may only resolve after the first render (it's created
  // lazily on a fresh account), so re-hydrate focus from storage once the key
  // appears or changes. Done before the prune effect so the reconcile below
  // sees the restored focus.
  const loadedKeyRef = useRef(focusStorageKey);
  useEffect(() => {
    if (loadedKeyRef.current === focusStorageKey) return;
    loadedKeyRef.current = focusStorageKey;
    const loaded = readTabFocus(focusStorageKey);
    focusRef.current = loaded;
    setFocus(loaded);
  }, [focusStorageKey]);

  // Reconcile per-tab focus against the (possibly remotely-edited) structure:
  // drop ids for panes that no longer exist and re-select if the active pane
  // was closed — in this tab or another. New panes are focused explicitly by
  // whoever creates them, so we don't auto-add them here.
  useEffect(() => {
    const ids = layout ? collectLeafIds(layout) : [];
    const live = new Set(ids);
    commitFocus((prev) => {
      const order = prev.focusOrder.filter((id) => live.has(id));
      let active = prev.activeLeafId;
      if (!active || !live.has(active)) {
        active = order[order.length - 1] ?? ids[0] ?? null;
      }
      if (active && !order.includes(active)) order.push(active);
      return { activeLeafId: active, focusOrder: order };
    });
  }, [layout, commitFocus]);

  const contextTools = useContextTools(accountDoc.contextToolIds);

  // The "selected document" is the most-recently-focused *content* panel
  // (context panels are excluded so opening Comments doesn't make Comments the
  // subject). Context panels describe whatever this resolves to.
  const selectedLeafId = useMemo(() => {
    if (!layout) return null;
    const order = focusOrder ?? [];
    for (let i = order.length - 1; i >= 0; i--) {
      const leaf = findLeaf(layout, order[i]);
      if (leaf && isContentLeaf(leaf, rootFolderUrl) && leaf.view.url) return leaf.id;
    }
    for (const id of collectLeafIds(layout)) {
      const leaf = findLeaf(layout, id);
      if (leaf && isContentLeaf(leaf, rootFolderUrl) && leaf.view.url) return leaf.id;
    }
    return null;
  }, [layout, focusOrder, rootFolderUrl]);

  const selectedLeafView = useMemo(() => {
    if (!layout || !selectedLeafId) return undefined;
    return findLeaf(layout, selectedLeafId)?.view;
  }, [layout, selectedLeafId]);
  const selectedDocUrl = selectedLeafView?.url;
  const selectedToolId = selectedLeafView?.toolId ?? null;

  // Refs hold the latest doc/handle so the once-mounted open-document listener
  // and pointer handlers can read current state synchronously.
  const docRef = useRef<TilingLayoutDoc | undefined>(undefined);
  docRef.current = layoutDoc;
  const handleRef = useRef<DocHandle<TilingLayoutDoc> | undefined>(undefined);
  handleRef.current = layoutHandle;

  // Mirror the selected content panel into the URL's `doc`/`tool` params (see
  // `syncDocParam`). Two subtleties:
  //  - We read the *post-change* layout straight off the handle (`doc()` is
  //    synchronous and already reflects the just-applied change) so that a close
  //    pins the URL to the survivor *before* React commits the remount that
  //    would otherwise let the host re-dispatch — and resurrect — the closed doc.
  //  - On first load we must not overwrite an inbound deep-link before the host
  //    has opened it. We hold off syncing until the URL's `doc` is actually the
  //    selected panel (or there was none); a timeout failsafe re-enables it.
  const initialDocRef = useRef<string | null>(readDocParam());
  const syncEnabledRef = useRef(false);
  useEffect(() => {
    if (syncEnabledRef.current) return;
    const t = setTimeout(() => {
      syncEnabledRef.current = true;
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  const syncUrlToSelection = useCallback(() => {
    let current: TilingLayoutDoc["layout"] | null = null;
    try {
      current = handleRef.current?.doc()?.layout ?? null;
    } catch {
      current = null;
    }
    if (!current) current = docRef.current?.layout ?? null;
    if (!current) return;
    const layout = current;
    const order = focusRef.current.focusOrder;
    let leaf: LeafNode | null = null;
    for (let i = order.length - 1; i >= 0 && !leaf; i--) {
      const l = findLeaf(layout, order[i]);
      if (l && l.view.role !== "context" && l.view.url) leaf = l;
    }
    if (!leaf) {
      for (const id of collectLeafIds(layout)) {
        const l = findLeaf(layout, id);
        if (l && l.view.role !== "context" && l.view.url) {
          leaf = l;
          break;
        }
      }
    }
    if (!syncEnabledRef.current) {
      const want = initialDocRef.current;
      const have = leaf?.view.url
        ? parseAutomergeUrl(leaf.view.url).documentId
        : null;
      if (want && want !== have) return; // deep-link not opened yet — leave it
      syncEnabledRef.current = true;
    }
    syncDocParam(leaf?.view.url, leaf?.view.toolId ?? null);
  }, []);

  const change = useCallback(
    (fn: (doc: TilingLayoutDoc) => void) => {
      handleRef.current?.change(fn);
      syncUrlToSelection();
    },
    [syncUrlToSelection],
  );

  // Catch selection changes that don't flow through change()/focusLeaf() — e.g.
  // the prune effect re-selecting after another tab edited a shared layout. The
  // synchronous calls above still matter for close (they beat the commit-phase
  // remount); this is the after-commit backstop. Gating in syncUrlToSelection
  // keeps this from clobbering an inbound deep-link on first load.
  useEffect(() => {
    syncUrlToSelection();
  }, [selectedDocUrl, selectedToolId, syncUrlToSelection]);

  // Seed a freshly-minted session doc once: clone the last session's
  // arrangement (so a new tab resumes where you left off), otherwise open a
  // root-folder pane. When there's a clone source we wait for it to load so we
  // don't seed a bare pane and lose the clone.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !layoutHandle || layoutDoc === undefined) return;
    if (layoutDoc.layout) {
      seededRef.current = true;
      return;
    }
    if (cloneSourceUrl) {
      if (cloneSourceDoc === undefined) return; // clone source still loading
      const sourceLayout = cloneSourceDoc.layout;
      if (sourceLayout) {
        seededRef.current = true;
        layoutHandle.change((doc) => {
          doc.layout = cloneLayout(sourceLayout);
          // Drop the author's embedded folder url in favor of the symbolic
          // role so the clone resolves to *this* viewer's folder.
          if (rootFolderUrl) normalizeRootFolderIn(doc, rootFolderUrl);
          // Older sessions were seeded as a lone folder pane; give them a
          // content frame so the clone doesn't start full-width-folder.
          ensureContentFrameIn(doc, rootFolderUrl);
        });
        return;
      }
      // Source exists but is empty → fall through to the initial layout.
    }
    seededRef.current = true;
    layoutHandle.change((doc) => {
      doc.layout = makeInitialLayout();
    });
  }, [layoutDoc, layoutHandle, cloneSourceUrl, cloneSourceDoc, rootFolderUrl]);

  // One-time migration for already-seeded sessions: rewrite a legacy url-based
  // root-folder pane to the symbolic role so this session (and shares of it)
  // shows the viewer's own folder rather than embedding a specific one. The
  // edit removes the url, so it's idempotent and won't re-fire.
  const normalizedRef = useRef(false);
  useEffect(() => {
    if (normalizedRef.current || !layoutHandle || !rootFolderUrl) return;
    if (!layoutDoc?.layout) return;
    normalizedRef.current = true;
    layoutHandle.change((doc) => {
      normalizeRootFolderIn(doc, rootFolderUrl);
    });
  }, [layoutDoc, layoutHandle, rootFolderUrl]);

  const focusLeaf = useCallback(
    (id: string) => {
      commitFocus((prev) => {
        if (
          prev.activeLeafId === id &&
          prev.focusOrder[prev.focusOrder.length - 1] === id
        ) {
          return prev;
        }
        const order = prev.focusOrder.filter((x) => x !== id);
        order.push(id);
        return { activeLeafId: id, focusOrder: order };
      });
      // commitFocus updates focusRef synchronously, so the selection read here
      // reflects the new focus order.
      syncUrlToSelection();
    },
    [commitFocus, syncUrlToSelection],
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

  // Tool memory lives on the account doc (synced across the user's devices),
  // not the layout doc, so we mutate the account handle directly.
  const rememberTool = useCallback(
    (url: AutomergeUrl, type: string | undefined, toolId: string) => {
      accountHandle.change((d) => rememberToolInDoc(d, url, type, toolId));
    },
    [accountHandle],
  );

  const split = useCallback(
    (leafId: string, direction: SplitDirection) => {
      // The new panel mirrors the source panel's current view so you can
      // diverge each side independently afterwards.
      const current = docRef.current?.layout ?? null;
      const source = current ? findLeaf(current, leafId) : null;
      const newView: PanelView = source
        ? source.view.role === "root-folder"
          ? { role: "root-folder" }
          : { url: source.view.url, toolId: source.view.toolId }
        : { role: "root-folder" };
      const newLeaf = makeLeaf(newView);
      change((d) => splitLeafIn(d, leafId, direction, newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, focusLeaf],
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
      // Structural change only. Per-tab focus (active pane / focus order) is
      // reconciled reactively by the prune effect once `layout` updates.
      change((d) => {
        removeLeafIn(d, leafId);
        // Never leave the folder/context panes alone and full-width: keep an
        // (empty) content frame around for documents to open into.
        ensureContentFrameIn(d, rootFolderUrl);
      });
    },
    [change, rootFolderUrl],
  );

  // Which panel is mid-drag (frame-level so every panel can show drop zones).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const beginDrag = useCallback((leafId: string) => setDraggingId(leafId), []);
  const endDrag = useCallback(() => setDraggingId(null), []);

  const moveLeaf = useCallback(
    (sourceLeafId: string, targetLeafId: string, side: DropSide) => {
      setDraggingId(null);
      if (sourceLeafId === targetLeafId) return;
      change((d) => moveLeafIn(d, sourceLeafId, targetLeafId, side));
      focusLeaf(sourceLeafId);
    },
    [change, focusLeaf],
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

  // Route a document-open request. `sourceId` is the panel the request came
  // from (null for app chrome and for URL/deep-link opens, which arrive on the
  // mount element).
  const openView = useCallback(
    (view: PanelView, sourceId: string | null) => {
      if (!view.url) return;
      const doc = docRef.current;
      const current = doc?.layout ?? null;
      if (!current) return;

      const leafIds = collectLeafIds(current);
      const liveIds = new Set(leafIds);

      // A normal document must never land in (rule 1) the root-folder navigator
      // or a context pane: those panels stay put so the folder tree and
      // comments/history keep describing the content beside them.
      const isContentId = (id: string | null | undefined): id is string =>
        !!id && liveIds.has(id) && isContentLeaf(findLeaf(current, id), rootFolderUrl);

      // 1. Already open? Just focus it. Opening a doc that's already on screen
      //    (a folder click on it, or the host re-dispatching the URL's `doc`
      //    param on load/hashchange) should never duplicate it or, worse,
      //    clobber the panel you're currently in.
      const existing = findLeafIdByUrl(current, view.url);
      if (existing) {
        focusLeaf(existing);
        return;
      }

      // 1b. Opening the viewer's own root folder targets the (symbolic) folder
      //     navigator rather than dropping the folder into a content pane.
      if (rootFolderUrl && view.url === rootFolderUrl) {
        const folderId = findRootFolderLeafId(current, rootFolderUrl);
        if (folderId) focusLeaf(folderId);
        return;
      }

      // 2. Fill an empty content frame if one is waiting (the seeded slot beside
      //    the folder). Preferring it means a doc never splits the folder or
      //    clobbers an open document while a ready slot sits empty.
      const isEmptyId = (id: string): boolean =>
        isContentLeaf(findLeaf(current, id), rootFolderUrl) &&
        !findLeaf(current, id)?.view.url;
      const order = focusRef.current.focusOrder;
      let emptyId: string | null = null;
      for (let i = order.length - 1; i >= 0 && !emptyId; i--) {
        if (liveIds.has(order[i]) && isEmptyId(order[i])) emptyId = order[i];
      }
      if (!emptyId) emptyId = leafIds.find((id) => isEmptyId(id)) ?? null;
      if (emptyId) {
        navigate(emptyId, view);
        focusLeaf(emptyId);
        return;
      }

      // 3. A request *from* a panel (e.g. the folder tree) navigates the
      //    last-focused *other content* panel, so the source pane isn't
      //    replaced and the doc never lands in the folder/context panes.
      //    Sourceless opens (URL deep-links, top bar) deliberately skip this:
      //    they must not navigate — i.e. clobber — whatever panel is active.
      if (sourceId !== null) {
        const order = focusRef.current.focusOrder;
        for (let i = order.length - 1; i >= 0; i--) {
          const id = order[i];
          if (id !== sourceId && isContentId(id)) {
            navigate(id, view);
            focusLeaf(id);
            return;
          }
        }
      }

      // 4. Otherwise open a new panel by splitting a *content* panel, so we
      //    never carve up the root-folder navigator (rule 2) or a context pane.
      //    Only when no content panel exists at all do we fall back to splitting
      //    the source/active panel so the document can still open.
      const active = focusRef.current.activeLeafId;
      const firstContentId = leafIds.find((id) => isContentId(id)) ?? null;
      const splitSource =
        (isContentId(sourceId) && sourceId) ||
        (isContentId(active) && active) ||
        firstContentId ||
        (sourceId && liveIds.has(sourceId) && sourceId) ||
        (active && liveIds.has(active) && active) ||
        leafIds[0];
      if (!splitSource) return;
      const newLeaf = makeLeaf(view);
      change((d) => splitLeafIn(d, splitSource, "horizontal", newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, navigate, focusLeaf, rootFolderUrl],
  );

  const handleOpenDocument = useCallback(
    (event: OpenDocumentEvent) => {
      const url = event.detail.url;
      if (!url) return;
      const target = event.target as Element | null;
      const sourceId =
        target?.closest?.("[data-leaf-id]")?.getAttribute("data-leaf-id") ??
        null;

      // Distinguish a navigation *intent* from a panel's *self-announcement*.
      // Tools routinely re-emit `patchwork:open-document` for the doc they're
      // already showing — on mount, and again whenever its title/content
      // changes — to keep the URL and tab title in sync. The single-doc frame
      // tolerates this because its selection provider dedups by url+tool; here
      // it's actively harmful: `openView` would route the announcement to some
      // *other* pane (the "random pane" targeting), and once the host's hash
      // router writes it to the URL and re-dispatches on `hashchange`, panels
      // start hijacking each other in a feedback loop (the "resonance").
      //
      // So: swallow self-announcements outright. Stopping immediate propagation
      // in the *capture* phase keeps them from reaching the host's URL writer
      // (its listener is registered earlier on this same element, so only
      // capturing beats it). A genuine navigation — a different doc, or app
      // chrome with no source pane — falls through to `openView` and is allowed
      // to bubble on to the host, so the URL updates exactly once per actual
      // navigation.
      if (sourceId) {
        const layout = docRef.current?.layout;
        const leaf = layout ? findLeaf(layout, sourceId) : null;
        // The symbolic folder pane resolves to the viewer's root folder, so
        // compare against that when deciding if this is a self-announcement.
        const leafUrl =
          leaf?.view.role === "root-folder" ? rootFolderUrl : leaf?.view.url;
        if (leaf && leafUrl === url) {
          event.stopImmediatePropagation();
          return;
        }
      }

      openView({ url, toolId: event.detail.toolId }, sourceId);
    },
    [openView, rootFolderUrl],
  );

  // Keep the latest handler in a ref so the once-attached listener always
  // invokes the current closure without re-binding.
  const handleOpenDocumentRef = useRef(handleOpenDocument);
  handleOpenDocumentRef.current = handleOpenDocument;

  // Listen on the *mount element* (the host's frame `rootElement`). In legacy
  // `patchwork-view` mode the tool is hosted on that element itself, so this is
  // where the bootloader's hash router (a) dispatches inbound deep-link opens —
  // a *non-bubbling* event a descendant listener would never see — and (b)
  // listens (in the bubble phase) for outbound opens to update the URL.
  //
  // We attach in the *capture* phase so that for outbound events we run before
  // the host's bubble-phase listener and can suppress self-announcements before
  // they churn the URL. Inbound deep-link opens are dispatched directly on this
  // element, so they still reach us here. Using the stable mount element (not a
  // gated `.tile-frame` ref) also means the listener attaches immediately,
  // before the provider gate opens.
  useEffect(() => {
    const el = element;
    const listener: EventListener = (event) =>
      handleOpenDocumentRef.current(event as unknown as OpenDocumentEvent);
    el.addEventListener("patchwork:open-document", listener, true);
    return () =>
      el.removeEventListener("patchwork:open-document", listener, true);
  }, [element]);

  // Top-bar "open" actions originate outside any panel, so they target the
  // active panel (or open a new one if the frame is somehow empty).
  // App-chrome opens (home, create-new, settings, account) act on the panel
  // you're in: focus an existing panel already showing the doc, else navigate
  // the active panel to it (its current view goes onto that panel's
  // back-history). This is deliberately different from passive URL/deep-link
  // opens, which must never clobber the active panel (see `openView`).
  const openFromChrome = useCallback(
    (view: PanelView) => {
      if (!view.url) return;
      const current = docRef.current?.layout ?? null;
      if (!current) return;
      const existing = findLeafIdByUrl(current, view.url);
      if (existing) {
        focusLeaf(existing);
        return;
      }
      const ids = collectLeafIds(current);
      const liveIds = new Set(ids);
      const isContentId = (id: string | null | undefined): id is string =>
        !!id && liveIds.has(id) && isContentLeaf(findLeaf(current, id), rootFolderUrl);

      // Act on the *content* panel you're in (the active one if it qualifies),
      // never the root-folder navigator or a context pane (rule 1).
      const active = focusRef.current.activeLeafId;
      const target =
        (isContentId(active) && active) || ids.find((id) => isContentId(id)) || null;
      if (target) {
        navigate(target, view);
        focusLeaf(target);
        return;
      }

      // No content panel yet: open beside the folder rather than replacing it
      // (we still must split the lone folder pane to make room for the doc).
      const splitSource = (active && liveIds.has(active) && active) || ids[0];
      if (!splitSource) return;
      const newLeaf = makeLeaf(view);
      change((d) => splitLeafIn(d, splitSource, "horizontal", newLeaf));
      focusLeaf(newLeaf.id);
    },
    [navigate, focusLeaf, change, rootFolderUrl],
  );

  // Home: focus the (symbolic) root-folder navigator if open, else add one to
  // the left of the first panel.
  const goHome = useCallback(() => {
    const current = docRef.current?.layout ?? null;
    if (!current) return;
    const folderId = findRootFolderLeafId(current, rootFolderUrl);
    if (folderId) {
      focusLeaf(folderId);
      return;
    }
    const target = collectLeafIds(current)[0];
    if (!target) return;
    const newLeaf = makeRootFolderLeaf();
    change((d) => splitLeafIn(d, target, "horizontal", newLeaf, false));
    focusLeaf(newLeaf.id);
  }, [rootFolderUrl, focusLeaf, change]);

  const ops: LayoutOps = {
    activeLeafId,
    focusLeaf,
    navigate,
    goBack,
    split,
    close,
    moveLeaf,
    draggingId,
    beginDrag,
    endDrag,
    setSizes,
    setTool,
    openContext,
    contextTools,
    rootFolderUrl,
    selectedLeafId,
    selectedDocUrl,
    toolPreferences: accountDoc.toolPreferences,
    rememberTool,
  };

  return (
    <FrameProviders
      accountDocUrl={accountDocUrl}
      selectedDocUrl={selectedDocUrl}
      selectedToolId={selectedToolId}
    >
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
        <div className="tile-frame">
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
    </FrameProviders>
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
