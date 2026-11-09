// The "terrain.credit" scene extension: a line at the foot of the view
// crediting the open data a terrain is made from (OpenStreetMap's ODbL asks
// that whoever sees a work made from it be told), for every shown object
// with the "terrain.credit" trait, in every activity. The text is the
// terrain GLB's own (extras.terrain.credit, its full attribution as the
// tooltip), so it is whatever the data's sources say.

import css from "./credit.css?inline";

const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";

/** The credits to show, one per distinct text: [{ text, title }]. Pure but for its lookup. */
export function credits(scene, extrasOf) {
  const out = new Map();
  for (const id of scene.ids ?? Object.keys(scene.objects ?? {})) {
    const o = scene.objects?.[id];
    if (!o?.traits?.["terrain.credit"] || o.visible === false) continue;
    const t = extrasOf(id)?.terrain;
    const text = typeof t?.credit === "string" && t.credit ? t.credit : typeof t?.attribution === "string" ? t.attribution : "";
    if (text && !out.has(text)) out.set(text, { text: text.slice(0, 300), title: String(t.attribution ?? "").slice(0, 2000) });
  }
  return [...out.values()];
}

export default {
  create(api) {
    api.style(css);
    const box = document.createElement("div");
    box.className = "terrain-credit";
    box.hidden = true;
    api.overlay().append(box);
    let key = null;
    function render(scene) {
      const list = credits(scene, (id) => api.content(id)?.extras ?? null);
      const next = JSON.stringify(list);
      if (next === key) return;
      key = next;
      box.replaceChildren(
        ...list.map(({ text, title }) => {
          const line = document.createElement("div");
          line.title = title;
          // the OSM notice links to its copyright page
          const at = text.indexOf("© OpenStreetMap contributors");
          if (at < 0) line.textContent = text;
          else {
            const a = document.createElement("a");
            a.href = OSM_COPYRIGHT;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = "© OpenStreetMap contributors";
            line.append(text.slice(0, at), a, text.slice(at + a.textContent.length));
          }
          return line;
        }),
      );
      box.hidden = !list.length;
    }
    return {
      update(scene) {
        render(scene);
      },
      dispose() {
        box.remove();
      },
    };
  },
};
