import type { DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocHandle, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import type { PartsBinDoc, PartsBinItem } from "./types";
import "./parts-bin.css";

// A palette of example documents. Each row previews a live document; dragging
// the row out (anywhere on the card) writes the standard Patchwork drag payload
// (see the drag-and-drop recipe) so the canvas can drop it as an embed. The
// payload points at a clone, so the example stays editable in place.
export const PartsBinTool: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PartsBin handle={handle as DocHandle<PartsBinDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function PartsBin(props: { handle: DocHandle<PartsBinDoc> }) {
  const repo = useRepo();
  const [doc] = useDocument<PartsBinDoc>(() => props.handle.url);
  const items = () => doc()?.items ?? [];

  return (
    <div class="embark-parts-bin">
      <div class="embark-parts-bin__header">{doc()?.title ?? "Parts bin"}</div>
      <div class="embark-parts-bin__list">
        <For each={items()}>
          {(item) => <PartsBinRow repo={repo} item={item} />}
        </For>
      </div>
    </div>
  );
}

function PartsBinRow(props: { repo: Repo; item: PartsBinItem }) {
  // Resolve the source handle up front (waits for ready) so dragstart — which
  // must write its payload synchronously — always has a loaded doc to clone
  // instead of falling back to sharing the original.
  const source = useDocHandle<unknown>(() => props.item.url);

  const onDragStart = (event: DragEvent) => {
    const handle = source();
    if (!event.dataTransfer || !handle) return;
    event.dataTransfer.effectAllowed = "copy";
    // Drop an independent copy so the example in the bin stays pristine.
    const url = props.repo.clone(handle).url;
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "parts-bin", items: [{ url }] }),
    );
    event.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));
  };

  return (
    <div
      class="embark-parts-bin__item"
      draggable={true}
      title="Drag onto the canvas to copy"
      on:dragstart={onDragStart}
    >
      <div class="embark-parts-bin__grip">
        <GripIcon />
      </div>
      <div class="embark-parts-bin__preview">
        <patchwork-view
          doc-url={props.item.url}
          tool-id={props.item.toolId}
          hide-controls=""
        />
      </div>
    </div>
  );
}

// Six-dot grip glyph for the drag affordance; inherits the grip's text color.
function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="9" r="1.2" />
      <circle cx="12" cy="9" r="1.2" />
      <circle cx="19" cy="9" r="1.2" />
      <circle cx="5" cy="15" r="1.2" />
      <circle cx="12" cy="15" r="1.2" />
      <circle cx="19" cy="15" r="1.2" />
    </svg>
  );
}
