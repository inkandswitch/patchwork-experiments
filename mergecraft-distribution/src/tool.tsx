import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { cell, effect } from "bireactive";
import { connectStore } from "bireactive/automerge";
import { mount } from "bireactive/jsx-runtime";
import { midpointPad, profileEditor } from "./chart";
import {
  type Cube,
  dominantMidpoint,
  fitSlice,
  generateFilledSlice,
} from "./lens";

type Doc = { title?: string; cubes?: Cube[] };
type SelectedView = { url: string; toolId: string | null } | null;

/** Identity key for keyed Automerge reconciliation. Cubes (`[x, y, z]`) key on
 *  their coordinate so edits become per-coordinate splices that merge cleanly
 *  and map 1:1 onto Mergecraft's coordinate-keyed render; the scalar coords
 *  inside a cube aren't arrays, so they return `undefined` and fall back to
 *  positional — exactly what `By` must do (it's applied to every list/element). */
const byCoord = (v: unknown): unknown => (Array.isArray(v) ? v.join(",") : undefined);

const cubesEqual = (a: Cube[], b: Cube[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1] || a[i][2] !== b[i][2]) {
      return false;
    }
  }
  return true;
};

/** Build the distribution editor for one ready handle, into `host`. Returns a
 *  disposer that tears down the store bridge, the SVG widgets, every effect, and
 *  removes the mounted DOM — so the whole thing can be cleanly rebuilt when we
 *  rebind to a different doc (the JSX `mount` disposer only stops effects). */
