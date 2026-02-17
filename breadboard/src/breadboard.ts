import type { DocHandle } from "@automerge/automerge-repo";
import type {
  PatchworkViewElement,
  StyleOriginals,
  EnrichedConfigMap,
} from "./types.js";
import { discoverViews, observeViewChanges } from "./discovery.js";
import { applyPullApart, restoreAll } from "./pull-apart.js";
import { renderCards, cleanupOverlayTimer } from "./render.js";
import { tryReadAccountDoc, getAccountDocUrl } from "./enrichment.js";
import { createSlotChangeHandler } from "./editing.js";
import { clearPositionCache } from "./layout.js";
import { startSyncMonitor } from "./sync-activity.js";

function activate(toolElement: PatchworkViewElement): () => void {
  const originals: StyleOriginals = new Map();
  let rafId: number;
  let configMap: EnrichedConfigMap | null = null;
  let cleanupSync: (() => void) | null = null;

  const views = discoverViews();
  const accountDocUrl = getAccountDocUrl(views);
  const onSlotChange = createSlotChangeHandler(toolElement, accountDocUrl);
  const cleanupPullApart = applyPullApart(views, originals);

  const overlay = document.createElement("div");
  overlay.id = "breadboard-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;pointer-events:none;";
  document.body.appendChild(overlay);

  function scheduleRender() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        cleanupOverlayTimer(overlay);
        cleanupSync?.();
        cleanupSync = null;
        overlay.innerHTML = "";

        const fresh = discoverViews();
        const { svg, cardLookup } = renderCards(
          overlay,
          fresh,
          configMap,
          onSlotChange
        );
        cleanupSync = startSyncMonitor(
          svg,
          overlay,
          fresh,
          cardLookup,
          toolElement.repo
        );
      })
    );
  }

  scheduleRender();
  tryReadAccountDoc(views, toolElement).then((map) => {
    configMap = map;
    scheduleRender();
  });

  const observer = observeViewChanges(scheduleRender);

  return () => {
    cancelAnimationFrame(rafId);
    cleanupPullApart();
    cleanupOverlayTimer(overlay);
    cleanupSync?.();
    observer.disconnect();
    overlay.remove();
    restoreAll(originals);
    clearPositionCache();
  };
}

function renderBreadboard(
  _handle: DocHandle<unknown>,
  element: PatchworkViewElement
): () => void {
  const btn = document.createElement("button");
  btn.textContent = "\u2394";
  btn.title = "Toggle Breadboard (Cmd+Shift+B)";
  btn.style.cssText = `
    background: none; border: 1px solid transparent; border-radius: 4px;
    cursor: pointer; font-size: 16px; padding: 2px 6px; color: inherit;
    opacity: 0.6; transition: opacity 0.15s, border-color 0.15s; line-height: 1;
  `;

  let active = false;
  let cleanup: (() => void) | null = null;

  const setHighlight = (on: boolean) => {
    btn.style.opacity = on ? "1" : "0.6";
    btn.style.borderColor = on ? "rgba(120, 140, 255, 0.6)" : "transparent";
  };

  btn.addEventListener("mouseenter", () => setHighlight(true));
  btn.addEventListener("mouseleave", () => {
    if (!active) setHighlight(false);
  });

  const toggle = () => {
    active = !active;
    setHighlight(active);
    if (active) {
      cleanup = activate(element);
    } else {
      cleanup?.();
      cleanup = null;
    }
  };

  btn.addEventListener("click", toggle);
  element.appendChild(btn);

  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "b") {
      e.preventDefault();
      toggle();
    }
    if (e.key === "Escape" && active) toggle();
  };
  document.addEventListener("keydown", onKey);

  return () => {
    document.removeEventListener("keydown", onKey);
    cleanup?.();
    btn.remove();
  };
}

export const plugins = [
  {
    type: "patchwork:tool" as const,
    id: "breadboard",
    name: "Breadboard",
    icon: "CircuitBoard",
    supportedDatatypes: "*" as const,
    unlisted: true,
    forTitleBar: true,
    tags: ["titlebar-tool"],
    async load() {
      return renderBreadboard;
    },
  },
];
