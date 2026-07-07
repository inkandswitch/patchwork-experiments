import {
  isImmutableString,
  isValidAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { CardIcon } from "./icons";
import type { CardDoc } from "./datatype";
import "./card.css";

// The module every card feature package ships as its `card.js`. It renders the
// card's middle slot and runs the card's behavior against the shared context.
// Its shape is the tool-render contract: it receives the card document handle
// and a host element (with `repo` stamped on) whose context discovery resolves
// to the page-global body store, and returns an optional teardown. Behavior-only
// cards render nothing into the slot.
export type CardModule = (
  handle: DocHandle<CardDoc>,
  element: ToolElement,
) => (() => void) | void;

// The generic card tool: the only tool the `card` datatype registers. It draws
// the playing-card shell (title / middle / description, mirrored corner pips,
// and a flip affordance) and, while face-up, loads and runs the behavior module
// named by `doc.src` into the middle slot. Flipping to the back tears the
// module down, so a deactivated card stops contributing to the canvas entirely.
// The module's file doc is watched while the card is up: editing the code in
// place (a regeneration, a remote edit) reloads the behavior live.
export const CardTool: ToolRender<CardDoc> = (handle, element) =>
  render(() => <Card handle={handle} host={element} />, element);

function Card(props: { handle: DocHandle<CardDoc>; host: ToolElement }) {
  const [doc, setDoc] = createSignal<CardDoc>(props.handle.doc());
  const sync = () => setDoc(props.handle.doc());
  props.handle.on("change", sync);
  onCleanup(() => props.handle.off("change", sync));

  const title = () => doc()?.["@patchwork"]?.title || "Card";
  const description = () => doc()?.description ?? "";
  const icon = () => doc()?.icon || "card";
  const accent = () => doc()?.accent || "#16a34a";
  // Memoized so the load effect below re-runs only when the source or the
  // active/inactive state actually changes — not on every card state edit (e.g.
  // a module writing its own persisted fields).
  const src = createMemo(() => doc()?.src || "");
  const active = createMemo(() => doc()?.flipped !== true);

  // Bumped by the watcher below whenever the module file's code changes while
  // the src stays put. The load effect keys on it and busts the browser's
  // module cache with a URL fragment, so the new code actually loads.
  const [moduleEpoch, setModuleEpoch] = createSignal(0);
  watchModuleFile(src, props.host, () => setModuleEpoch((n) => n + 1));

  const toggleFlip = () =>
    props.handle.change((d) => {
      d.flipped = d.flipped !== true;
    });

  let slotEl: HTMLDivElement | undefined;

  onMount(() => {
    let cleanup: (() => void) | void;
    let token = 0;

    const teardown = () => {
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {
          // ignore module teardown errors
        }
      }
      cleanup = undefined;
    };

    createEffect(() => {
      const moduleSrc = src();
      const epoch = moduleEpoch();
      const isActive = active();
      const host = slotEl;
      // A fresh generation invalidates any import still in flight.
      const mine = ++token;
      teardown();
      host?.replaceChildren();
      if (!isActive || !moduleSrc || !host) return;
      // The embed contract: the module reaches the repo and (via DOM discovery)
      // the shared context through its host element.
      (host as unknown as { repo: Repo }).repo = props.host.repo;
      // Dynamic imports are cached by URL; a changed fragment forces a fresh
      // module map entry (and fetch) for edited-in-place code, while the
      // request the service worker sees stays the same.
      const importUrl = epoch > 0 ? `${moduleSrc}#reload=${epoch}` : moduleSrc;
      const cardUrl = props.handle.url;
      void (async () => {
        // Each failure mode below leaves the slot empty, but says why — a
        // silent dead card is undebuggable.
        let mod: { default?: unknown };
        try {
          mod = (await import(/* @vite-ignore */ importUrl)) as {
            default?: unknown;
          };
        } catch (err) {
          console.warn(
            `[card] ${cardUrl}: failed to import module ${importUrl}`,
            err,
          );
          return;
        }
        if (mine !== token) return;
        if (typeof mod.default !== "function") {
          console.warn(
            `[card] ${cardUrl}: module ${importUrl} has no default export function (got ${typeof mod.default})`,
          );
          return;
        }
        try {
          const dispose = (mod.default as CardModule)(
            props.handle,
            host as unknown as ToolElement,
          );
          if (mine !== token) {
            if (typeof dispose === "function") dispose();
            return;
          }
          cleanup = dispose ?? undefined;
        } catch (err) {
          console.warn(
            `[card] ${cardUrl}: module ${importUrl} threw while starting`,
            err,
          );
        }
      })();
    });

    onCleanup(() => {
      token++;
      teardown();
    });
  });

  // Both faces are rendered and stacked; flipping rotates the inner element a
  // half-turn so the front turns away and the back comes into view (see
  // card.css). Both faces carry the same title / middle / description skeleton,
  // so the description keeps its place at the bottom across the flip — only the
  // front's middle slot holds the live module, the back's stays blank.
  return (
    <div
      class="embark-card-flip"
      classList={{ "embark-card-flip--flipped": !active() }}
    >
      <div class="embark-card-flip__inner">
        <div
          class="embark-card embark-card--front"
          style={{ "--embark-card-accent": accent() }}
        >
          <Pips icon={icon()} />
          <div class="embark-card__body">
            <div class="embark-card__title">{title()}</div>
            <div class="embark-card__middle" ref={slotEl} />
            <p class="embark-card__desc">{description()}</p>
          </div>
          <FlipButton active={active()} onFlip={toggleFlip} />
        </div>
        <div
          class="embark-card embark-card--back"
          style={{ "--embark-card-accent": accent() }}
        >
          <Pips icon={icon()} />
          <div class="embark-card__body">
            <div class="embark-card__title">{title()}</div>
            <div class="embark-card__middle" />
            <p class="embark-card__desc">{description()}</p>
          </div>
          <FlipButton active={active()} onFlip={toggleFlip} />
        </div>
      </div>
    </div>
  );
}

