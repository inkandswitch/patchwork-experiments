// `sketchy:palette` — palettes as PLUGINS (documented in NODES.md):
//   { type: "sketchy:palette", id, name, icon?, entries: [entry…] | () => [entry…] }
// A registered palette appears in the parts bin's "palettes" group; dragging it
// out instantiates a palette window with those entries. `entries` may be a
// FUNCTION for drop-time censuses (the full palette lists every registered
// brush at the moment you drop it). Entry structure: model.js normalizeEntries.
import { entriesFromIds, normalizeEntries } from "../model.js";
import { SKETCH_PALETTE, fullPaletteBrushes } from "../palette-node.js";
import { listPalettes } from "../parts-bin.js";

export const palettePlugins = [
  // the two former hardcoded presets, now ordinary registrations of this type
  { type: "sketchy:palette", id: "full", name: "full palette", entries: () => entriesFromIds(fullPaletteBrushes()) },
  { type: "sketchy:palette", id: "sketch", name: "sketching palette", entries: entriesFromIds(SKETCH_PALETTE) },
];

// a registered palette id → its normalized entries (functions invoked at drop
// time). Falls back to the two built-ins when the registry isn't populated.
export function paletteEntriesById(id) {
  const reg = listPalettes().find((p) => p && p.id === id);
  const raw = reg && (typeof reg.entries === "function" ? reg.entries() : reg.entries);
  const entries = normalizeEntries(raw);
  if (entries.length) return entries;
  if (id === "sketch") return entriesFromIds(SKETCH_PALETTE);
  return entriesFromIds(fullPaletteBrushes()); // "full" and the unknown-id fallback
}
