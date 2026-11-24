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
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type {
  ToolDescription,
  ToolElement,
} from "@inkandswitch/patchwork-plugins";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { ensureAccountSubdocs } from "./ensureSubdocs";
import type { FolderDoc } from "@inkandswitch/patchwork-filesystem";
import {
  addRootFolderColumnIn,
  cloneLayout,
  repairLayout,
  repairLayoutIn,
  collectLeafIds,
  ensureContentFrameIn,
  activateTabIn,
  clampDrawerWidth,
  closeTabIn,
  findLeaf,
  findRootFolderLeafId,
  findTabByUrl,
  isContentLeaf,
  leafTabs,
  makeInitialLayout,
  makeLeaf,
  moveLeafIn,
  moveTabIn,
  removeLeafIn,
  setDrawerWidthIn,
  showDrawerToolIn,
  toggleDrawerIn,
  setLeafToolIn,
  setSizesIn,
  splitLeafIn,
  stackIntoIn,
  keepShowingIn,
  openInLeafIn,
  type OpenMode,
} from "./layout";
import { TopBar } from "./TopBar";
import {
  BASE_PROVIDER_IDS,
  FrameProviders,
  SelectionProvider,
  type OpenView,
} from "./FrameProviders";
import {
  DRAFT_OVERLAY_PROVIDER,
  DRAFT_STATE_PROVIDER,
  useDraftsAvailable,
} from "./drafts";
import { CommentsOpener, DocScope, type ScopedProvider } from "./docScope";
import { DocIcon } from "./DocIcon";
import { setPatchworkDragData } from "./dnd";
import "./styles.css";
import type {
  Drawer,
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
  useDatatypeIcon,
  useDocTitle,
  useDocType,
  useTitleSetter,
  useEffectiveTool,
  useTaggedComponents,
  type SlotTool,
} from "./useDocTitle";
import { rememberToolInDoc } from "./toolMemory";
import { installUnloadGuard } from "./unloadGuard";
import { QuickOpen } from "./QuickOpen";
import { isQuickOpenKey, openTabUrls, type QuickPlacement } from "./quickOpenItems";
import { isGetAroundKey, tabActionFor, tabCommandFor } from "./tabKeys";
import { isShortcutsKey, keyFor, tabNumberKey, withKey } from "./shortcuts";
import { ShortcutsSheet } from "./ShortcutsSheet";

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

// A new browser tab starts with empty sessionStorage, but it clones the
// layout of the tab you were last looking at (leaf ids and all), so it should
// start with that tab's focus too: otherwise "the focused panel", where a link
// opened in the new tab lands, is just the first panel in tree order. The
// visible tab keeps one slot in localStorage naming its layout and focus; a
// new tab takes it only if it names the layout being cloned. A tab with no
// focus yet writes nothing: that's a new tab, which claims to be the visible
// one before it has read the slot.
const CARRIED_FOCUS_KEY = "tiling-focus:last";

const writeCarriedFocus = (layoutUrl: string | undefined, focus: TabFocus): void => {
  if (!layoutUrl || !focus.focusOrder.length || document.visibilityState !== "visible")
    return;
  try {
    localStorage.setItem(CARRIED_FOCUS_KEY, JSON.stringify({ layoutUrl, ...focus }));
  } catch {
    // Storage disabled: a new tab just starts without focus.
  }
};