function startSession(handle: DocHandle<Doc>, host: HTMLElement): () => void {
  const root = document.createElement("div");
  host.appendChild(root);
  const removeRoot = () => root.remove();

  let doc: Doc | undefined;
  try {
    doc = handle.doc();
  } catch {
    doc = undefined;
  }

  if (!doc || !Array.isArray(doc.cubes)) {
    const disposeUI = mount(
      () => (
        <div style="font:13px/1.5 ui-sans-serif,system-ui,sans-serif;color:inherit;opacity:0.7;padding:14px;">
          This document isn't a Mergecraft world (no <code>cubes</code> array).
        </div>
      ),
      root,
    );
    return () => {
      disposeUI();
      removeRoot();
    };
  }

  // Deep store over the doc; writing `cubes.value` commits via keyed reconcile.
  const bridge = connectStore<Doc>(handle, { by: byCoord });
  const cubes = bridge.store.cubes;
  const readCubes = (): Cube[] => (cubes.peek() ?? []) as Cube[];

  const start = dominantMidpoint(readCubes());
  const pad = midpointPad(start.mx, start.mz);
  const editor = profileEditor("x − x₀ →");
  const fill = cell(1);
  // True while the user drags the fill slider — the curve has its own
  // `dragging`, but the slider doesn't, so we track it here to gate the refit.
  const fillActive = cell(false);

  const interacting = (): boolean =>
    editor.dragging.peek() || fillActive.peek();

  const disposers: Array<() => void> = [];

  // Forward direction: rebuild the slice from the curve + fill + centre. Reads
  // everything untracked (peek) and only writes when the cube set actually
  // changes, so it never loops against the store's change echo.
  const commit = (): void => {
    const next = generateFilledSlice(
      readCubes(),
      pad.mx.peek(),
      pad.mz.peek(),
      editor.heights(),
      fill.peek(),
    );
    if (!cubesEqual(next, readCubes())) cubes.value = next;
  };

  // Backward direction: fit the curve + fill to the world. Depends on `cubes`
  // *and* the centre (mx/mz), so editing the world — placing/removing blocks in
  // Mergecraft, or moving the centre — re-reads both the outline *and* the
  // density live. Generation is an exact fixed point for fill, so this can run
  // on every change without drifting or fighting the slider. The `interacting`
  // guard just keeps it from refitting mid-drag.
  disposers.push(
    effect(() => {
      const cur = (cubes.value ?? []) as Cube[];
      const mx = pad.mx.value;
      const mz = pad.mz.value;
      if (interacting()) return;
      const fit = fitSlice(cur, mx, mz);
      editor.setFromHeights(fit.silhouette);
      if (fit.any) fill.value = fit.fill;
    }),
  );

  // Forward trigger: while a control handle is dragged, push curve edits into
  // the doc. `editor.heights()` subscribes to the control points; the `dragging`
  // guard keeps the initial mount and programmatic refits from writing.
  disposers.push(
    effect(() => {
      editor.heights();
      if (editor.dragging.value) commit();
    }),
  );

  const swallow = (e: Event): void => e.stopPropagation();

  const disposeUI = mount(
    () => (
      <div
        style="font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:inherit;display:flex;flex-direction:column;gap:16px;box-sizing:border-box;padding:16px;"
        onPointerdown={swallow}
        onClick={swallow}
        onDblclick={swallow}
        onContextmenu={swallow}
        onWheel={swallow}
      >
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
          <div style="font-weight:600;font-size:15px;">Block Distribution</div>
          <div style="font-variant-numeric:tabular-nums;opacity:0.7;font-size:12px;">
            {() => `centre (${pad.mx.value}, ${pad.mz.value})`}
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:11px;opacity:0.6;">
            Drag the dot to place the hill's centre on the X/Z ground plane.
          </div>
          <div style="display:flex;justify-content:center;">
            <div style="width:220px;max-width:100%;">{pad.svg}</div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="font-size:11px;opacity:0.6;">
            Drag the blue dots to shape the height outline.
          </div>
          {editor.svg}
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;">
            <div style="opacity:0.6;">Fill (blocks under the curve)</div>
            <div style="font-variant-numeric:tabular-nums;font-weight:600;">
              {() => `${Math.round(fill.value * 100)}%`}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            style="width:100%;accent-color:#2563eb;cursor:pointer;"
            value={() => String(Math.round(fill.value * 100))}
            onPointerdown={() => (fillActive.value = true)}
            onPointerup={() => (fillActive.value = false)}
            onChange={() => (fillActive.value = false)}
            onInput={(e: Event) => {
              fill.value = (e.target as HTMLInputElement).valueAsNumber / 100;
              commit();
            }}
          />
        </div>
      </div>
    ),
    root,
  );

  return () => {
    disposeUI();
    for (const d of disposers.splice(0)) {
      try {
        d();
      } catch {
        /* ignore */
      }
    }
    editor.dispose();
    pad.dispose();
    bridge.dispose();
    removeRoot();
  };
}

// `ToolRender` hands us a `DocHandle<unknown>` (the plugin boundary is
// untyped); narrow once, here, to our doc shape — the whole tool is `Doc`-typed
// from this point on.
export const DistributionTool: ToolRender = (handle, element) => {
  const host = document.createElement("div");
  host.style.cssText = "height:100%;overflow:auto;box-sizing:border-box;color:inherit;";
  element.appendChild(host);

  let session: (() => void) | null = null;
  let boundUrl: string | undefined;

  const bindTo = (h: DocHandle<Doc>): void => {
    boundUrl = h.url;
    session?.();
    session = startSession(h, host);
  };

  bindTo(handle as DocHandle<Doc>);

  // Follow the user's focus: the host's SelectedDocProvider answers
  // `patchwork:selected-view` with the primary view, so a sidebar instance
  // tracks whichever Mergecraft doc is in front instead of being pinned to the
  // handle it happened to mount with. No-ops silently if nothing answers.
  const repo = element.repo;
  const unsubscribe = subscribe<SelectedView>(
    element,
    { type: "patchwork:selected-view" },
    (view) => {
      const url = view?.url as AutomergeUrl | undefined;
      if (!url || url === boundUrl || !repo) return;
      repo
        .find<Doc>(url)
        .then(bindTo)
        .catch((e) => console.error("[block-distribution] find failed:", e));
    },
  );

  return () => {
    unsubscribe();
    session?.();
    session = null;
    host.remove();
  };
};