// --- watching the module file for in-place edits -------------------------------

// Changes settle (an LLM write plus the package-root bump that follows it,
// a burst of synced automerge changes) before the module reloads.
const RELOAD_DEBOUNCE_MS = 400;

// Watch the file doc behind a `/automerge%3A<pkg>/<path>` src — plus every
// folder doc on the way to it, since entries can be repointed — and call
// `onCodeChanged` when the module's text actually differs from what's loaded.
// Srcs that don't point into a package (http urls) aren't watchable.
function watchModuleFile(
  src: () => string,
  host: ToolElement,
  onCodeChanged: () => void,
): void {
  createEffect(() => {
    const location = parseModuleSrc(src());
    if (!location) return;

    let disposed = false;
    let timer: number | undefined;
    let unsubscribes: Array<() => void> = [];
    // The module text the running import corresponds to; a different
    // fingerprint later is what triggers the reload.
    let loadedFingerprint: string | undefined;
    let initialized = false;

    const unsubscribeAll = () => {
      for (const stop of unsubscribes) stop();
      unsubscribes = [];
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void sync(), RELOAD_DEBOUNCE_MS);
    };

    // (Re)resolve the file doc, move the subscriptions onto the fresh chain
    // (an entry may have been repointed at a new doc), and compare code.
    const sync = async () => {
      const resolved = await resolveModuleFile(host.repo, location).catch(
        () => null,
      );
      if (disposed) return;
      unsubscribeAll();
      if (!resolved) return;
      for (const handle of resolved.watch) {
        handle.on("change", schedule);
        unsubscribes.push(() => handle.off("change", schedule));
      }
      const fingerprint = moduleText(resolved.file.doc());
      if (!initialized) {
        // The first resolution observes the code the initial import is
        // already loading — record it, don't reload.
        initialized = true;
        loadedFingerprint = fingerprint;
        return;
      }
      if (fingerprint === undefined || fingerprint === loadedFingerprint) {
        return;
      }
      loadedFingerprint = fingerprint;
      onCodeChanged();
    };

    void sync();

    onCleanup(() => {
      disposed = true;
      clearTimeout(timer);
      unsubscribeAll();
    });
  });
}

type ModuleLocation = { packageUrl: AutomergeUrl; segments: string[] };