const readCarriedFocus = (layoutUrl: string): TabFocus | null => {
  try {
    const raw = localStorage.getItem(CARRIED_FOCUS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TabFocus> & { layoutUrl?: unknown };
    if (parsed.layoutUrl !== layoutUrl || !Array.isArray(parsed.focusOrder)) return null;
    return {
      activeLeafId: typeof parsed.activeLeafId === "string" ? parsed.activeLeafId : null,
      focusOrder: parsed.focusOrder.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return null;
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

// A link to a doc in this app (`#doc=…`, as the folder and markdown tools write
// them) as a panel view, normalized the way the host's router does it
// (`docParamToUrl`) so it compares equal to what the host dispatches; null for
// any other link.
const docLinkView = (href: string): PanelView | null => {
  try {
    const link = new URL(href, window.location.href);
    if (
      link.origin !== window.location.origin ||
      link.pathname !== window.location.pathname
    )
      return null;
    const params = new URLSearchParams(link.hash.slice(1));
    const raw = params.get(DOC_PARAM);
    if (!raw) return null;
    const url = raw.startsWith("automerge:") ? raw : `automerge:${raw}`;
    if (!isValidAutomergeUrl(url)) return null;
    const toolId = params.get("tool");
    return toolId ? { url, toolId } : { url };
  } catch {
    return null;
  }
};

// The URL's own `doc`/`tool`.
const readDeepLink = (): PanelView | null =>
  docLinkView(window.location.href);

// **Navigation history.** Each open you make (a folder click, a link, Shift
// or Alt, the top bar) is one browser history entry, and nothing else is:
// focusing a panel, switching tabs, and opens that come *from* the URL (Back
// and Forward among them) rewrite the current entry in place. An entry's
// state records the panel its document was in, so Back reopens a document
// you've since replaced or closed where it was (see `FROM_URL`), and only
// shows one that's still open.
type EntryState = { tilingLeaf?: string };

/** The panel the current history entry's document was in, if it says. */
const entryLeaf = (): string | undefined => {
  const state = window.history.state as EntryState | null;
  return typeof state?.tilingLeaf === "string" ? state.tilingLeaf : undefined;
};

const syncDocParam = (
  url: AutomergeUrl | undefined,
  toolId: string | null,
  leafId: string | null,
  push = false,
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
    const unchanged = params.toString() === before;
    if (unchanged && entryLeaf() === (leafId ?? undefined)) return;
    const href = `${window.location.pathname}${window.location.search}#${params.toString()}`;
    const prior: unknown = window.history.state;
    const state: Record<string, unknown> =
      prior && typeof prior === "object" ? { ...prior } : {};
    if (leafId) state.tilingLeaf = leafId;
    else delete state.tilingLeaf;
    // pushState/replaceState (not `location.hash =`): neither fires a
    // `hashchange` that would loop back through the host's router. An open
    // that leaves the URL as it was (showing what's already shown) is no
    // navigation, so it rewrites the entry rather than adding one.
    if (push && !unchanged) window.history.pushState(state, "", href);
    else window.history.replaceState(state, "", href);
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
    const source = account?.currentLayoutUrl;
    const handle = repo.create<TilingLayoutDoc>();
    handle.change((doc) => {
      doc.layout = null;
      doc["@patchwork"] = { type: LAYOUT_TYPE };
    });
    // Claim the URL synchronously so a re-mount (e.g. StrictMode) reuses this
    // doc instead of minting a second one.
    writeLayoutParam(handle.url);
    if (isValidAutomergeUrl(source) && source !== handle.url) setCloneSourceUrl(source);
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

/**
 * How an open lands when it would otherwise replace a panel's document:
 * stacked into that panel, or split off beside (a direction) it.
 */
type OpenPlacement = "stack" | SplitDirection;

type LayoutOps = {
  activeLeafId: string | null;
  focusLeaf: (id: string) => void;
  /** A pointer or key went into a panel's document: keep its tab. */
  engage: (leafId: string) => void;
  close: (leafId: string) => void;
  /** Show tab `index` of a panel's stack. */
  activateTab: (leafId: string, index: number) => void;
  /** Remove tab `index` from a panel's stack. */
  closeTab: (leafId: string, index: number) => void;
  /** The panel being dragged, or whose tab is (drives drop zones), or null. */
  draggingId: string | null;
  /** The tab being dragged out of `draggingId`, or null for the whole panel. */
  draggingTab: number | null;
  /** Whether what's being dragged is documents (so it can be stacked). */
  dragCanStack: boolean;
  /** Begin a drag of a whole panel, or (with `tab`) of one of its tabs. */
  beginDrag: (leafId: string, tab?: number) => void;
  endDrag: () => void;
  /** Drop the current drag on `targetLeafId`: split at an edge, or stack. */
  drop: (targetLeafId: string, side: DropSide) => void;
  /** Drop the current drag into `targetLeafId`'s tab strip, at position `at`. */
  dropIntoStrip: (targetLeafId: string, at: number) => void;
  setSizes: (splitId: string, sizes: [number, number]) => void;
  setTool: (leafId: string, toolId: string | undefined) => void;
  /** Open or close a panel's drawer of context tools. */
  toggleDrawer: (leafId: string) => void;
  /** Show a context tool in a panel's drawer. */
  showDrawerTool: (leafId: string, toolId: string) => void;
  /** Persist a drawer's width after a resize. */
  setDrawerWidth: (leafId: string, width: number) => void;
  /** `document-provider` components, wrapped around every document. */
  documentProviders: string[];
  /** The context tools a document panel's drawer lists. */
  contextTools: SlotTool[];
  /** The viewer's own root-folder url, used to resolve `"root-folder"` panels. */
  rootFolderUrl: AutomergeUrl | undefined;
  /** Id of the content panel that is the current "selected document". */
  selectedLeafId: string | null;
  /** URL of the current selected document (what overlays describe). */
  selectedDocUrl: AutomergeUrl | undefined;
  /**
   * The long-lived element a panel's content renders into (see
   * `PanelContent`). Created on first request and kept for the panel's life.
   */
  getContainer: (leafId: string) => HTMLDivElement;
  /** Hold a container off-screen while its panel's slot is being rebuilt. */
  parkContainer: (container: HTMLDivElement) => void;
  /** Whether the draft providers are installed (wrap content panels in them). */
  draftsAvailable: boolean;
  /** Report a content panel's ready draft scope (or its removal). */
  setDraftScope: (leafId: string, scope: HTMLElement | null) => void;
  /** The user's remembered tool choices (account-synced), for defaulting. */
  toolPreferences: ToolPreferences | undefined;
  /** Persist an explicit tool choice for this doc and its datatype. */
  rememberTool: (
    url: AutomergeUrl,
    type: string | undefined,
    toolId: string,
  ) => void;
};

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

/** A panel with its right-hand strip: the drawer. */
const DrawerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M10 3v10" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

/** A tool that renders any document (`supportedDatatypes: "*"`): Raw, say. */
/**
 * How soon (ms) after a click or key in a preview an open from the same panel
 * counts as that gesture following a link, rather than engaging with it.
 */
const ENGAGE_FOLLOW_MS = 1500;

/**
 * The source of an open that came from the URL (the address bar, back and
 * forward, a plain `#doc=…` link, a deep link): it's treated as a link
 * followed from the focused document panel. Not a panel id.
 */
const FROM_URL = "#url";

/**
 * The source of an open from Quick Open (⌘P). Not a panel id, so it lands as
 * an open from the folder does: an empty content frame if one is waiting,
 * else the last-focused content panel.
 */
const FROM_QUICK_OPEN = "#quick-open";

/** The focused element, looking through shadow roots. */
const deepActiveElement = (): Element | null => {
  let el: Element | null = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el;
};

/** The panel (`data-leaf-id`) a node is in, looking out through shadow roots. */
const leafIdOf = (node: Node): string | null => {
  let at: Node | null = node;
  while (at) {
    const leaf = at instanceof Element ? at.closest("[data-leaf-id]") : null;
    if (leaf) return leaf.getAttribute("data-leaf-id");
    const root: Node = at.getRootNode();
    at = root instanceof ShadowRoot ? root.host : null;
  }
  return null;
};

const isGenericTool = (tool: ToolDescription): boolean => {
  const supported = (tool as { supportedDatatypes?: unknown }).supportedDatatypes;
  return supported === "*" || (Array.isArray(supported) && supported.includes("*"));
};

/**
 * The menu of ways to view a panel's document, opened from its datatype icon
 * (or from the tool label, when one shows). The datatype's own tools come
 * first; tools that render any document follow under their own rule.
 *
 * Choosing one of the datatype's tools is remembered for the document and the
 * datatype, so it's what they open in next time. A generic tool is a peek:
 * it applies to this panel only, so a look at the raw data doesn't make every
 * document of the type open raw.
 */
const ToolMenu = ({
  leaf,
  ops,
  tools,
  fallbackId,
  type,
  selected,
  url,
  headerRef,
  left,
  onClose,
}: {
  leaf: LeafNode;
  ops: LayoutOps;
  tools: ToolDescription[];
  fallbackId: string | undefined;
  type: string | undefined;
  selected: string | undefined;
  /**
   * The document this panel actually renders. For a symbolic `"root-folder"`
   * panel this is the viewer's resolved `rootFolderUrl` (not `leaf.view.url`,
   * which is absent), so a choice made here is still remembered for the folder.
   */
  url: AutomergeUrl | undefined;
  headerRef: RefObject<HTMLDivElement>;
  /** Offset from the header's left edge, to sit under its opener. */
  left: number;
  onClose: () => void;
}) => {
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      // The icon and label toggle the menu themselves.
      const toggle = target?.closest?.("[data-tool-menu-toggle]");
      if (toggle && headerRef.current?.contains(toggle)) return;
      if (!target?.closest?.(".tile-tool-menu")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [headerRef, onClose]);

  const choose = (tool: ToolDescription) => {
    ops.setTool(leaf.id, tool.id);
    if (url && !isGenericTool(tool)) ops.rememberTool(url, type, tool.id);
    onClose();
  };

  const item = (tool: ToolDescription) => (
    <button
      key={tool.id}
      className="tile-tool-menu__item"
      role="menuitemradio"
      aria-checked={tool.id === selected}
      onClick={() => choose(tool)}
    >
      <span className="tile-tool-menu__name">{tool.name ?? tool.id}</span>
      {tool.id === fallbackId && (
        <span className="tile-tool-menu__note">default</span>
      )}
    </button>
  );

  const specific = tools.filter((tool) => !isGenericTool(tool));
  const generic = tools.filter(isGenericTool);
  return (
    <div
      className="tile-tool-menu"
      role="menu"
      style={{ left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {specific.map(item)}
      {generic.length > 0 && (
        <>
          {specific.length > 0 && <div className="tile-tool-menu__rule" />}
          <div className="tile-tool-menu__heading">Any document</div>
          {generic.map(item)}
        </>
      )}
    </div>
  );
};

/**
 * Where over `el` the cursor is: the middle (stacking, when `canStack`), or
 * else the nearest edge (the 4 triangular drop zones). The middle is the
 * central 40% each way, so the edges stay easy targets.
 */
const computeDropSide = (
  event: { clientX: number; clientY: number },
  el: HTMLElement,
  canStack: boolean,
): DropSide => {
  const r = el.getBoundingClientRect();
  const x = r.width ? (event.clientX - r.left) / r.width : 0.5;
  const y = r.height ? (event.clientY - r.top) / r.height : 0.5;
  if (canStack && Math.abs(x - 0.5) < 0.2 && Math.abs(y - 0.5) < 0.2)
    return "center";
  const dist = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  let side: DropSide = "right";
  let min = Infinity;
  (Object.keys(dist) as (keyof typeof dist)[]).forEach((k) => {
    if (dist[k] < min) {
      min = dist[k];
      side = k;
    }
  });
  return side;
};

/**
 * Drop surface laid over a panel's body while a drag is active (every panel
 * but a dragged one; a panel whose *tab* is dragged is a target too). It sits
 * above the embedded view so drag events land here rather than inside an
 * iframe/tool, previews the target edge (or the middle, to stack), and
 * commits the move on drop.
 */
const DropZones = ({
  leaf,
  ops,
  canStack,
}: {
  leaf: LeafNode;
  ops: LayoutOps;
  canStack: boolean;
}) => {
  const [side, setSide] = useState<DropSide | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="tile-dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (ref.current) setSide(computeDropSide(event, ref.current, canStack));
      }}
      onDragLeave={(event) => {
        // Ignore leaves into child nodes of the overlay.
        if (event.currentTarget.contains(event.relatedTarget as Node | null))
          return;
        setSide(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const dropSide = ref.current
          ? computeDropSide(event, ref.current, canStack)
          : (side ?? "right");
        setSide(null);
        ops.drop(leaf.id, dropSide);
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

/**
 * A document's name, renamable in place: double-click it (a lone document's
 * title, or any tab) to edit; Enter or leaving the field saves, Escape
 * cancels. The field keeps the name's own type, marked only by an accent
 * underline. Offered only when the document's datatype can set a title.
 */
const EditableTitle = ({
  url,
  title,
  className,
  onEditing,
}: {
  url: AutomergeUrl | undefined;
  title: string;
  className: string;
  /** Told when editing starts and stops (a tab stops dragging meanwhile). */
  onEditing?: (editing: boolean) => void;
}) => {
  const setTitle = useTitleSetter(url);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null && !!setTitle;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    onEditing?.(editing);
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, onEditing]);

  if (editing) {
    const commit = () => {
      const next = (draft ?? "").trim();
      setDraft(null);
      if (next && next !== title) setTitle(next);
    };
    return (
      <input
        ref={inputRef}
        className={`${className} tile-title-input`}
        aria-label="Rename document"
        value={draft ?? ""}
        draggable={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
          }
        }}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      />
    );
  }
  return (
    <span
      className={className}
      title={title}
      onDoubleClick={
        setTitle
          ? (event) => {
              event.stopPropagation();
              setDraft(title);
            }
          : undefined
      }
    >
      {title}
    </span>
  );
};

/**
 * One document in a panel's stack. Click to show it, middle-click or × to
 * remove it, drag it onto another panel's middle (to stack it there) or edge
 * (to split it off), or out of the frame as a document link.
 */
const StackTab = ({
  leafId,
  url,
  index,
  count,
  active,
  preview,
  ops,
  icon,
  onEditing,
  children,
}: {
  leafId: string;
  url: AutomergeUrl;
  index: number;
  /** How many tabs the strip holds (for the tab's number key). */
  count: number;
  active: boolean;
  /** Not yet engaged with (see `PanelView.preview`): its name is set in italic. */
  preview?: boolean;
  ops: LayoutOps;
  /**
   * The showing tab's icon: the panel's own datatype icon button (drag the
   * document, click for "View as…"). Other tabs draw their datatype's icon.
   */
  icon?: ReactNode;
  /** Told when this tab's name starts and stops being edited. */
  onEditing?: (editing: boolean) => void;
  /** Shown after the title: the showing tab's tool label, if any. */
  children?: ReactNode;
}) => {
  const title = useDocTitle(url);
  const datatypeIcon = useDatatypeIcon(useDocType(url));
  const [editing, setEditingState] = useState(false);
  const setEditing = useCallback(
    (value: boolean) => {
      setEditingState(value);
      onEditing?.(value);
    },
    [onEditing],
  );
  return (
    <div
      className={`tile-panel__tab${active ? " tile-panel__tab--active" : ""}${
        preview ? " tile-panel__tab--preview" : ""
      }`}
      data-tab-index={index}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={(() => {
        const key = tabNumberKey(index, count);
        return key ? `${title} (${key})` : title;
      })()}
      draggable={!editing}
      onClick={() => ops.activateTab(leafId, index)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          ops.activateTab(leafId, index);
        }
      }}
      // Middle-click closes; stop its mousedown starting an autoscroll.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        ops.closeTab(leafId, index);
      }}
      onDragStart={(event) => {
        // One tab, not the panel: keep the header's own drag out of it.
        event.stopPropagation();
        setPatchworkDragData(
          event.dataTransfer,
          { url, name: title },
          "patchwork-frame-tiling",
        );
        ops.beginDrag(leafId, index);
      }}
      onDragEnd={() => ops.endDrag()}
    >
      {icon ?? (
        <span className="tile-panel__tab-icon">
          <DocIcon name={datatypeIcon} />
        </span>
      )}
      <EditableTitle
        className="tile-panel__tab-label"
        url={url}
        title={title}
        onEditing={setEditing}
      />
      {children}
      <button
        type="button"
        className="tile-panel__tab-close"
        title={active ? withKey("Close tab", "close-tab") : "Close tab"}
        aria-label={`Close ${title}`}
        draggable={false}
        onClick={(event) => {
          event.stopPropagation();
          ops.closeTab(leafId, index);
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
          <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
};

/** One entry of a panel's tab list: its datatype icon and name. */
const TabListItem = ({
  url,
  active,
  preview,
  onChoose,
}: {
  url: AutomergeUrl;
  active: boolean;
  preview: boolean;
  onChoose: () => void;
}) => {
  const title = useDocTitle(url);
  const icon = useDatatypeIcon(useDocType(url));
  return (
    <button
      type="button"
      className={`tile-tool-menu__item tile-tab-list__item${
        preview ? " tile-tab-list__item--preview" : ""
      }`}
      role="menuitemradio"
      aria-checked={active}
      onClick={onChoose}
    >
      <span className="tile-panel__tab-icon">
        <DocIcon name={icon} />
      </span>
      <span className="tile-tool-menu__name">{title}</span>
    </button>
  );
};

/**
 * Every tab of a panel, as a menu under the header's right end: for a stack
 * too long for its strip. Choosing one shows it.
 */
const TabListMenu = ({
  leafId,
  tabs,
  active,
  ops,
  headerRef,
  onClose,
}: {
  leafId: string;
  tabs: PanelView[];
  active: number;
  ops: LayoutOps;
  headerRef: RefObject<HTMLDivElement>;
  onClose: () => void;
}) => {
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const toggle = target?.closest?.("[data-tab-list-toggle]");
      if (toggle && headerRef.current?.contains(toggle)) return;
      if (!target?.closest?.(".tile-tab-list")) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [headerRef, onClose]);
  return (
    <div
      className="tile-tool-menu tile-tab-list"
      role="menu"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {tabs.map((tab, index) =>
        tab.url ? (
          <TabListItem
            key={tab.url}
            url={tab.url}
            active={index === active}
            preview={!!tab.preview}
            onChoose={() => {
              ops.activateTab(leafId, index);
              onClose();
            }}
          />
        ) : null,
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
  const isRootFolder = leaf.view.role === "root-folder";
  // A `"root-folder"` panel stores no url; resolve it to the *viewer's* own
  // root folder so a shared layout shows the recipient's folders, not the
  // author's.
  const resolvedUrl = isRootFolder ? ops.rootFolderUrl : leaf.view.url;
  const isEmpty = !isRootFolder && !resolvedUrl;
  const docTitle = useDocTitle(resolvedUrl);
  const isSelected = !isRootFolder && !isEmpty && ops.selectedLeafId === leaf.id;
  const title = isEmpty ? "Empty" : docTitle;
  const { focusLeaf } = ops;

  // Resolve the tool to render: explicit panel choice, else the remembered
  // preference for this doc / datatype, else the datatype default.
  const { toolId: effectiveToolId, tools, fallbackId, type } = useEffectiveTool(
    resolvedUrl,
    leaf.view.toolId,
    ops.toolPreferences,
  );

  // The body is only a slot: the content lives in a container owned by the
  // frame (see `PanelContent`), moved in here on mount and parked on unmount.
  // A rearrangement rebuilds this panel, but the content just moves across.
  const slotRef = useRef<HTMLDivElement>(null);
  const { getContainer, parkContainer } = ops;
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const container = getContainer(leaf.id);
    moveInto(slot, container);
    return () => {
      if (container.parentNode === slot) parkContainer(container);
    };
  }, [leaf.id, getContainer, parkContainer]);

  // The datatype's icon doubles as a drag handle for the *document* (as
  // opposed to the header, which drags the panel): drop it into a folder, a
  // canvas, another doc, or out of the app as a link.
  const datatypeIcon = useDatatypeIcon(type);
  const dragDocUrl = !isEmpty ? resolvedUrl : undefined;

  // How the document is being viewed. Only a non-default tool is named in the
  // header; the choice itself lives in a menu on the datatype icon.
  const headerRef = useRef<HTMLDivElement>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  // While any name in the header is being edited, the header doesn't drag.
  // Renaming a document is engaging with it, so it keeps the tab.
  const [editingTitle, setEditingTitle] = useState(false);
  const { engage } = ops;
  const onEditingTitle = useCallback(
    (editing: boolean) => {
      setEditingTitle(editing);
      if (editing) engage(leaf.id);
    },
    [engage, leaf.id],
  );
  const closeToolMenu = useCallback(() => setToolMenuOpen(false), []);
  // The menu hangs under whichever control opened it (in a stack, that's
  // partway along the header), measured from the header's left edge.
  const [toolMenuLeft, setToolMenuLeft] = useState(0);
  const toggleToolMenu = (event: { currentTarget: Element }) => {
    const header = headerRef.current?.getBoundingClientRect();
    const opener = event.currentTarget.getBoundingClientRect();
    setToolMenuLeft(header ? Math.max(0, opener.left - header.left) : 0);
    setToolMenuOpen((open) => !open);
  };
  const hasToolChoice = !!dragDocUrl && tools.length > 1;
  const offDefaultTool =
    dragDocUrl && fallbackId && effectiveToolId && effectiveToolId !== fallbackId
      ? tools.find((tool) => tool.id === effectiveToolId)
      : undefined;

  const panelRef = useRef<HTMLDivElement>(null);
  // Dragging the whole panel ghosts it; dragging one of its tabs leaves it a
  // target, so the tab can be split off beside it.
  const isDragging = ops.draggingId === leaf.id && ops.draggingTab === null;
  const isDropTarget = ops.draggingId !== null && !isDragging;
  // Only documents stack, and only into a document panel (or an empty one).
  const canStack =
    ops.dragCanStack &&
    ops.draggingId !== leaf.id &&
    !isRootFolder;

  const { tabs: stackTabs, active: activeTab } = leafTabs(leaf);
  const stacked = !isRootFolder && stackTabs.length > 1;

  // Many tabs: the strip scrolls sideways (a mouse wheel scrolls it too),
  // fades at an edge with more beyond it, keeps the showing tab in view, and
  // offers the whole list from a button at its end.
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripOverflow, setStripOverflow] = useState({ left: false, right: false });
  const measureStrip = useCallback(() => {
    const strip = stripRef.current;
    const next = strip
      ? {
          left: strip.scrollLeft > 1,
          right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
        }
      : { left: false, right: false };
    setStripOverflow((prev) =>
      prev.left === next.left && prev.right === next.right ? prev : next,
    );
  }, []);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      measureStrip();
      return;
    }
    const observer = new ResizeObserver(measureStrip);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [stacked, measureStrip]);
  const showingTabUrl = stackTabs[activeTab]?.url;
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector<HTMLElement>(`[data-tab-index="${activeTab}"]`);
    if (strip && tab) {
      const left = tab.offsetLeft - strip.offsetLeft;
      const right = left + tab.offsetWidth;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + strip.clientWidth)
        strip.scrollLeft = right - strip.clientWidth;
    }
    measureStrip();
  }, [activeTab, showingTabUrl, stackTabs.length, measureStrip]);
  const onStripWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const strip = stripRef.current;
    if (!strip || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    strip.scrollLeft += event.deltaY;
  };
  const [tabListOpen, setTabListOpen] = useState(false);
  const closeTabList = useCallback(() => setTabListOpen(false), []);

  // The header is a drop target too: documents dragged over it go into this
  // panel's stack at the position between tabs nearest the pointer (onto a
  // lone document's title, before or after it), marked by a thin rule. A
  // tab dragged within its own strip is reordered.
  const canDropInStrip =
    ops.draggingId !== null &&
    ops.dragCanStack &&
    !isRootFolder &&
    !(ops.draggingId === leaf.id && ops.draggingTab === null);
  const [stripDrop, setStripDrop] = useState<{ at: number; x: number } | null>(
    null,
  );
  useEffect(() => {
    if (ops.draggingId === null) setStripDrop(null);
  }, [ops.draggingId]);
  const stripPosition = (clientX: number): { at: number; x: number } | null => {
    const header = headerRef.current;
    if (!header) return null;
    // A stack's tabs each carry their icon; a lone document's icon, title and
    // tool label read as one name, so they make one slot.
    const rects = (selector: string) =>
      Array.from(header.querySelectorAll<HTMLElement>(selector)).map((el) =>
        el.getBoundingClientRect(),
      );
    const tabRects = rects(".tile-panel__tab");
    const nameRects = rects(
      ".tile-panel__doc-icon, .tile-panel__title, .tile-panel__tool-label",
    );
    const slots: { left: number; right: number; width: number }[] = stacked
      ? tabRects
      : nameRects.length
        ? [
            {
              left: Math.min(...nameRects.map((r) => r.left)),
              right: Math.max(...nameRects.map((r) => r.right)),
              width:
                Math.max(...nameRects.map((r) => r.right)) -
                Math.min(...nameRects.map((r) => r.left)),
            },
          ]
        : [];
    const left = header.getBoundingClientRect().left;
    if (slots.length === 0) return { at: 0, x: 4 };
    const at = slots.filter((r) => r.left + r.width / 2 < clientX).length;
    const x = at < slots.length ? slots[at].left - left - 1 : slots[at - 1].right - left + 1;
    // An empty frame has nothing to go beside: its "title" is a placeholder.
    return isEmpty ? { at: 0, x: slots[0].left - left - 1 } : { at, x };
  };

  const toolLabel = offDefaultTool && (
    <button
      type="button"
      className="tile-panel__tool-label"
      title="View as…"
      data-tool-menu-toggle
      onClick={toggleToolMenu}
    >
      {offDefaultTool.name ?? offDefaultTool.id}
    </button>
  );

  // The datatype icon, beside the title of the document it stands for: before
  // the title of a lone document, or inside the showing tab of a stack.
  const docIconButton = dragDocUrl ? (
    <button
      type="button"
      className="tile-panel__doc-icon"
      title={hasToolChoice ? "View as… (drag to move the document)" : "Drag document"}
      aria-haspopup={hasToolChoice ? "menu" : undefined}
      aria-expanded={hasToolChoice ? toolMenuOpen : undefined}
      data-tool-menu-toggle={hasToolChoice || undefined}
      onClick={(event) => hasToolChoice && toggleToolMenu(event)}
      draggable
      onDragStart={(event) => {
        // Not a panel move: keep the frame's own drag handling out of it.
        event.stopPropagation();
        setPatchworkDragData(
          event.dataTransfer,
          {
            url: dragDocUrl,
            name: title,
            type,
            toolId: effectiveToolId,
          },
          "patchwork-frame-tiling",
        );
      }}
    >
      <DocIcon name={datatypeIcon} />
    </button>
  ) : null;

  return (
    <div
      ref={panelRef}
      data-leaf-id={leaf.id}
      className={`tile-panel${isActive ? " tile-panel--active" : ""}${
        isSelected ? " tile-panel--selected" : ""
      }${
        isDragging ? " tile-panel--dragging" : ""
      }`}
      onMouseDownCapture={() => focusLeaf(leaf.id)}
    >
    <div
      className="tile-panel__header"
      ref={headerRef}
      // The header is the panel's handle: drag it (its title, or any bare part
      // of it) to move the whole panel. Tabs and the datatype icon start their
      // own drags instead, and nothing drags while a name is being edited.
      draggable={!editingTitle}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", leaf.id);
        if (panelRef.current) {
          event.dataTransfer.setDragImage(panelRef.current, 24, 16);
        }
        ops.beginDrag(leaf.id);
      }}
      onDragEnd={() => ops.endDrag()}
      onDragOver={(event) => {
        if (!canDropInStrip) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const position = stripPosition(event.clientX);
        setStripDrop((prev) =>
          prev && position && prev.at === position.at && prev.x === position.x
            ? prev
            : position,
        );
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setStripDrop(null);
      }}
      onDrop={(event) => {
        if (!canDropInStrip) return;
        event.preventDefault();
        const position = stripPosition(event.clientX);
        setStripDrop(null);
        if (position) ops.dropIntoStrip(leaf.id, position.at);
      }}
    >
      {stripDrop && (
        <div className="tile-panel__strip-marker" style={{ left: stripDrop.x }} />
      )}
      {!stacked && docIconButton}
      {stacked ? (
        <div
          ref={stripRef}
          className={`tile-panel__tabs${
            stripOverflow.left ? " tile-panel__tabs--more-left" : ""
          }${stripOverflow.right ? " tile-panel__tabs--more-right" : ""}`}
          role="tablist"
          onWheel={onStripWheel}
          onScroll={measureStrip}
        >
          {stackTabs.map((tab, index) =>
            tab.url ? (
              <StackTab
                key={tab.url}
                leafId={leaf.id}
                url={tab.url}
                index={index}
                count={stackTabs.length}
                active={index === activeTab}
                preview={!!tab.preview}
                ops={ops}
                icon={index === activeTab ? docIconButton : undefined}
                onEditing={onEditingTitle}
              >
                {index === activeTab && toolLabel}
              </StackTab>
            ) : null,
          )}
        </div>
      ) : (
        <>
          <EditableTitle
            className={`tile-panel__title${
              leaf.view.preview ? " tile-panel__title--preview" : ""
            }`}
            url={isEmpty ? undefined : resolvedUrl}
            title={title}
            onEditing={onEditingTitle}
          />
          {toolLabel}
        </>
      )}
      {stacked && (stripOverflow.left || stripOverflow.right) && (
        <button
          type="button"
          className="tile-panel__tab-list-btn"
          title={`All ${stackTabs.length} tabs (${keyFor("previous-tab")} ${keyFor("next-tab")})`}
          aria-haspopup="menu"
          aria-expanded={tabListOpen}
          data-tab-list-toggle
          onClick={() => setTabListOpen((open) => !open)}
        >
          {stackTabs.length}
          <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
      )}
      {tabListOpen && stacked && (
        <TabListMenu
          leafId={leaf.id}
          tabs={stackTabs}
          active={activeTab}
          ops={ops}
          headerRef={headerRef}
          onClose={closeTabList}
        />
      )}
      {toolMenuOpen && hasToolChoice && (
        <ToolMenu
          leaf={leaf}
          ops={ops}
          tools={tools}
          fallbackId={fallbackId}
          type={type}
          selected={effectiveToolId}
          url={resolvedUrl}
          headerRef={headerRef}
          left={toolMenuLeft}
          onClose={closeToolMenu}
        />
      )}
      <div className="tile-panel__actions">
        {!isRootFolder && !isEmpty && ops.contextTools.length > 0 && (
          // The drawer's way in. A button here rather than anything over the
          // document's right edge, which belongs to the document: its
          // scrollbar, its own toolbars.
          <button
            type="button"
            className="tile-panel__icon-btn tile-panel__icon-btn--drawer"
            title={leaf.drawer?.open ? "Close drawer" : "Open drawer"}
            aria-pressed={!!leaf.drawer?.open}
            onClick={() => ops.toggleDrawer(leaf.id)}
          >
            <DrawerIcon />
          </button>
        )}
        {canClose && (
          <button
            className="tile-panel__icon-btn tile-panel__icon-btn--close"
            title={
              // ⌥W closes a document panel along with its last tab.
              !isRootFolder && !stacked ? withKey("Close panel", "close-tab") : "Close panel"
            }
            onClick={() => ops.close(leaf.id)}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
    <div className="tile-panel__body" ref={slotRef}>
      {isDropTarget && <DropZones leaf={leaf} ops={ops} canStack={canStack} />}
    </div>
  </div>
);
};

