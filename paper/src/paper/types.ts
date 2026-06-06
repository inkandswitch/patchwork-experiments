import type { AutomergeUrl } from "@automerge/automerge-repo";

// A paper doc maps each surface tool id ("rect" | "line") to the layer
// document that tool draws into. The map shape lets the surface provider
// look a layer up (and create it on demand) by tool id.
export type PaperDoc = {
  "@patchwork": { type: "paper" };
  title: string;
  layers: { [toolId: string]: AutomergeUrl };
};

// A layer document holds many shapes; the layer's tool interprets them.
export type PaperLayerDoc = {
  "@patchwork": { type: "paper-layer" };
  title: string;
  shapes: Shape[];
};

// Shared base shape. Each layer tool stuffs its own fields on top of this.
// `outline` holds the geometry used for both rendering and selection hit
// detection. `width`/`height` are legacy fields kept only so shapes persisted
// before `outline` existed still render and hit-test (see `resolveOutline`).
export type Shape = {
  x: number;
  y: number;
  z: number;
  outline?: Outline;
  width?: number;
  height?: number;
};

// An outline is the single source of truth for a shape's hit geometry, and
// each layer tool renders directly from it. Tools may extend a variant with
// their own drawing properties, but must not duplicate the geometry the
// variant already carries.
export type Outline =
  | { type: "rectangle"; width: number; height: number }
  | { type: "line"; points: Point[] }
  | { type: "polygon"; points: Point[] };

// A point in a shape's local coordinate space, i.e. relative to the shape's
// `x`/`y` origin. Storing outline geometry relative to the origin means a
// shape can be moved by changing only `x`/`y`.
export type Point = { x: number; y: number };
