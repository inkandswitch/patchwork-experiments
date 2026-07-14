import {
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import { createSignal, type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import { CardsSidebar } from "./CardsSidebar";
import { trackSelectedDocument } from "./selected-doc";
import type { CardStackDoc } from "./types";

// ---------------------------------------------------------------------------
// The always-on Cards host. One hidden, body-parked element carrying the
// mounted sidebar (both card stacks and the parts bin), shared by every
// retainer through refcounted *leases* — the sidebar tab docks it to become
// visible, the toolbar keeper just holds it alive so the cards keep running
// while the sidebar is closed. There is deliberately no page-lifetime
// singleton: when the last lease lapses (plus a short grace period)
// everything is disposed, and a later retain starts fresh.
// ---------------------------------------------------------------------------

// localStorage key holding this browser's singleton global card stack (the
// "Global" tab). Deliberately per-device, not synced through the account, so
// the same stack reopens across sessions. (The parts bin needs no singleton:
// it is code-defined — see ../parts-bin/catalog.ts.)
const GLOBAL_STACK_URL_KEY = "embark:global-card-stack-url";

// The sidebar face of the Cards host. Registered as a `patchwork:component`
// tagged `context-tool` — the frame's context sidebar renders entries as bare
// components with no document (`(element, repo) => cleanup`). It doesn't own
// the host: it takes a lease and docks it here while the tab is open; on
// close the host parks back on document.body — still running, as long as
// another lease (the toolbar keeper) is live.
export const CardsSidebarComponent = (
  element: HTMLElement,
  repo?: Repo,
): (() => void) => {
  const resolvedRepo = (element as Partial<ToolElement>).repo ?? repo;
  if (!resolvedRepo) {
    throw new Error(
      "[cards] CardsSidebarComponent mounted with no repo (neither stamped on the element nor passed in); the sidebar cannot run",
    );
  }

  const lease = retainCardsHost(resolvedRepo);
  lease.dock(element);

  return () => {
    lease.park();
    lease.release();
  };
};

// The always-on keeper, registered as a `titlebar-tool` so it can be added to
// the frame's toolbar lane. It renders nothing and ignores the document it is
// handed (the toolbar points it at whatever doc is open) — its only job is to
// hold a lease on the Cards host so the cards keep running while the sidebar
// is closed. The toolbar remounts on every document switch (the frame keys
// that whole subtree on the selected doc), which the lease's grace period
// bridges so the host never cycles.
export const CardsKeeperTool: ToolRender = (_handle, element) => {
  if (!element.repo) {
    throw new Error(
      "[cards] CardsKeeperTool mounted with no repo stamped on its element; the cards host cannot be retained",
    );
  }
  const lease = retainCardsHost(element.repo);
  return () => lease.release();
};

// How long the host survives with no live leases. Long enough to bridge a
// document switch (the frame disposes the toolbar/sidebar subtree, loads
// modules async, remounts — the keeper's release and re-retain straddle that
// gap), short enough that removing the keeper stops the cards promptly.
const LEASE_GRACE_MS = 3000;

export type CardsHostLease = {
  // Move the host into `target` and make it visible.
  dock(target: HTMLElement): void;
  // Return the host to its hidden parking spot on document.body. Only the
  // lease whose dock target still holds the host may park it — a new sidebar
  // panel can dock before the old panel's cleanup runs.
  park(): void;
  release(): void;
};

type CardsHostState = {
  host: ToolElement;
  // Set once the global stack resolves; used to remount after a fallback move.
  globalStack: DocHandle<CardStackDoc> | undefined;
  // The frame's selected document, tracked for the host's whole lifetime (the
  // signal survives remounts, so the Current Doc tab doesn't blink on moves).
  selectedDoc: Accessor<AutomergeUrl | undefined>;
  stopTracking: () => void;
  // Disposer of the current sidebar mount (undefined while resolving).
  dispose: (() => void) | undefined;
  retainCount: number;
  graceTimer: ReturnType<typeof setTimeout> | undefined;
  torndown: boolean;
};

let cardsHostState: CardsHostState | null = null;

export function retainCardsHost(repo: Repo): CardsHostLease {
  if (!cardsHostState) cardsHostState = createCardsHostState(repo);
  const state = cardsHostState;
  state.retainCount += 1;
  if (state.graceTimer !== undefined) {
    clearTimeout(state.graceTimer);
    state.graceTimer = undefined;
  }

  let released = false;
  let dockTarget: HTMLElement | null = null;
  let cancelPendingDock: (() => void) | undefined;

  return {
    dock(target) {
      if (released || state.torndown) return;
      dockTarget = target;
      cancelPendingDock?.();
      // The element a component mounts into may not be in the document yet
      // (patchwork-view's attribute-driven mounts run off a microtask, before
      // insertion), and moveBefore requires both ends connected — defer the
      // move (and the visible styles) until the target lands.
      cancelPendingDock = whenConnected(target, () => {
        cancelPendingDock = undefined;
        if (released || state.torndown || dockTarget !== target) return;
        applyDockedStyles(state.host);
        moveHost(state, target);
      });
    },
    park() {
      cancelPendingDock?.();
      cancelPendingDock = undefined;
      if (state.torndown || !dockTarget) return;
      const holding = dockTarget.contains(state.host);
      dockTarget = null;
      // Another lease may have docked the host away before this cleanup ran
      // (tab switches), or the deferred dock never landed — nothing to park.
      if (!holding) return;
      applyParkedStyles(state.host);
      moveHost(state, document.body);
    },
    release() {
      if (released) return;
      released = true;
      if (state.torndown) return;
      state.retainCount -= 1;
      if (state.retainCount > 0) return;
      state.graceTimer = setTimeout(
        () => teardownCardsHost(state),
        LEASE_GRACE_MS,
      );
    },
  };
}

// Build the host, park it hidden on body, and mount the sidebar into it
// (async — the singletons have to resolve first). A failed mount tears the
// host down instead of being cached: existing leases go inert and the next
// retain starts over.
function createCardsHostState(repo: Repo): CardsHostState {
  const host = createCardsHostElement(repo);
  applyParkedStyles(host);
  document.body.appendChild(host);

  const [selectedDoc, setSelectedDoc] = createSignal<
    AutomergeUrl | undefined
  >(undefined);
  const stopTracking = trackSelectedDocument(setSelectedDoc);

  const state: CardsHostState = {
    host,
    globalStack: undefined,
    selectedDoc,
    stopTracking,
    dispose: undefined,
    retainCount: 0,
    graceTimer: undefined,
    torndown: false,
  };

  void resolveGlobalStack(repo).then(
    (globalStack) => {
      if (state.torndown) return;
      state.globalStack = globalStack;
      state.dispose = mountSidebar(state);
    },
    (error: unknown) => {
      console.error("[embark] cards sidebar failed to load", error);
      teardownCardsHost(state);
    },
  );

  return state;
}

function mountSidebar(state: CardsHostState): (() => void) | undefined {
  const globalStack = state.globalStack;
  if (!globalStack) return undefined;
  return render(
    () => (
      <RepoContext.Provider value={state.host.repo}>
        <CardsSidebar
          globalStack={globalStack}
          selectedDoc={state.selectedDoc}
        />
      </RepoContext.Provider>
    ),
    state.host,
  );
}

function teardownCardsHost(state: CardsHostState): void {
  if (state.torndown) return;
  state.torndown = true;
  if (state.graceTimer !== undefined) clearTimeout(state.graceTimer);
  state.stopTracking();
  state.dispose?.();
  state.dispose = undefined;
  state.host.remove();
  if (cardsHostState === state) cardsHostState = null;
}

// The host element: carries the repo for the mounted tree and always answers
// repo:handle-descriptor with the identity descriptor, so a drafts overlay
// above wherever it is docked never forks the sidebar's docs into a draft.
// The nearest answerer on the bubble path wins (accept stops propagation).
// (The descriptor shape matches OverlayRepo's DocHandleDescriptor:
// `{ url, cloneUrl? }`; identity means no cloneUrl.)
function createCardsHostElement(repo: Repo): ToolElement {
  const host = document.createElement("div") as unknown as ToolElement;
  host.repo = repo;
  host.addEventListener("patchwork:subscribe", (event) => {
    const sub = event as SubscribeEvent;
    if (sub.detail.selector.type !== "repo:handle-descriptor") return;
    const url = sub.detail.selector.url as AutomergeUrl | undefined;
    if (!url) return;
    accept<{ url: AutomergeUrl }>(sub, (respond) => respond({ url }));
  });
  return host;
}

// Parked: out of sight but *laid out* — visibility (not display:none) keeps
// measuring embeds (maps, ResizeObservers) alive while hidden, with a
// sidebar-like footprint so their layout stays sane.
function applyParkedStyles(host: HTMLElement): void {
  host.style.position = "fixed";
  host.style.top = "0";
  host.style.left = "0";
  host.style.width = "360px";
  host.style.height = "100vh";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
}

// Docked: fill the sidebar element it was moved into.
function applyDockedStyles(host: HTMLElement): void {
  host.style.position = "relative";
  host.style.top = "";
  host.style.left = "";
  host.style.width = "100%";
  host.style.height = "100%";
  host.style.visibility = "visible";
  host.style.pointerEvents = "";
}

// Reparent the host. `moveBefore` (where supported) is an atomic,
// state-preserving move: descendant <patchwork-view>s get their
// connectedMoveCallback instead of disconnect/connect, so the mounted sidebar
// — live cards, bin previews, running card modules — survives intact. It only
// works connected-to-connected, so a host stranded in an already-removed
// sidebar subtree (park runs after the frame tore the panel's DOM out) takes
// the fallback: a *deliberate* remount — dispose the mount, move the empty
// host, mount fresh. Never appendChild a live tree — <patchwork-view>'s
// disconnectedCallback teardown is async and would race the immediate
// reconnect.
function moveHost(state: CardsHostState, parent: HTMLElement): void {
  const movable = parent as HTMLElement & {
    moveBefore?: (node: Node, child: Node | null) => void;
  };
  if (
    typeof movable.moveBefore === "function" &&
    parent.isConnected &&
    state.host.isConnected
  ) {
    try {
      movable.moveBefore(state.host, null);
      return;
    } catch {
      // Hierarchy edge case moveBefore won't do — fall through to remount.
    }
  }
  state.dispose?.();
  state.dispose = undefined;
  parent.appendChild(state.host);
  state.dispose = mountSidebar(state);
}

// Run `fn` once `el` is in the document, now or as soon as it lands (polled
// per frame — insertion normally follows within one). Returns a canceller;
// gives up quietly after ~10s so an abandoned mount can't poll forever.
function whenConnected(el: HTMLElement, fn: () => void): () => void {
  if (el.isConnected) {
    fn();
    return () => {};
  }
  const deadline = Date.now() + 10_000;
  let frame = requestAnimationFrame(function check() {
    if (el.isConnected) {
      fn();
      return;
    }
    if (Date.now() > deadline) return;
    frame = requestAnimationFrame(check);
  });
  return () => cancelAnimationFrame(frame);
}

// Find-or-create this browser's singleton global card stack. A stored url
// that can't be resolved in this repo (e.g. a different device or account) is
// treated as absent and a fresh doc is minted.
function resolveGlobalStack(repo: Repo): Promise<DocHandle<CardStackDoc>> {
  return findOrCreate<CardStackDoc>(repo, GLOBAL_STACK_URL_KEY, () =>
    repo.create<CardStackDoc>({
      "@patchwork": { type: "card-stack" },
      title: "Global cards",
      cards: [],
    }),
  );
}

async function findOrCreate<T>(
  repo: Repo,
  storageKey: string,
  create: () => DocHandle<T>,
): Promise<DocHandle<T>> {
  const stored = localStorage.getItem(storageKey);
  if (stored && isValidAutomergeUrl(stored)) {
    try {
      return await repo.find<T>(stored);
    } catch {
      // Fall through and mint a new one.
    }
  }
  const created = create();
  localStorage.setItem(storageKey, created.url);
  return created;
}
