// Layouts — a folder rendered through a lens. Each layout is a `sketchy:layout`
// plugin pointing at the `patchwork:tool` that renders it; switching layout re-opens
// the SAME folder through a different tool (the docs are shared; only the lens +
// its complement differ — see LAYOUTS.md).
import { getRegistry } from "@inkandswitch/patchwork-plugins";

// registered layout descriptors (defensive: no host registry ⇒ [])
export function listLayouts() {
  try {
    const r = getRegistry("sketchy:layout");
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// layouts that can render a given datatype
export function layoutsFor(type) {
  return listLayouts().filter(
    (l) => !l.supportedDatatypes || l.supportedDatatypes.includes("*") || l.supportedDatatypes.includes(type)
  );
}

// What a NON-canvas lens is dropping: the canvas's positional complement. Pure, so a
// list/grid/dock layout can honestly surface "here's what you're not seeing".
export function complementSummary(folderDoc, complementDoc) {
  const items = (complementDoc && complementDoc.items) || [];
  const positioned = new Set(
    items.filter((i) => i && (i.kind === "doc" || i.kind === "frame") && i.url).map((i) => i.url)
  );
  return {
    has: items.length > 0,
    itemCount: items.length,
    positioned, // Set of urls that have a canvas position
    positionedCount: positioned.size,
  };
}

// one-line banner text for a complement summary (used by list/grid layouts)
export function complementBanner(summary) {
  if (!summary || !summary.has) return "";
  return `↳ also a canvas layout (the complement, unused here): ${summary.positionedCount} positioned doc(s), ${summary.itemCount} items incl. ink/shapes/editors — not shown here`;
}