// A src of the special form `/automerge%3A<pkg>/<path>` names a file inside
// the card's package (the service worker serves it); anything else is null.
function parseModuleSrc(src: string): ModuleLocation | null {
  const segments = src.replace(/^\//, "").split("/");
  const root = decodeURIComponent(segments[0] ?? "").split("#")[0];
  if (!isValidAutomergeUrl(root)) return null;
  const path = segments.slice(1).map(decodeURIComponent).filter(Boolean);
  if (path.length === 0) return null;
  return { packageUrl: root, segments: path };
}

type ModuleFileDoc = { content?: unknown };

type ResolvedModule = {
  file: DocHandle<ModuleFileDoc>;
  // Every doc whose change can affect the module: the folders walked through
  // plus the file itself.
  watch: DocHandle<unknown>[];
};

// Walk the package to the module's file doc, following the same rules as the
// service worker: folder docs match one `docs[].name` segment at a time,
// directory docs match the longest joined-path prefix among their flat keys.
async function resolveModuleFile(
  repo: Repo,
  location: ModuleLocation,
): Promise<ResolvedModule | null> {
  const watch: DocHandle<unknown>[] = [];
  let url: AutomergeUrl = location.packageUrl;
  let segments = location.segments;

  while (segments.length > 0) {
    const handle = await repo.find(url);
    watch.push(handle);
    const step = stepInto(handle.doc(), segments);
    if (!step) return null;
    url = step.url;
    segments = step.rest;
  }

  const file = await repo.find<ModuleFileDoc>(url);
  watch.push(file);
  return { file, watch };
}

function stepInto(
  doc: unknown,
  segments: string[],
): { url: AutomergeUrl; rest: string[] } | null {
  if (isDirectoryShape(doc)) {
    for (let take = segments.length; take >= 1; take--) {
      const url = liveUrl(doc[segments.slice(0, take).join("/")]);
      if (url) return { url, rest: segments.slice(take) };
    }
    return null;
  }
  if (isFolderShape(doc)) {
    const entry = doc.docs.find((link) => link?.name === segments[0]);
    const url = liveUrl(entry?.url);
    return url ? { url, rest: segments.slice(1) } : null;
  }
  return null;
}

// A package entry's url without any `#heads` pin — the watcher wants the live
// doc, not a historical view.
function liveUrl(value: unknown): AutomergeUrl | undefined {
  if (typeof value !== "string") return undefined;
  const base = value.split("#")[0];
  return isValidAutomergeUrl(base) ? base : undefined;
}

type FolderShape = { docs: Array<{ name?: string; url?: string }> };
type DirectoryShape = Record<string, unknown>;

function isFolderShape(doc: unknown): doc is FolderShape {
  return Array.isArray((doc as FolderShape | undefined)?.docs);
}

function isDirectoryShape(doc: unknown): doc is DirectoryShape {
  const meta = (doc as { "@patchwork"?: { type?: string } } | undefined)?.[
    "@patchwork"
  ];
  return meta?.type === "directory";
}

// The module's code as text — a plain string for collaborative files, an
// ImmutableString for synced build artifacts. Binary content isn't a module.
function moduleText(doc: ModuleFileDoc | undefined): string | undefined {
  const content = doc?.content;
  if (typeof content === "string") return content;
  if (isImmutableString(content)) return String(content);
  return undefined;
}

// The mirrored corner pips, drawn from the card's stored icon + accent. Shared
// by both faces.
function Pips(props: { icon: string }) {
  return (
    <>
      <span class="embark-card__pip embark-card__pip--tl">
        <CardIcon name={props.icon} />
      </span>
      <span class="embark-card__pip embark-card__pip--br">
        <CardIcon name={props.icon} />
      </span>
    </>
  );
}

// The flip affordance, present on both faces so the card can be turned over and
// back. Its press is kept off the embed surface so it doesn't start a drag.
function FlipButton(props: { active: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      class="embark-card__flip"
      title={props.active ? "Deactivate card" : "Activate card"}
      aria-label={props.active ? "Deactivate card" : "Activate card"}
      on:pointerdown={(event) => event.stopPropagation()}
      on:click={props.onFlip}
    >
      <FlipIcon />
    </button>
  );
}

function FlipIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
