// Pure shape helpers: selection and spatial ordering. Kept free of bireactive
// so the logic is unit-testable; `tool.tsx` feeds these the store snapshot.

import type { RichTextDoc } from "./richtext";

/** A tldraw record, narrowed to the fields we read. The doc's `store` is a flat
 *  map of records (shapes, the page, the camera, …) keyed by id. */
export interface Shape {
  id: string;
  typeName: string;
  type: string;
  x?: number;
  y?: number;
  index?: string;
  props?: { richText?: RichTextDoc };
}

// text / geo / note carry body text in `props.richText`; `frame` is excluded —
// its text is a title, not content.
const TEXT_TYPES = new Set(["text", "geo", "note"]);

export const isTextShape = (r: Shape | undefined): r is Shape =>
  !!r && r.typeName === "shape" && TEXT_TYPES.has(r.type) && !!r.props && "richText" in r.props;

// Spatial reading order: top-to-bottom, then left-to-right, treating shapes
// within one row band as the same row. Unlike tldraw's z-order `index`, this
// tracks live as shapes move; `index` then `id` break exact ties.
const ROW = 24; // px
export const order = (a: Shape, b: Shape): number => {
  const ay = a.y ?? 0;
  const by = b.y ?? 0;
  if (Math.abs(ay - by) > ROW) return ay - by;
  return (
    (a.x ?? 0) - (b.x ?? 0) ||
    ay - by ||
    (a.index ?? "").localeCompare(b.index ?? "") ||
    a.id.localeCompare(b.id)
  );
};