/**
 * Move `node` under `parent`, keeping it alive. `moveBefore` relocates a
 * connected subtree without disconnecting it, so `<patchwork-view>` (which
 * implements `connectedMoveCallback`) keeps its tool mounted and iframes keep
 * their state. Where it's unsupported, or for a node that isn't connected yet,
 * fall back to `appendChild`: a remount, as before.
 */
const moveInto = (parent: Element, node: Element): void => {
if (node.parentNode === parent) return;
const moveBefore = (
  parent as Element & { moveBefore?: (node: Node, child: Node | null) => void }
).moveBefore;
if (moveBefore && node.isConnected && parent.isConnected) {
  try {
    moveBefore.call(parent, node, null);
    return;
  } catch {
    // Different roots, or similar: fall through to a plain move.
  }
}
parent.appendChild(node);
};

/** Background tabs' draft scopes report to no one (see `TabContent`). */
const noDraftScope = () => {};

/** The comments context tool (comments-view's `patchwork:component`). */
const COMMENTS_TOOL_ID = "comments-view";

/**
 * One document of a content panel's stack, inside its own providers (see
 * `DocScope`): draft state and overlay, document providers, comments, focus.
 * Every tab stays mounted, so a tool keeps its state (scroll, selection,
 * undo) while it's behind another; only the showing one is visible.
 *
 * The showing tab also holds the panel's drawer, beside the document and
 * inside its providers, so the drawer's tools describe — and act on — this
 * document: History and Drafts see its checked-out draft and checkpoint and
 * move them; Comments shares its focus doc, so a comment clicked in the
 * document can open the drawer on Comments (see `CommentsOpener`). Like
 * threepane's sidebar, the drawer's tools remount when the panel shows
 * another tab: their subscriptions belong to this document's providers.
 *
 * It alone reports its draft scope as the panel's (for overlays): when the
 * showing tab changes, React runs the old tab's effect cleanup (clearing the
 * panel's scope) before the new one's effect (setting it). Opens a hidden tab
 * announces are swallowed (see `handleOpenDocument`), so a tool behind
 * another can't pull focus.
 */
