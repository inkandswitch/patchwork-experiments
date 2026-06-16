import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { hitTestShape } from "./geometry";
import type { DocWithLayers, ShapeLayerDoc } from "./types";

// A surface layer resolved to a live handle, tagged with the key it sits under
// in the surface's `layers` map (e.g. "rect-shape-layer").
export type ResolvedLayer = {
  key: string;
  url: AutomergeUrl;
  handle: DocHandle<ShapeLayerDoc>;
};

export type LayerIndex = {
  // The surface's currently-resolved layers. Synchronous so pointer handlers
  // (hit-testing, drag begin) can read it without awaiting.
  layers: () => ResolvedLayer[];
  dispose: () => void;
};

// Keeps a surface's shape layers resolved in memory so pointer hit-testing can
// run synchronously. Mirrors createPositionRegistry: imperative, disposable, no
// reactive arguments. Watches the surface doc for layers added later (the first
// rectangle mints the rect layer, etc.) and resolves each handle once.
export function createLayerIndex(
  repo: Repo,
  handle: DocHandle<DocWithLayers>,
): LayerIndex {
  const resolved = new Map<AutomergeUrl, ResolvedLayer>();
  const pending = new Set<AutomergeUrl>();

  const sync = () => {
    const layers = handle.doc()?.layers ?? {};

    for (const [key, url] of Object.entries(layers)) {
      const entry = resolved.get(url);
      if (entry) {
        entry.key = key;
        continue;
      }
      if (pending.has(url)) continue;
      pending.add(url);
      void repo
        .find<ShapeLayerDoc>(url)
        .then((resolvedHandle) => {
          pending.delete(url);
          resolved.set(url, { key, url, handle: resolvedHandle });
        })
        .catch(() => pending.delete(url));
    }

    // Drop layers the surface no longer references.
    const present = new Set(Object.values(layers));
    for (const url of resolved.keys()) {
      if (!present.has(url)) resolved.delete(url);
    }
  };

  sync();
  handle.on("change", sync);

  return {
    layers: () => Array.from(resolved.values()),
    dispose: () => handle.off("change", sync),
  };
}

// The topmost shape (highest z across all of the surface's layers) whose
// outline contains (x, y), as its automerge url, or undefined when the point
// hits nothing. Pure and synchronous over the already-resolved layer handles.
export function topmostShapeAt(
  layers: ResolvedLayer[],
  x: number,
  y: number,
): AutomergeUrl | undefined {
  let bestUrl: AutomergeUrl | undefined;
  let bestZ: number | undefined;
  for (const { handle } of layers) {
    for (const shape of Object.values(handle.doc()?.shapes ?? {})) {
      if (!hitTestShape(x, y, shape)) continue;
      const z = shape.z ?? 0;
      if (bestZ === undefined || z >= bestZ) {
        bestUrl = handle.sub("shapes", shape.id).url;
        bestZ = z;
      }
    }
  }
  return bestUrl;
}
