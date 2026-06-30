// Board snapshot — what's visibly under a region of the canvas. Used by the LLM magnifying
// glass: collect the items intersecting a bounds, then summarise them as a compact phrase
// the LLM can narrate ("2 documents, a red arrow, 3 ink strokes"). Pure + testable; the
// glass mount feeds it the live items + its own bounds and sends the summary to the LLM.

// axis-aligned bounds intersection (touching counts)
export function boundsIntersect(a, b) {
  return !!(a && b) && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// items whose bounds intersect `region` (excluding `exceptId` — usually the glass itself)
export function itemsUnder(items, region, boundsOf, exceptId) {
  if (!region) return [];
  return (items || []).filter((it) => it && it.id !== exceptId && boundsIntersect(boundsOf(it), region));
}

const article = (s) => (/^[aeiou]/i.test(s) ? "an " : "a ");

// a short NOUN phrase for one item (no count/article — describeItems adds those)
export function nounForItem(it) {
  if (!it) return "thing";
  if (it.kind === "stroke") return "ink stroke";
  if (it.kind === "shape") return it.type || "shape";
  if (it.kind === "text") { const t = (it.text || "").trim(); return t ? `text “${t.slice(0, 40)}”` : "empty text box"; }
  if (it.kind === "frame") return it.title ? `box “${it.title}”` : "box";
  if (it.kind === "doc") return it.name ? `document “${it.name}”` : "document";
  if (it.kind === "editor") return `${it.editorId || "node"} node`;
  return it.kind || "thing";
}

// a compact, human/LLM-readable description of a set of items (grouped + counted, in
// first-seen order): "2 documents, a red arrow, 3 ink strokes" — or "nothing".
export function describeItems(items) {
  if (!items || !items.length) return "nothing";
  const counts = new Map(), order = [];
  for (const it of items) { const n = nounForItem(it); if (!counts.has(n)) order.push(n); counts.set(n, (counts.get(n) || 0) + 1); }
  return order.map((n) => { const c = counts.get(n); return c > 1 ? `${c} ${n}s` : `${article(n)}${n}`; }).join(", ");
}
