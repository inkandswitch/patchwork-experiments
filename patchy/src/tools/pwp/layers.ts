import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { createPatch, type PatchDoc } from "../../layers/index.js";

import type { PatchFolder, PatchLink } from "../../folder.js";
import { plain } from "../../util.js";
import { rasterize, syncEntries } from "./raster.js";
import { isStroke, type Shape } from "./shapes.js";

/**
 * A pwp layer is an ordinary patch on a patternwitch doc. Its entries are the
 * pixels; `pwp` is what they were drawn from, so pwp can edit them as shapes.
 * Anything else that reads patches just sees pixels.
 */
export type LayerDoc = PatchDoc & {
  title?: string;
  pwp: { shapes: Shape[] };
};

/** One of this document's pwp layers, as pwp lists them. */
export type Layer = {
  link: PatchLink;
  handle: DocHandle<LayerDoc>;
  shown: boolean;
};

export type Canvas = { width: number; height: number; palette: string[] };

export function isLayerDoc(doc: unknown): doc is LayerDoc {
  return (
    typeof doc === "object" &&
    doc !== null &&
    "pwp" in doc &&
    Array.isArray((doc as LayerDoc).pwp?.shapes)
  );
}

/** A new, empty layer over `target`, in front of everything in `folder`. */
export function addLayer(
  root: Repo,
  target: DocHandle<unknown>,
  folder: DocHandle<PatchFolder>,
  name: string
): DocHandle<LayerDoc> {
  const layer = createPatch(root, target) as DocHandle<LayerDoc>;
  layer.change((d) => {
    d.title = name;
    d.pwp = { shapes: [] };
  });
  folder.change((f) => {
    f.docs ??= [];
    f.docs.push({ name, type: "patch", url: layer.url });
  });
  return layer;
}

export function showLayer(folder: DocHandle<PatchFolder>, layer: Layer, shown: boolean) {
  folder.change((f) => {
    const link = f.docs.find((l) => l.url === layer.link.url);
    if (!link) return;
    if (shown) delete link.off;
    else link.off = true;
  });
}

/** Take a layer out of the folder. The patch doc itself is left alone. */
export function removeLayer(folder: DocHandle<PatchFolder>, layer: Layer) {
  folder.change((f) => {
    const i = f.docs.findIndex((l) => l.url === layer.link.url);
    if (i >= 0) f.docs.splice(i, 1);
  });
}

/**
 * Swap a layer with its neighbour in `layers` (back first): `by` 1 moves it
 * forward, -1 back. Only those two links trade places in the folder, so
 * whatever else is in it stays put.
 */
export function moveLayer(
  folder: DocHandle<PatchFolder>,
  layers: readonly Layer[],
  layer: Layer,
  by: 1 | -1
) {
  const at = layers.indexOf(layer);
  const other = layers[at + by];
  if (at < 0 || !other) return;
  folder.change((f) => {
    const i = f.docs.findIndex((l) => l.url === layer.link.url);
    const j = f.docs.findIndex((l) => l.url === other.link.url);
    if (i < 0 || j < 0) return;
    const a = plain(f.docs[i]) as PatchLink;
    const b = plain(f.docs[j]) as PatchLink;
    f.docs[i] = b;
    f.docs[j] = a;
  });
}

export function rename(layer: Layer, folder: DocHandle<PatchFolder>, name: string) {
  layer.handle.change((d) => {
    d.title = name;
  });
  folder.change((f) => {
    const link = f.docs.find((l) => l.url === layer.link.url);
    if (link) link.name = name;
  });
}

// Shapes are written field by field, so a move is a couple of numbers in the
// patch doc's history and a picture's bytes are never written twice.
function writeFields(into: Record<string, unknown>, from: Shape) {
  for (const [k, v] of Object.entries(from)) {
    if (k === "id" || k === "bytes") continue;
    const now = into[k];
    if (Array.isArray(v)) {
      if (!Array.isArray(now) || now.length !== v.length || v.some((x, i) => now[i] !== x)) {
        into[k] = [...v];
      }
    } else if (now !== v) {
      into[k] = v;
    }
  }
}

function copy(s: Shape): Shape {
  if (s.kind === "picture") return { ...s, bytes: new Uint8Array(s.bytes) };
  if (isStroke(s)) return { ...s, points: [...s.points] };
  return { ...s };
}

/** Put `shape` in the layer: in place if it's there, in front if not. */
export function putShape(layer: DocHandle<LayerDoc>, shape: Shape) {
  layer.change((d) => {
    d.pwp ??= { shapes: [] };
    const existing = d.pwp.shapes.find((s) => s.id === shape.id);
    if (existing) writeFields(existing as unknown as Record<string, unknown>, shape);
    else d.pwp.shapes.push(copy(shape));
  });
}

export function deleteShape(layer: DocHandle<LayerDoc>, id: string) {
  layer.change((d) => {
    const i = d.pwp?.shapes.findIndex((s) => s.id === id) ?? -1;
    if (i >= 0) d.pwp.shapes.splice(i, 1);
  });
}

/** Move a shape one step forward (1) or back (-1) within its layer. */
export function restack(layer: DocHandle<LayerDoc>, id: string, by: 1 | -1) {
  layer.change((d) => {
    const shapes = d.pwp?.shapes;
    if (!shapes) return;
    const i = shapes.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= shapes.length) return;
    const a = copy(shapes[i]);
    const b = copy(shapes[j]);
    shapes[i] = b;
    shapes[j] = a;
  });
}

/**
 * Redraw a layer's pixels from its shapes, against the canvas as it is now,
 * and refresh the heads it's against if they moved.
 */
export async function redraw(
  layer: DocHandle<LayerDoc>,
  target: DocHandle<unknown>,
  canvas: Canvas
) {
  const shapes = layer.doc()?.pwp?.shapes ?? [];
  const grid = await rasterize(shapes, canvas.width, canvas.height, canvas.palette);
  layer.change((d) => {
    if (syncEntries(d.patches, grid)) d.at = target.heads();
  });
}

/**
 * `redraw`, but only one at a time per layer: asking again while one runs
 * redraws once more when it's done, with whatever the layer says then.
 */
export function redrawer(
  target: () => DocHandle<unknown> | undefined,
  canvas: () => Canvas | undefined
) {
  const running = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const run = (layer: DocHandle<LayerDoc>) => {
    if (running.has(layer.url)) {
      again.add(layer.url);
      return;
    }
    const t = target();
    const c = canvas();
    if (!t || !c) return;
    const p = redraw(layer, t, c)
      .catch((err) => console.error(`[pwp] couldn't redraw ${layer.url}:`, err))
      .finally(() => {
        running.delete(layer.url);
        if (again.delete(layer.url)) run(layer);
      });
    running.set(layer.url, p);
  };
  return run;
}