const TabContent = ({
  leaf,
  view,
  shown,
  ops,
}: {
  leaf: LeafNode;
  view: PanelView & { url: AutomergeUrl };
  shown: boolean;
  ops: LayoutOps;
}) => {
  const { toolId } = useEffectiveTool(view.url, view.toolId, ops.toolPreferences);
  // The draft-state provider binds its doc once at mount, which is fine: a
  // tab is keyed on its url, so a new document is a new tab.
  const documentProviders = ops.documentProviders.join("|");
  const providers = useMemo<ScopedProvider[]>(
    () => [
      ...(ops.draftsAvailable
        ? [{ id: DRAFT_STATE_PROVIDER, docUrl: view.url }, { id: DRAFT_OVERLAY_PROVIDER }]
        : []),
      ...(documentProviders ? documentProviders.split("|") : []).map((id) => ({ id })),
      { id: BASE_PROVIDER_IDS.comments },
      { id: BASE_PROVIDER_IDS.focus },
    ],
    [ops.draftsAvailable, documentProviders, view.url],
  );
  const drawer = leaf.drawer;
  const hasComments = ops.contextTools.some((tool) => tool.id === COMMENTS_TOOL_ID);
  const { showDrawerTool } = ops;
  const openComments = useCallback(
    () => showDrawerTool(leaf.id, COMMENTS_TOOL_ID),
    [showDrawerTool, leaf.id],
  );

  return (
    <div
      className="tile-panel__tab-content"
      hidden={!shown}
      data-tab-hidden={shown ? undefined : ""}
    >
      <DocScope
        leafId={leaf.id}
        providers={providers}
        onScope={shown ? ops.setDraftScope : noDraftScope}
      >
        <div className="tile-panel__tab-doc">
          <patchwork-view
            className="tile-panel__view"
            doc-url={view.url}
            tool-id={toolId}
          />
        </div>
        {shown && drawer?.open && ops.contextTools.length > 0 && (
          <PanelDrawer leaf={leaf} drawer={drawer} toolId={toolId} ops={ops} />
        )}
        <CommentsOpener
          id={`patchwork-frame-tiling:${leaf.id}`}
          enabled={shown && hasComments}
          onOpen={openComments}
        />
      </DocScope>
    </div>
  );
};

const byUrl = (a: PanelView, b: PanelView): number =>
  (a.url ?? "") < (b.url ?? "") ? -1 : (a.url ?? "") > (b.url ?? "") ? 1 : 0;

/**
 * The rail of context tools: one icon per tool, down the open drawer's outer
 * edge, naming the tool on hover (or focus) at once, the shown tool lit.
 * Picking a tool shows it; picking the lit one closes the drawer, as in VS
 * Code's activity bar. (The panel header's drawer button opens it.) The label
 * is drawn beside the icon list rather than in it, so its scrolling can't
 * clip it.
 */
const ToolRail = ({
  tools,
  shownId,
  onPick,
}: {
  tools: SlotTool[];
  /** The lit tool. */
  shownId: string | undefined;
  onPick: (toolId: string) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState<{ name: string; top: number } | null>(null);
  const showLabel = (name: string, button: HTMLElement) => {
    const railTop = ref.current?.getBoundingClientRect().top ?? 0;
    const r = button.getBoundingClientRect();
    setLabel({ name, top: r.top + r.height / 2 - railTop });
  };
  return (
    <div
      ref={ref}
      className="tile-rail"
    >
      <div
        className="tile-rail__icons"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Context tools"
      >
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tile-rail__btn"
            role="tab"
            aria-selected={tool.id === shownId}
            aria-label={tool.name}
            onClick={() => onPick(tool.id)}
            onMouseEnter={(event) => showLabel(tool.name, event.currentTarget)}
            onMouseLeave={() => setLabel(null)}
            onFocus={(event) => showLabel(tool.name, event.currentTarget)}
            onBlur={() => setLabel(null)}
          >
            <DocIcon name={tool.icon} fallback="PanelRight" size={15} />
          </button>
        ))}
      </div>
      {label && (
        <div className="tile-rail__label" style={{ top: label.top }}>
          {label.name}
        </div>
      )}
    </div>
  );
};

/**
 * A document panel's drawer: every registered context tool, as a rail of
 * icons down its outer edge (names on hover), one shown at a time under its
 * name, describing the document the panel shows (the showing tab, if
 * stacked). A rail rather than a strip of names, since there are already more
 * tools than names fit across a drawer.
 *
 * Each tool is a bare `patchwork:component` that asks for "the selected
 * document"; a selection provider scoped to this drawer answers with this
 * panel's, so every drawer describes its own panel whatever is focused. The
 * drawer renders inside the showing document's providers (see `TabContent`),
 * so everything else its tools ask for is that document's too. A tool
 * mounts the first time it's shown and stays mounted (hidden) while the
 * drawer is open, so switching back is instant. The left edge is a hairline
 * that drags to resize.
 */
