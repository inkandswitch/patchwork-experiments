// A viewer's kits (STAGE.md, "Kits"): what the doc suggests and what this
// viewer turned on and off. Pure, and shared by the stage (which runs them)
// and any kit surface (which shows them).

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** The kits the doc suggests: its own list, else the default. */
export const suggestedKits = (doc, fallback = ["model"]) => (Array.isArray(doc?.view?.kits) ? list(doc.view.kits) : fallback);

/**
 * This viewer's kits: the doc's suggestion, plus what they turned on, minus
 * what they turned off (so a later change to the suggestion still reaches them).
 * @param {{ on?: string[], off?: string[] } | null} mine
 */
export function chosenKits(mine, doc, fallback) {
  const off = new Set(list(mine?.off));
  const out = [];
  for (const k of [...suggestedKits(doc, fallback), ...list(mine?.on)]) if (!off.has(k) && !out.includes(k)) out.push(k);
  return out;
}
