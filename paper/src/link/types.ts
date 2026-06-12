import type { Point } from "../surface/types";

// One in-flight link activation, shared through the focus doc so the
// CodeMirror extension (which owns the link text) and the paper's arrow layer
// (which renders arrows and picks targets) can coordinate without sharing any
// DOM. At most one activation exists at a time.
export type ActiveLink = {
  // Minted fresh by the activating editor. Lets that editor recognize its own
  // activation when the focus doc changes (several editors can be open), and
  // lets a newer activation displace an older one cleanly.
  sourceId: string;
  // The link widget's location in screen coordinates, kept current by the
  // activating editor (it is the only party that can measure its own text).
  source: Point;
  // The link's target urls. Seeded from the link's current `{...}` body on
  // activation; the arrow layer appends the clicked shape's url, and the
  // editor mirrors the list back into the text.
  targets: string[];
};

// The slice of the shared focus document the link feature reads and writes.
export type LinkFocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
  activeLink?: ActiveLink;
};