const PanelDrawer = ({
  leaf,
  drawer,
  toolId,
  ops,
}: {
  leaf: LeafNode;
  drawer: Drawer;
  toolId: string | undefined;
  ops: LayoutOps;
}) => {
  const ref = useRef<HTMLElement>(null);
  // While resizing, the width lives here; it's written to the layout on release.
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? drawer.width;
  const tools = ops.contextTools;
  const shown = tools.find((tool) => tool.id === drawer.tool) ?? tools[0];
  const shownId = shown?.id;
  // Tools shown so far while the drawer has been open, in first-shown order.
  const [mounted, setMounted] = useState<string[]>([]);
  useEffect(() => {
    if (shownId && !mounted.includes(shownId)) setMounted((m) => [...m, shownId]);
  }, [shownId, mounted]);
  const live = tools.filter(
    (tool) => tool.id === shownId || mounted.includes(tool.id),
  );
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const right = ref.current?.getBoundingClientRect().right ?? event.clientX;
    let latest = drawer.width;
    const move = (e: PointerEvent) => {
      latest = clampDrawerWidth(right - e.clientX);
      setDragWidth(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragWidth(null);
      ops.setDrawerWidth(leaf.id, latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    <aside
      ref={ref}
      className="tile-drawer"
      style={{ width: `min(${width}px, 60%)` }}
      data-resizing={dragWidth !== null || undefined}
    >
      <div
        className="tile-drawer__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize drawer"
        onPointerDown={startResize}
      />
      <div className="tile-drawer__main">
        <div className="tile-drawer__header">{shown?.name}</div>
        <SelectionProvider
          selectedDocUrl={leaf.view.url}
          selectedToolId={toolId ?? null}
        >
          <div className="tile-drawer__body">
            {live.map((tool) => (
              <div
                key={tool.id}
                className="tile-drawer__tool"
                hidden={tool.id !== shownId}
              >
                <patchwork-view className="tile-panel__view" component={tool.id} />
              </div>
            ))}
          </div>
        </SelectionProvider>
      </div>
      <ToolRail
        tools={tools}
        shownId={shownId}
        onPick={(id) =>
          id === shownId ? ops.toggleDrawer(leaf.id) : ops.showDrawerTool(leaf.id, id)
        }
      />
    </aside>
  );
};

/**
 * A panel's content: its documents, and its drawer if it has one. Rendered
 * from a flat list keyed by leaf id, so it stays mounted however the layout
 * tree is rearranged; it portals into the panel's long-lived container, which
 * `TilePanel` moves into whichever slot currently shows that panel.
 */
const PanelContent = ({ leaf, ops }: { leaf: LeafNode; ops: LayoutOps }) => {
  const isRootFolder = leaf.view.role === "root-folder";
  const isEmpty = !isRootFolder && !leaf.view.url;
  const { toolId: folderToolId } = useEffectiveTool(
    isRootFolder ? ops.rootFolderUrl : undefined,
    leaf.view.toolId,
    ops.toolPreferences,
  );
  const { focusLeaf, engage } = ops;

  // A stack's documents, in a fixed order (by url) rather than tab order:
  // showing a different tab then never moves them in the DOM, which would
  // remount their tools.
  const { tabs, active } = leafTabs(leaf);
  const shownUrl = tabs[active]?.url;
  const docs = tabs
    .filter((tab): tab is PanelView & { url: AutomergeUrl } => !!tab.url)
    .sort(byUrl);

  // React events follow the component tree, not the DOM, so the panel's own
  // focus-on-mousedown never hears clicks in here: repeat it. (The open
  // drawer lives in the showing tab; see `TabContent`.)
  return createPortal(
    <div
      className="tile-panel__content-inner"
      onMouseDownCapture={() => focusLeaf(leaf.id)}
      // Engaging with a document keeps its tab (see `engage`). Only documents:
      // the root folder is a navigator, and an empty frame has nothing to keep.
      onPointerDownCapture={
        isRootFolder || isEmpty
          ? undefined
          : (event) => {
              // The mouse's Back/Forward buttons (3, 4) aren't engagement.
              if (event.button < 3) engage(leaf.id);
            }
      }
      onKeyDownCapture={
        isRootFolder || isEmpty
          ? undefined
          : (event) => {
              // Keys that only move you around aren't engagement.
              if (!isGetAroundKey(event.nativeEvent)) engage(leaf.id);
            }
      }
    >
      <div className="tile-panel__docs">
        {isEmpty ? (
          <div className="tile-panel__empty">
            <p>No document open</p>
            <span>Open one from the folder, or use + in the top bar.</span>
          </div>
        ) : isRootFolder ? (
          <patchwork-view
            key={leaf.id}
            className="tile-panel__view"
            doc-url={ops.rootFolderUrl}
            tool-id={folderToolId}
          />
        ) : (
          docs.map((view) => (
            <TabContent
              key={view.url}
              leaf={leaf}
              view={view}
              shown={view.url === shownUrl}
              ops={ops}
            />
          ))
        )}
      </div>
    </div>,
    ops.getContainer(leaf.id),
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

  // Context tools and the system tray are registry-driven: every
  // `patchwork:component` tagged `"context-tool"` / `"system-tray"` shows up
  // automatically, with no shared config doc to read or migrate.
  const contextTools = useTaggedComponents("context-tool");
  // Components tagged `document-provider` (patch layers, say) sit inside each
  // document's draft overlay, so they can remap what its views resolve.
  const documentProviderTools = useTaggedComponents("document-provider");
  const documentProviderKey = documentProviderTools.map((c) => c.id).join("|");
  const documentProviderIds = useMemo(
    () => (documentProviderKey ? documentProviderKey.split("|") : []),
    [documentProviderKey],
  );
  const trayItems = useTaggedComponents("system-tray");
  // Overlays float above the panels (the ambient agent, say): mounted once,
  // in a layer that lets pointer events through to the tiles beneath.
  const overlays = useTaggedComponents("overlay");
  // Which overlays say they're open (`patchwork:overlay-state`), so their
  // top-bar buttons show pressed. Toggling is the overlay's business: the
  // button sends `patchwork:toggle-overlay` to the overlay's view.
  const overlayLayerRef = useRef<HTMLDivElement | null>(null);
  const [openOverlays, setOpenOverlays] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleOverlay = useCallback((id: string) => {
    overlayLayerRef.current
      ?.querySelector(`.tile-overlay[data-overlay-id="${CSS.escape(id)}"] > patchwork-view`)
      ?.dispatchEvent(new CustomEvent("patchwork:toggle-overlay"));
  }, []);
  // Heard on our hosting view, which exists before the provider gate lets the
  // overlay layer render (see the open-document listener below).
  useEffect(() => {
    const start = element instanceof ShadowRoot ? element.host : element;
    const host = start.closest("patchwork-view") ?? start;
    const onState: EventListener = (event) => {
      const id = (event.target as Element | null)
        ?.closest?.("[data-overlay-id]")
        ?.getAttribute("data-overlay-id");
      if (!id) return;
      const open = !!(event as CustomEvent<{ open?: boolean }>).detail?.open;
      setOpenOverlays((prev) => {
        if (prev.has(id) === open) return prev;
        const next = new Set(prev);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      });
    };
    host.addEventListener("patchwork:overlay-state", onState);
    return () => host.removeEventListener("patchwork:overlay-state", onState);
  }, [element]);

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
      writeCarriedFocus(layoutUrl, focusRef.current);
      if (accountHandle.doc()?.currentLayoutUrl === layoutUrl) return;
      accountHandle.change((d) => {
        d.currentLayoutUrl = layoutUrl;
      });
    };
    markCurrent();
    document.addEventListener("visibilitychange", markCurrent);
    return () => document.removeEventListener("visibilitychange", markCurrent);
  }, [layoutUrl, accountHandle]);

  // Ask before ⌘W closes the browser tab (see `installUnloadGuard`).
  useEffect(() => installUnloadGuard(window), []);

  // The *structure* (panel tree, tools, sizes) is the synced doc's job; React
  // reflects it. Focus/selection is per-tab session state (see {@link TabFocus}).
  //
  // A url that names no document (see `repairLayout`) would throw from inside
  // the hooks that render its tab, so the frame only ever renders the layout
  // with those taken out, and puts the stored one right to match.
  const rawLayout = layoutDoc?.layout ?? null;
  const layout = useMemo(() => repairLayout(rawLayout), [rawLayout]);
  useEffect(() => {
    if (layout !== rawLayout) layoutHandle?.change(repairLayoutIn);
  }, [layout, rawLayout, layoutHandle]);

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
  const layoutUrlRef = useRef(layoutUrl);
  layoutUrlRef.current = layoutUrl;
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
    writeCarriedFocus(layoutUrlRef.current, next);
  }, []);

  // This tab's layout url may only resolve after the first render (a fresh
  // session is minted lazily), so re-hydrate focus from storage once the key
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

  // The "selected document" is the most-recently-focused *content* panel with
  // a document. Overlays (the agent) and the URL follow it.
  const selectedLeafId = useMemo(() => {
    if (!layout) return null;
    const order = focusOrder ?? [];
    for (let i = order.length - 1; i >= 0; i--) {
      const leaf = findLeaf(layout, order[i]);
      if (leaf && isContentLeaf(leaf) && leaf.view.url) return leaf.id;
    }
    for (const id of collectLeafIds(layout)) {
      const leaf = findLeaf(layout, id);
      if (leaf && isContentLeaf(leaf) && leaf.view.url) return leaf.id;
    }
    return null;
  }, [layout, focusOrder]);

  const selectedLeafView = useMemo(() => {
    if (!layout || !selectedLeafId) return undefined;
    return findLeaf(layout, selectedLeafId)?.view;
  }, [layout, selectedLeafId]);
  const selectedDocUrl = selectedLeafView?.url;
  const selectedToolId = selectedLeafView?.toolId ?? null;

  // Each content panel's draft-state provider, once mounted. A panel's drawer
  // relays to its own; the selected one is what overlays are relayed to.
  const draftsAvailable = useDraftsAvailable();
  const [draftScopes, setDraftScopes] = useState<
    ReadonlyMap<string, HTMLElement>
  >(() => new Map());
  const setDraftScope = useCallback(
    (leafId: string, scope: HTMLElement | null) => {
      setDraftScopes((prev) => {
        if (scope ? prev.get(leafId) === scope : !prev.has(leafId)) return prev;
        const next = new Map(prev);
        if (scope) next.set(leafId, scope);
        else next.delete(leafId);
        return next;
      });
    },
    [],
  );
  const selectedDraftScope =
    (selectedLeafId && draftScopes.get(selectedLeafId)) || null;

  // Every document on screen, for tools that care about more than the
  // selection (`patchwork:open-views`). Content panels only, in layout order.
  const openViews = useMemo<OpenView[]>(() => {
    if (!layout) return [];
    const views: OpenView[] = [];
    for (const id of collectLeafIds(layout)) {
      const leaf = findLeaf(layout, id);
      if (!leaf || !isContentLeaf(leaf) || !leaf.view.url) continue;
      views.push({
        url: leaf.view.url,
        toolId: leaf.view.toolId ?? null,
        selected: leaf.id === selectedLeafId,
      });
    }
    return views;
  }, [layout, selectedLeafId]);

  // Refs hold the latest doc/handle so the once-mounted open-document listener
  // and pointer handlers can read current state synchronously.
  const docRef = useRef<TilingLayoutDoc | undefined>(undefined);
  docRef.current = layoutDoc;
  const handleRef = useRef<DocHandle<TilingLayoutDoc> | undefined>(undefined);
  handleRef.current = layoutHandle;

  // The layout as of now: off the handle, which has a change the moment it's
  // made, where `layoutDoc` waits for the next render. Whatever runs within an
  // open (the host's replay of it, an engagement, the URL) must see the open.
  const layoutNow = useCallback((): LayoutNode | null => {
    try {
      const layout = handleRef.current?.doc()?.layout;
      if (layout) return layout;
    } catch {
      // Not ready: fall back to what's rendered.
    }
    return docRef.current?.layout ?? null;
  }, []);

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

  // Held while an open is being made, so its first write is the new entry
  // (see `navigate`) rather than a rewrite of the one it leaves.
  const holdUrlRef = useRef(false);
  const syncUrlToSelection = useCallback((push = false): LeafNode | null => {
    if (holdUrlRef.current && !push) return null;
    const current = layoutNow();
    if (!current) return null;
    const layout = repairLayout(current);
    const order = focusRef.current.focusOrder;
    let leaf: LeafNode | null = null;
    for (let i = order.length - 1; i >= 0 && !leaf; i--) {
      const l = findLeaf(layout, order[i]);
      if (l && l.view.url) leaf = l;
    }
    if (!leaf) {
      for (const id of collectLeafIds(layout)) {
        const l = findLeaf(layout, id);
        if (l && l.view.url) {
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
      if (want && want !== have) return null; // deep-link not opened yet — leave it
      syncEnabledRef.current = true;
    }
    syncDocParam(leaf?.view.url, leaf?.view.toolId ?? null, leaf?.id ?? null, push);
    return leaf;
  }, [layoutNow]);

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
        // Focus first: the deep link waiting on the layout (see
        // `pendingOpenRef`) lands in the focused panel.
        const carried = readCarriedFocus(cloneSourceUrl);
        if (carried) commitFocus(() => carried);
        layoutHandle.change((doc) => {
          doc.layout = cloneLayout(sourceLayout);
        });
        return;
      }
      // Source exists but is empty → fall through to the initial layout.
    }
    seededRef.current = true;
    layoutHandle.change((doc) => {
      doc.layout = makeInitialLayout();
    });
  }, [layoutDoc, layoutHandle, cloneSourceUrl, cloneSourceDoc, commitFocus]);

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

  // A document panel's drawer of context tools (see `PanelDrawer`).
  const toggleDrawer = useCallback(
    (leafId: string) => {
      change((d) => toggleDrawerIn(d, leafId));
      focusLeaf(leafId);
    },
    [change, focusLeaf],
  );
  const showDrawerTool = useCallback(
    (leafId: string, toolId: string) =>
      change((d) => showDrawerToolIn(d, leafId, toolId)),
    [change],
  );
  const setDrawerWidth = useCallback(
    (leafId: string, width: number) =>
      change((d) => setDrawerWidthIn(d, leafId, width)),
    [change],
  );

  const close = useCallback(
    (leafId: string) => {
      // Structural change only. Per-tab focus (active pane / focus order) is
      // reconciled reactively by the prune effect once `layout` updates.
      change((d) => {
        removeLeafIn(d, leafId);
        // Never leave the folder pane alone and full-width: keep an
        // (empty) content frame around for documents to open into.
        ensureContentFrameIn(d);
      });
    },
    [change],
  );

  // What's mid-drag (frame-level so every panel can show drop zones): a whole
  // panel, or one tab of a panel's stack.
  const [drag, setDrag] = useState<{ leafId: string; tab: number | null } | null>(
    null,
  );
  const beginDrag = useCallback(
    (leafId: string, tab?: number) => setDrag({ leafId, tab: tab ?? null }),
    [],
  );
  const endDrag = useCallback(() => setDrag(null), []);
  // A tab is always a document; a whole panel is documents unless it's the
  // folder navigator or empty.
  const dragCanStack = useMemo(() => {
    if (!drag || !layout) return false;
    if (drag.tab !== null) return true;
    const leaf = findLeaf(layout, drag.leafId);
    return isContentLeaf(leaf) && !!leaf?.view.url;
  }, [drag, layout]);

  const drop = useCallback(
    (targetLeafId: string, side: DropSide) => {
      setDrag(null);
      if (!drag) return;
      if (drag.tab === null) {
        if (drag.leafId === targetLeafId) return;
        change((d) => moveLeafIn(d, drag.leafId, targetLeafId, side));
        // Stacked into the target: focus that; otherwise the moved panel.
        focusLeaf(side === "center" ? targetLeafId : drag.leafId);
        return;
      }
      let shownIn: string | null = null;
      change((d) => {
        shownIn = moveTabIn(d, drag.leafId, drag.tab!, targetLeafId, side);
      });
      if (shownIn) focusLeaf(shownIn);
    },
    [drag, change, focusLeaf],
  );

  const dropIntoStrip = useCallback(
    (targetLeafId: string, at: number) => {
      setDrag(null);
      if (!drag) return;
      let shownIn: string | null = null;
      change((d) => {
        shownIn = stackIntoIn(d, drag.leafId, drag.tab, targetLeafId, at);
      });
      if (shownIn) focusLeaf(shownIn);
    },
    [drag, change, focusLeaf],
  );

  const activateTab = useCallback(
    (leafId: string, index: number) => {
      change((d) => activateTabIn(d, leafId, index));
      focusLeaf(leafId);
    },
    [change, focusLeaf],
  );

  const closeTab = useCallback(
    (leafId: string, index: number) => {
      change((d) => {
        closeTabIn(d, leafId, index);
      });
    },
    [change],
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

  // If `url` is already open in some panel, showing or stacked, show it (its
  // tab first, if stacked) and focus that panel. Returns whether it was.
  const revealExisting = useCallback(
    (current: LayoutNode, url: AutomergeUrl): boolean => {
      const found = findTabByUrl(current, url);
      if (!found) return false;
      if (!found.active) change((d) => activateTabIn(d, found.leafId, found.index));
      focusLeaf(found.leafId);
      return true;
    },
    [change, focusLeaf],
  );

  // **Engagement**: a pointer or key going into a document keeps its tab (see
  // `PanelView.preview`). Scrolling doesn't, and nor does anything in the
  // header. The frame can't tell a click that edits from a click that follows
  // a link until the link's open arrives, so it keeps the tab at once and
  // remembers having done so: an open that comes from that same panel soon
  // after (`tookEngagement`) was that click following a link, which isn't
  // engagement, so it replaces the tab after all.
  const lastEngageRef = useRef<{ leafId: string; url: string; at: number } | null>(
    null,
  );
  const engage = useCallback(
    (leafId: string) => {
      const leaf = findLeaf(layoutNow(), leafId);
      const url = leaf?.view.url;
      if (!leaf || !url || !leaf.view.preview) {
        lastEngageRef.current = null;
        return;
      }
      lastEngageRef.current = { leafId, url, at: performance.now() };
      handleRef.current?.change((d) => keepShowingIn(d, leafId));
    },
    [layoutNow],
  );
  const tookEngagement = useCallback((leafId: string): boolean => {
    const last = lastEngageRef.current;
    lastEngageRef.current = null;
    if (!last || last.leafId !== leafId) return false;
    if (performance.now() - last.at > ENGAGE_FOLLOW_MS) return false;
    const leaf = findLeaf(layoutNow(), leafId);
    return leaf?.view.url === last.url;
  }, [layoutNow]);

  // A tool isolated in an iframe keeps its pointer and keys to itself; the
  // window losing focus to one is all the frame hears. That's engagement too
  // (and focuses its panel, as a click anywhere else in it would).
  useEffect(() => {
    const onBlur = () =>
      setTimeout(() => {
        const frame = deepActiveElement();
        if (!(frame instanceof HTMLIFrameElement)) return;
        const leafId = leafIdOf(frame);
        if (!leafId) return;
        focusLeaf(leafId);
        engage(leafId);
      }, 0);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [focusLeaf, engage]);

  // Route a document-open request. `sourceId` is the panel the request came
  // from (null for app chrome and for URL/deep-link opens, which arrive on the
  // mount element).
  //
  // An open that arrives before the layout has loaded is held in
  // `pendingOpenRef` and replayed once it has (see below), rather than dropped.
  //
  // `placement` (from a modified click; see `openIntentRef`) means "don't
  // replace anything": `"stack"` (Shift-click) keeps the tab the target panel
  // is showing and stacks the new one over it; a direction (Alt-click) splits
  // the target panel instead. Showing an already-open doc is unchanged.
  const openView = useCallback(
    (view: PanelView, sourceId: string | null, placement?: OpenPlacement) => {
      if (!isValidAutomergeUrl(view.url)) return;
      const current = layoutNow();
      if (!current) {
        pendingOpenRef.current = { view, sourceId };
        return;
      }

      const leafIds = collectLeafIds(current);
      const liveIds = new Set(leafIds);
      if (sourceId === FROM_URL) {
        // Back/Forward to an entry the frame made: the panel it records.
        // Otherwise (an edited address bar, a plain link) the focused one.
        const order = focusRef.current.focusOrder;
        const isContent = (id: string) =>
          liveIds.has(id) && isContentLeaf(findLeaf(current, id));
        const recorded = entryLeaf();
        sourceId =
          (recorded && isContent(recorded) ? recorded : undefined) ??
          [...order].reverse().find(isContent) ??
          leafIds.find(isContent) ??
          null;
      }

      // A normal document must never land in (rule 1) the root-folder
      // navigator: it stays put so the folder tree stays beside the content.
      const isContentId = (id: string | null | undefined): id is string =>
        !!id && liveIds.has(id) && isContentLeaf(findLeaf(current, id));

      // 1. Already open? Just show it. Opening a doc that's already in a
      //    panel, showing or stacked (a folder click on it, or the host
      //    re-dispatching the URL's `doc` param on load/hashchange), should
      //    never duplicate it or, worse, clobber the panel you're in.
      if (revealExisting(current, view.url)) return;

      // 1b. Opening the viewer's own root folder targets the (symbolic) folder
      //     navigator rather than dropping the folder into a content pane.
      if (rootFolderUrl && view.url === rootFolderUrl) {
        const folderId = findRootFolderLeafId(current);
        if (folderId) focusLeaf(folderId);
        return;
      }

      // 2. Where it goes. A request from inside a document panel is
      //    navigation within it: it opens *there* (over the document it came
      //    from). From anywhere else (the folder navigator), it goes to the
      //    panel you're working in: an empty content frame if one is waiting
      //    (the seeded slot beside the folder), else the last-focused content
      //    panel. An open from the URL is a link followed from the focused
      //    document panel (see `FROM_URL`). Other sourceless opens (overlays)
      //    skip this: they split a new panel (step 4) rather than touch the
      //    one you're in.
      const isEmptyId = (id: string): boolean =>
        isContentLeaf(findLeaf(current, id)) &&
        !findLeaf(current, id)?.view.url;
      const order = focusRef.current.focusOrder;
      let emptyId: string | null = null;
      for (let i = order.length - 1; i >= 0 && !emptyId; i--) {
        if (liveIds.has(order[i]) && isEmptyId(order[i])) emptyId = order[i];
      }
      if (!emptyId) emptyId = leafIds.find((id) => isEmptyId(id)) ?? null;

      let target: string | null = null;
      if (isContentId(sourceId) && !isEmptyId(sourceId)) {
        target = sourceId;
      } else if (emptyId) {
        target = emptyId;
      } else if (sourceId !== null) {
        for (let i = order.length - 1; i >= 0 && !target; i--) {
          if (order[i] !== sourceId && isContentId(order[i])) target = order[i];
        }
      }

      // 3. Open it there, by the preview rule (see `openInLeafIn`): it
      //    replaces a tab you haven't engaged with, and otherwise stacks over
      //    the one showing. Shift keeps the showing tab regardless; Alt opens
      //    it beside the panel instead (Alt+Shift: below). A link followed
      //    from a preview doesn't keep it — the click that followed it isn't
      //    engagement (see `engage`) — so skimming through links, like
      //    skimming the folder, leaves one tab.
      if (target) {
        if (placement && placement !== "stack") {
          const newLeaf = makeLeaf({ ...view, preview: true });
          change((d) => splitLeafIn(d, target, placement, newLeaf));
          focusLeaf(newLeaf.id);
          return;
        }
        const mode: OpenMode =
          placement === "stack"
            ? "keep"
            : target === sourceId && tookEngagement(target)
              ? "replace"
              : "auto";
        change((d) => openInLeafIn(d, target, view, mode));
        focusLeaf(target);
        return;
      }

      // 4. Otherwise open a new panel by splitting a *content* panel, so we
      //    never carve up the root-folder navigator (rule 2). We never split
      //    the folder strip (that yields a super-narrow doc): when there's no
      //    content panel, split any other pane,
      //    falling back to the folder only when it's the sole pane.
      const active = focusRef.current.activeLeafId;
      const firstContentId = leafIds.find((id) => isContentId(id)) ?? null;
      const folderId = findRootFolderLeafId(current);
      const splitSource =
        (isContentId(sourceId) && sourceId) ||
        (isContentId(active) && active) ||
        firstContentId ||
        leafIds.find((id) => id !== folderId) ||
        leafIds[0];
      if (!splitSource) return;
      const newLeaf = makeLeaf({ ...view, preview: true });
      const direction =
        placement && placement !== "stack" ? placement : "horizontal";
      change((d) => splitLeafIn(d, splitSource, direction, newLeaf));
      focusLeaf(newLeaf.id);
    },
    [change, focusLeaf, rootFolderUrl, revealExisting, tookEngagement, layoutNow],
  );
  const openViewRef = useRef(openView);
  openViewRef.current = openView;

  // Make an open as one navigation (see `EntryState`): the URL is held while
  // the layout changes, then written once, as a new history entry naming the
  // panel now showing. Then the host is told what's showing, as if it had
  // come from the URL: its router writes the same hash (no navigation, by
  // the spec) and retitles the page, and the frame's own replay of it only
  // shows what's already shown.
  const navigate = useCallback(
    (open: () => void) => {
      holdUrlRef.current = true;
      try {
        open();
      } finally {
        holdUrlRef.current = false;
      }
      const leaf = syncUrlToSelection(true);
      if (!leaf?.view.url) return;
      const host = element instanceof ShadowRoot ? element.host : element;
      host.dispatchEvent(
        new CustomEvent("patchwork:open-document", {
          detail: { url: leaf.view.url, toolId: leaf.view.toolId },
        }),
      );
    },
    [syncUrlToSelection, element],
  );
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // A modified click opens without replacing anything: Shift stacks the
  // document in the panel it would have replaced; Alt opens it beside that
  // panel (Alt+Shift: below), as in VS Code's explorer. ⌘/Ctrl-click is taken
  // (the sidebar multi-selects with it), and `patchwork:open-document` carries
  // no modifier state, so the frame notes the modifiers of every click itself,
  // in the capture phase, before the tool's own click handler dispatches the
  // open. The next genuine open within a second takes it; any later click
  // resets it. Tools isolated in an iframe don't share our clicks, so for them
  // a modified click is an ordinary one.
  const openIntentRef = useRef<{ at: number; placement: OpenPlacement } | null>(
    null,
  );
  const takeOpenIntent = useCallback((): OpenPlacement | undefined => {
    const intent = openIntentRef.current;
    openIntentRef.current = null;
    return intent && performance.now() - intent.at < 1000
      ? intent.placement
      : undefined;
  }, []);

  // Replay an open that arrived before the layout existed. The host routes a
  // deep link (`#doc=…`) once, as the frame mounts — before a fresh session's
  // layout doc is seeded, and possibly before our listener is even attached
  // (we suspend on the account doc first). So we also seed this from the URL
  // itself; if that doc is already open, the replay is just a focus.
  const pendingOpenRef = useRef<{
    view: PanelView;
    sourceId: string | null;
  } | null>(null);
  const deepLinkReadRef = useRef(false);
  if (!deepLinkReadRef.current) {
    deepLinkReadRef.current = true;
    const view = readDeepLink();
    if (view) pendingOpenRef.current = { view, sourceId: FROM_URL };
  }
  useEffect(() => {
    if (!layout) return;
    const pending = pendingOpenRef.current;
    if (!pending) return;
    pendingOpenRef.current = null;
    openView(pending.view, pending.sourceId);
  }, [layout, openView]);

  const handleOpenDocument = useCallback(
    (event: OpenDocumentEvent) => {
      const url = event.detail.url;
      if (!url) return;
      const target = event.target as Element | null;
      // The host dispatches the opens that come from the URL (the address
      // bar edited, back/forward, a plain `#doc=…` link, a deep link) on the
      // mount element itself: those are links, followed from where you are.
      const host = element instanceof ShadowRoot ? element.host : element;
      if (target === host || (target as Node | null) === element) {
        openView({ url, toolId: event.detail.toolId }, FROM_URL, takeOpenIntent());
        return;
      }
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
      // A tab behind another isn't something you clicked in: whatever it
      // announces (it re-emits its own doc on mount and on title changes) is
      // never a navigation, and mustn't reach the URL either.
      if (target?.closest?.("[data-tab-hidden]")) {
        event.stopImmediatePropagation();
        return;
      }
      if (sourceId) {
        const layout = layoutNow();
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

      // A genuine open: the frame makes the history entry and tells the host
      // (see `navigate`), so the open itself goes no further.
      event.stopImmediatePropagation();
      const placement = takeOpenIntent();
      navigate(() => openView({ url, toolId: event.detail.toolId }, sourceId, placement));
    },
    [openView, rootFolderUrl, takeOpenIntent, element, navigate, layoutNow],
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

  useEffect(() => {
    const el = element;
    const onClick = (event: Event) => {
      const click = event as MouseEvent;
      const placement: OpenPlacement | null =
        click.metaKey || click.ctrlKey || click.button !== 0
          ? null
          : click.altKey
            ? click.shiftKey
              ? "vertical"
              : "horizontal"
            : click.shiftKey
              ? "stack"
              : null;
      openIntentRef.current = placement
        ? { at: performance.now(), placement }
        : null;
      if (!placement) return;
      const path = click.composedPath();
      // A plain `#doc=…` link would route through the URL (and a modified
      // click on a link downloads it or opens a window), so open it here.
      const anchor = path.find(
        (node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement,
      );
      const view = anchor ? docLinkView(anchor.href) : null;
      if (view) {
        click.preventDefault();
        click.stopPropagation();
        openIntentRef.current = null;
        const leafEl = path.find(
          (node): node is Element =>
            node instanceof Element && node.hasAttribute("data-leaf-id"),
        );
        const sourceId = leafEl?.getAttribute("data-leaf-id") ?? null;
        navigateRef.current(() => openViewRef.current(view, sourceId, placement));
      }
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [element]);

  // Top-bar "open" actions originate outside any panel, so they target the
  // active panel (or open a new one if the frame is somehow empty).
  // App-chrome opens (home, create-new, settings, account) act on the panel
  // you're in: show the doc where it's already open (focusing its panel, and
  // its tab if it's stacked), else open it in the active panel by the preview
  // rule (see `openInLeafIn`). This is
  // deliberately different from passive URL/deep-link
  // opens, which must never clobber the active panel (see `openView`).
  const openFromChromeNow = useCallback(
    (view: PanelView) => {
      if (!isValidAutomergeUrl(view.url)) return;
      const current = layoutNow();
      if (!current) return;
      if (revealExisting(current, view.url)) return;
      const ids = collectLeafIds(current);
      const liveIds = new Set(ids);
      const isContentId = (id: string | null | undefined): id is string =>
        !!id && liveIds.has(id) && isContentLeaf(findLeaf(current, id));

      // Act on the *content* panel you're in (the active one if it qualifies),
      // never the root-folder navigator (rule 1).
      const active = focusRef.current.activeLeafId;
      const target =
        (isContentId(active) && active) || ids.find((id) => isContentId(id)) || null;
      if (target) {
        change((d) => openInLeafIn(d, target, view));
        focusLeaf(target);
        return;
      }

      // No content panel yet: open beside the folder rather than replacing it
      // (we still must split the lone folder pane to make room for the doc).
      const splitSource = (active && liveIds.has(active) && active) || ids[0];
      if (!splitSource) return;
      const newLeaf = makeLeaf({ ...view, preview: true });
      change((d) => splitLeafIn(d, splitSource, "horizontal", newLeaf));
      focusLeaf(newLeaf.id);
    },
    [focusLeaf, change, revealExisting, layoutNow],
  );
  const openFromChrome = useCallback(
    (view: PanelView) => navigate(() => openFromChromeNow(view)),
    [navigate, openFromChromeNow],
  );

  // Quick Open: ⌘P (Ctrl-P off a Mac), from anywhere in the frame but inside
  // an iframe-isolated tool, whose keys never reach it. It replaces printing.
  const [quickOpen, setQuickOpen] = useState(false);
  const quickOpenFocusRef = useRef<Element | null>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isQuickOpenKey(event)) return;
      event.preventDefault();
      setQuickOpen((open) => {
        if (!open) quickOpenFocusRef.current = deepActiveElement();
        return true;
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The tab keys (see `tabKeys.ts`): close, next/previous, tab N. They
  // listen as the event bubbles out, so a tool that takes one of these keys
  // for itself (and says so with preventDefault) keeps it. Not while Quick
  // Open is up: its keys are its own.
  useEffect(() => {
    if (quickOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = tabCommandFor(event);
      if (!command) return;
      // The key is the frame's even with nothing to do (no ∑ typed instead).
      event.preventDefault();
      const action = tabActionFor(
        layoutNow(),
        focusRef.current.activeLeafId,
        selectedLeafId,
        command,
      );
      if (!action) return;
      if (action.op === "closeTab") closeTab(action.leafId, action.index);
      else if (action.op === "closePanel") close(action.leafId);
      else activateTab(action.leafId, action.index);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quickOpen, layoutNow, selectedLeafId, closeTab, close, activateTab]);

  // The shortcuts sheet: ? where it isn't typing, or the top bar's button.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsFocusRef = useRef<Element | null>(null);
  const openShortcuts = useCallback(() => {
    setShortcutsOpen((open) => {
      if (!open) shortcutsFocusRef.current = deepActiveElement();
      return true;
    });
  }, []);
  const closeShortcuts = useCallback(() => {
    setShortcutsOpen(false);
    const back = shortcutsFocusRef.current;
    shortcutsFocusRef.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isShortcutsKey(event)) return;
      event.preventDefault();
      openShortcuts();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openShortcuts]);

  const closeQuickOpen = useCallback(() => {
    setQuickOpen(false);
    const back = quickOpenFocusRef.current;
    quickOpenFocusRef.current = null;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }, []);
  const chooseQuickOpen = useCallback(
    (url: AutomergeUrl, placement: QuickPlacement) => {
      quickOpenFocusRef.current = null;
      setQuickOpen(false);
      navigate(() => openView({ url }, FROM_QUICK_OPEN, placement));
    },
    [navigate, openView],
  );
  const quickOpenUrls = useMemo(
    () => (quickOpen ? openTabUrls(layout, focusOrder) : []),
    [quickOpen, layout, focusOrder],
  );

  // Home: focus the (symbolic) root-folder navigator if it's open, else open it
  // as a full-height column on the left, wrapping the current arrangement.
  const goHome = useCallback(() => {
    const current = layoutNow();
    const folderId = current
      ? findRootFolderLeafId(current)
      : null;
    if (folderId) {
      focusLeaf(folderId);
      return;
    }
    let newId: string | null = null;
    change((d) => {
      newId = addRootFolderColumnIn(d);
    });
    if (newId) focusLeaf(newId);
  }, [focusLeaf, change, layoutNow]);

  // Each panel's content container, by leaf id (see `PanelContent`), and an
  // off-screen park to hold one while its panel is rebuilt mid-commit.
  const containersRef = useRef(new Map<string, HTMLDivElement>());
  const parkRef = useRef<HTMLDivElement>(null);
  const getContainer = useCallback((leafId: string) => {
    let container = containersRef.current.get(leafId);
    if (!container) {
      container = document.createElement("div");
      container.className = "tile-panel__content";
      containersRef.current.set(leafId, container);
    }
    return container;
  }, []);
  const parkContainer = useCallback((container: HTMLDivElement) => {
    if (parkRef.current) moveInto(parkRef.current, container);
    else container.remove();
  }, []);

  // Every panel, in a fixed order (by id) so React never reorders — and so
  // never moves — their portals as the tree is rearranged.
  const leaves = useMemo(() => {
    if (!layout) return [];
    return collectLeafIds(layout)
      .sort()
      .map((id) => findLeaf(layout, id))
      .filter((leaf): leaf is LeafNode => !!leaf);
  }, [layout]);

  // Drop containers for closed panels (React has already emptied them).
  useEffect(() => {
    const live = new Set(leaves.map((leaf) => leaf.id));
    for (const [id, container] of containersRef.current) {
      if (live.has(id)) continue;
      container.remove();
      containersRef.current.delete(id);
    }
  }, [leaves]);

  const ops: LayoutOps = {
    activeLeafId,
    focusLeaf,
    engage,
    close,
    activateTab,
    closeTab,
    drop,
    dropIntoStrip,
    draggingId: drag?.leafId ?? null,
    draggingTab: drag?.tab ?? null,
    dragCanStack,
    beginDrag,
    endDrag,
    setSizes,
    setTool,
    toggleDrawer,
    showDrawerTool,
    setDrawerWidth,
    documentProviders: documentProviderIds,
    contextTools,
    rootFolderUrl,
    selectedLeafId,
    selectedDocUrl,
    getContainer,
    parkContainer,
    draftsAvailable,
    setDraftScope,
    toolPreferences: accountDoc.toolPreferences,
    rememberTool,
  };

  return (
    <FrameProviders
      accountDocUrl={accountDocUrl}
      selectedDocUrl={selectedDocUrl}
      selectedToolId={selectedToolId}
      openViews={openViews}
      draftScope={selectedDraftScope}
    >
      <div className="tile-app" data-patchwork-frame="tiling">
        <TopBar
          repo={repo}
          accountDocUrl={accountDocUrl}
          moduleSettingsUrl={accountDoc.moduleSettingsUrl}
          contactUrl={accountDoc.contactUrl}
          rootFolderHandle={rootFolderHandle}
          trayItems={trayItems}
          overlays={overlays}
          openOverlays={openOverlays}
          onToggleOverlay={toggleOverlay}
          onHome={goHome}
          onOpen={openFromChrome}
          onShortcuts={openShortcuts}
        />
        {shortcutsOpen && <ShortcutsSheet onClose={closeShortcuts} />}
        {quickOpen && (
          <QuickOpen
            repo={repo}
            rootFolderUrl={rootFolderUrl}
            openUrls={quickOpenUrls}
            currentUrl={selectedDocUrl}
            onChoose={chooseQuickOpen}
            onClose={closeQuickOpen}
          />
        )}
        <div className="tile-frame">
          <div className="tile-park" ref={parkRef} hidden />
          {leaves.map((leaf) => (
            <PanelContent key={leaf.id} leaf={leaf} ops={ops} />
          ))}
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
          {overlays.length > 0 && (
            <div className="tile-overlays" ref={overlayLayerRef}>
              {overlays.map((overlay) => (
                <div
                  key={overlay.id}
                  className="tile-overlay"
                  data-overlay-id={overlay.id}
                >
                  <patchwork-view component={overlay.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </FrameProviders>
  );
};

/**
 * Is this frame being mounted *inside another frame* (of any kind)? The frame
 * configurator's "Frame Tool" preview cards render every `frame-tool` against the
 * account doc — including frames themselves — so a frame mounted there would
 * re-render its whole UI (configurator pane and all), looping forever.
 *
 * We detect a frame ancestor generally, crossing shadow boundaries, by either:
 *   - an element a frame marks with `data-patchwork-frame` (the convention this
 *     frame follows on its root), or
 *   - an ancestor `<patchwork-view>` hosting a tool tagged `frame-tool` (so we
 *     also bail inside frames that don't set the marker).
 * The walk starts above *our own* hosting `<patchwork-view>` (found via
 * `closest`, not assumed to be `element` itself — see below), since that one
 * always hosts a `frame-tool` (us) and isn't evidence of nesting.
 * Callers render a static placeholder instead, breaking the recursion.
 */
function isMountedInsideFrame(element: HTMLElement | ShadowRoot): boolean {
  let registry: ReturnType<typeof getRegistry<ToolDescription>> | null = null;
  const hostsFrameTool = (toolId: string): boolean => {
    registry ??= getRegistry<ToolDescription>("patchwork:tool");
    return !!registry.get(toolId)?.tags?.includes("frame-tool");
  };

  const start = element instanceof ShadowRoot ? element.host : element;
  // `element` is *our own* mount point. `<patchwork-view>` may host it
  // directly, or (now that it wraps legacy-mode content in a child element)
  // `element` may be a descendant of that host instead. Either way, the walk
  // below must start *above* our own hosting `<patchwork-view>`, not at it —
  // since we ourselves are a `frame-tool`, stopping there would make every
  // mount trivially "detect" itself as nested inside a frame.
  const ownHost = start.closest("patchwork-view") ?? start;

  let node: Node | null = ownHost.parentNode ?? null;
  while (node) {
    if (node instanceof Element) {
      if (node.hasAttribute("data-patchwork-frame")) return true;
      if (node.tagName === "PATCHWORK-VIEW") {
        const toolId = node.getAttribute("tool-id");
        if (toolId && hostsFrameTool(toolId)) return true;
      }
    }
    let next: Node | null = node.parentNode;
    if (!next) {
      const root = node.getRootNode();
      next = root instanceof ShadowRoot ? root.host : null;
    }
    node = next;
  }
  return false;
}

export function renderPatchworkFrame(
  handle: { url: AutomergeUrl },
  element: ToolElement,
) {
  const root = createRoot(element);
  if (isMountedInsideFrame(element)) {
    root.render(
      <div className="tile-frame tile-frame--nested">
        <div className="tile-frame__empty">Tiling Frame</div>
      </div>,
    );
    return () => root.unmount();
  }
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
