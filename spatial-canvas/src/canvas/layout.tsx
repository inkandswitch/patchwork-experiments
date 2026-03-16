import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer, FloatingPanel, Bar } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { For, Show, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";

export default function CanvasLayout(
  handle: DocHandle<CanvasDoc>,
  element: PatchworkViewElement,
): Disposer {
  return render(() => <CanvasLayoutUI handle={handle} />, element);
}

type Props = {
  handle: DocHandle<CanvasDoc>;
};

function CanvasLayoutUI(props: Props) {
  const doc = makeDocumentProjection(props.handle);
  const contactUrl = (window as any).accountDocHandle?.doc()?.contactUrl ?? "local";

  const activeTool = () =>
    doc.stateByUser?.[contactUrl]?.selectedTool ?? "spatial-canvas-tool-select";

  let container!: HTMLDivElement;
  let canvasViewEl!: HTMLElement;
  let activePointerId: number | null = null;

  const panelEntries = () =>
    Object.entries(doc.layout ?? {}).filter(([, e]) => e.kind === "panel") as [
      string,
      FloatingPanel,
    ][];

  const barEntries = () =>
    Object.entries(doc.layout ?? {}).filter(([, e]) => e.kind === "bar") as [string, Bar][];

  const leftBars = () => barEntries().filter(([, b]) => b.side === "left");
  const rightBars = () => barEntries().filter(([, b]) => b.side === "right");
  const topBars = () => barEntries().filter(([, b]) => b.side === "top");
  const bottomBars = () => barEntries().filter(([, b]) => b.side === "bottom");

  const sides = () => {
    const seen = new Set<"top" | "bottom" | "left" | "right">();
    for (const [, e] of panelEntries()) seen.add(e.position[0]);
    return [...seen];
  };

  const alignGroups = (side: string) => {
    const seen = new Set<"start" | "center" | "end">();
    for (const [, e] of panelEntries()) {
      if (e.position[0] === side) seen.add(toAlignClass(e.position[1]));
    }
    return [...seen];
  };

  const panelsAt = (side: string, align: string) =>
    panelEntries().filter(([, e]) => e.position[0] === side && toAlignClass(e.position[1]) === align);

  // ---------------------------------------------------------------------------
  // Pointer relay
  // ---------------------------------------------------------------------------

  onMount(() => {
    const relayPointerEvent = (type: string, e: PointerEvent) => {
      const makeClone = () =>
        new PointerEvent(type, {
          bubbles: true,
          cancelable: e.cancelable,
          clientX: e.clientX,
          clientY: e.clientY,
          movementX: e.movementX,
          movementY: e.movementY,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          pressure: e.pressure,
          button: e.button,
          buttons: e.buttons,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
        });

      const activeBtn = container.querySelector<HTMLElement>(
        `patchwork-view[tool-id="${activeTool()}"]`,
      );
      if (activeBtn) activeBtn.dispatchEvent(makeClone());

      for (const panel of orderedPanels(container)) {
        const clone = makeClone();
        let stopped = false;
        const origStop = clone.stopPropagation.bind(clone);
        clone.stopPropagation = () => {
          stopped = true;
          origStop();
        };
        const origStopImmediate = clone.stopImmediatePropagation.bind(clone);
        clone.stopImmediatePropagation = () => {
          stopped = true;
          origStopImmediate();
        };
        panel.dispatchEvent(clone);
        if (stopped) break;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element).closest(".sc-panel, .sc-bar")) return;
      activePointerId = e.pointerId;
      relayPointerEvent("pointerdown", e);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (activePointerId !== null) relayPointerEvent("pointermove", e);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      relayPointerEvent("pointerup", e);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      relayPointerEvent("pointercancel", e);
    };

    canvasViewEl.addEventListener("pointerdown", onPointerDown);
    canvasViewEl.addEventListener("pointermove", onPointerMove);
    canvasViewEl.addEventListener("pointerup", onPointerUp);
    canvasViewEl.addEventListener("pointercancel", onPointerCancel);

    onCleanup(() => {
      canvasViewEl.removeEventListener("pointerdown", onPointerDown);
      canvasViewEl.removeEventListener("pointermove", onPointerMove);
      canvasViewEl.removeEventListener("pointerup", onPointerUp);
      canvasViewEl.removeEventListener("pointercancel", onPointerCancel);
    });
  });

  return (
    <div class="sc-container" ref={container}>
      <For each={leftBars()}>
        {([id]) => (
          <patchwork-view
            doc-url={props.handle.url}
            tool-id={id}
            class="sc-bar sc-bar--left"
          />
        )}
      </For>
      <div class="sc-column-wrapper">
        <For each={topBars()}>
          {([id]) => (
            <patchwork-view
              doc-url={props.handle.url}
              tool-id={id}
              class="sc-bar sc-bar--top"
            />
          )}
        </For>
        <div class="sc-canvas-wrapper">
          <patchwork-view
            doc-url={props.handle.url}
            tool-id="spatial-canvas-view"
            class="sc-canvas-view"
            ref={canvasViewEl}
          />
          <Show when={panelEntries().length > 0}>
            <div class="sc-panel-overlay">
              <For each={sides()}>
                {(side) => (
                  <div class={`sc-side sc-side--${side}`}>
                    <For each={alignGroups(side)}>
                      {(align) => (
                        <div class={`sc-side-group sc-side-group--${align}`}>
                          <For each={panelsAt(side, align)}>
                            {([id]) => (
                              <patchwork-view
                                doc-url={props.handle.url}
                                tool-id={id}
                                class="sc-panel"
                              />
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
        <For each={bottomBars()}>
          {([id]) => (
            <patchwork-view
              doc-url={props.handle.url}
              tool-id={id}
              class="sc-bar sc-bar--bottom"
            />
          )}
        </For>
      </div>
      <For each={rightBars()}>
        {([id]) => (
          <patchwork-view
            doc-url={props.handle.url}
            tool-id={id}
            class="sc-bar sc-bar--right"
          />
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAlignClass(align: string): "start" | "center" | "end" {
  if (align === "right" || align === "bottom") return "end";
  if (align === "center") return "center";
  return "start";
}

function orderedPanels(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".sc-panel, .sc-bar"));
}
