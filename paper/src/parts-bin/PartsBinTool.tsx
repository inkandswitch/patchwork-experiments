import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For } from "solid-js";
import { render } from "solid-js/web";
import {
  RepoContext,
  useDocHandle,
  useDocument,
  useRepo,
} from "../vendor/automerge-solid-primitives";
import "@inkandswitch/patchwork-elements";
import type { PartsBinDoc, PartsBinItem } from "./types";
import "./parts-bin.css";

// A palette of example documents. Each row previews a live document; dragging
// the row out (anywhere on the card) writes the standard Patchwork drag payload
// (see drag-and-drop recipe) so any surface can drop it as an embed. The
// payload points at a deep clone, so the example stays editable in place.
export const PartsBinTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PartsBin handle={handle as DocHandle<PartsBinDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function PartsBin(props: { handle: DocHandle<PartsBinDoc> }) {
  const repo = useRepo();
  const [doc] = useDocument<PartsBinDoc>(() => props.handle.url);
  const items = () => doc()?.items ?? [];

  return (
    <div class="parts-bin">
      <div class="parts-bin-header">{doc()?.title ?? "Parts bin"}</div>
      <div class="parts-bin-list">
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
    const url = deepClone(props.repo, handle, new Map());
    event.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "parts-bin", items: [{ url }] }),
    );
    event.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));
  };

  return (
    <div
      class="parts-bin-item"
      draggable={true}
      title="Drag onto the canvas to copy"
      on:dragstart={onDragStart}
    >
      <div class="parts-bin-grip" />
      <div class="parts-bin-preview">
        <patchwork-view
          doc-url={props.item.url}
          tool-id={props.item.toolId}
          hide-controls=""
        />
      </div>
    </div>
  );
}

// A surface-aware document tree. The recursion follows the conventions surfaces
// use to reference other documents so a clone is fully independent.
type DocLike = {
  layers?: Record<string, AutomergeUrl>;
  shapes?: Record<string, { docUrl?: AutomergeUrl }>;
};

// Clone `handle`'s document deeply: a plain `repo.clone` copies the doc but
// leaves it pointing at the same layer / embedded documents, so editing the
// copy would still mutate the original's shapes. Here we also clone every
// referenced layer (a surface's `layers`) and embedded doc (a shape's
// `docUrl`) and relink them. `seen` dedupes shared/cyclic references. Nested
// docs are read through the repo's synchronous ready-handle cache (they have
// already been loaded to render the preview); any that aren't ready are left
// shared rather than blocking the drag.
function deepClone(
  repo: Repo,
  handle: DocHandle<unknown>,
  seen: Map<AutomergeUrl, AutomergeUrl>,
): AutomergeUrl {
  const already = seen.get(handle.url);
  if (already) return already;

  const clone = repo.clone(handle) as DocHandle<DocLike>;
  seen.set(handle.url, clone.url);
  const doc = clone.doc();

  const layerRemap = new Map<string, AutomergeUrl>();
  for (const [key, url] of Object.entries(doc?.layers ?? {})) {
    const child = readyHandle(repo, url);
    if (child) layerRemap.set(key, deepClone(repo, child, seen));
  }

  const embedRemap = new Map<string, AutomergeUrl>();
  for (const [id, shape] of Object.entries(doc?.shapes ?? {})) {
    const childUrl = shape?.docUrl;
    if (!childUrl) continue;
    const child = readyHandle(repo, childUrl);
    if (child) embedRemap.set(id, deepClone(repo, child, seen));
  }

  if (layerRemap.size > 0 || embedRemap.size > 0) {
    clone.change((next) => {
      for (const [key, url] of layerRemap) {
        if (next.layers) next.layers[key] = url;
      }
      for (const [id, url] of embedRemap) {
        const shape = next.shapes?.[id];
        if (shape) shape.docUrl = url;
      }
    });
  }

  return clone.url;
}

// The repo's already-loaded handle for `url`, or null when it isn't ready yet.
function readyHandle(repo: Repo, url: AutomergeUrl): DocHandle<unknown> | null {
  const progress = repo.findWithProgress<unknown>(url).peek();
  return progress.state === "ready" ? progress.handle : null;
}
