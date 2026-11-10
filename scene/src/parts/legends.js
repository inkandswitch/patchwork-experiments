// scene.legends: a colour-bar card in the port's bottom-left corner for each
// shown object whose GLB says how it was coloured (extras.legend; legend.js),
// tinted when the object's colour override tints it. Names are what this viewer sees (api.nameOf).

import css from "./legends.css?inline";
import { legendModel } from "../legend.js";
import { inheritedDisplay, isGroup, outlineParents } from "../groups.js";

/** A provider's legend, checked; null when it isn't usable. Pure. */
export function sanitizeLegend(l) {
  if (!l || typeof l !== "object") return null;
  const min = Number(l.min);
  const max = Number(l.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) return null;
  const stops = Array.isArray(l.stops) ? l.stops.filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) : [];
  if (stops.length < 2) return null;
  const str = (v) => (typeof v === "string" ? v.slice(0, 60) : "");
  return { title: str(l.title), unit: str(l.unit), min, max, stops: stops.slice(0, 32) };
}

/** Is this object drawn, by its own flag and every group above it? */
function shownIds(scene) {
  const inherited = inheritedDisplay(scene.objects, outlineParents(scene.objects, scene.parents, scene.groups));
  return scene.ids.filter((id) => {
    const o = scene.objects[id];
    return o && !isGroup(o) && o.visible !== false && (inherited.get(id)?.visible ?? true);
  });
}

/**
 * The cards to show, in scene order: [{ id, model, color }]. Pure but for
 * its two lookups.
 * @param {(id: string) => object | null} legendOf  the raw extras.legend
 * @param {(id: string) => string | null} nameOf
 */
export function legendCards(scene, legendOf, nameOf) {
  const out = [];
  for (const id of shownIds(scene)) {
    const legend = sanitizeLegend(legendOf(id));
    if (!legend) continue;
    const o = scene.objects[id];
    out.push({ id, color: o.color ?? null, model: legendModel(legend, nameOf(id) ?? o.name ?? "", o.color ?? null) });
  }
  return out;
}

function el(tag, cls, ...kids) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

export default {
  create(api) {
    api.style(css);
    const box = document.createElement("div");
    box.className = "legends";
    api.overlay().append(box);
    let key = "";

    function render(scene) {
      const cards = legendCards(scene, (id) => api.content(id)?.extras?.legend ?? null, (id) => api.nameOf(id));
      const next = cards.map(({ id, model: m }) => `${id}|${m.label}|${m.gradient}|${m.tinted}|${m.ticks.map((t) => t.text).join(",")}`).join("\n");
      if (next === key) return;
      key = next;
      box.replaceChildren(
        ...cards.map(({ id, color, model: m }) => {
          const tint = m.tinted ? el("span", "legend-tint", " · tinted") : null;
          if (tint) tint.title = `Tinted by this object's colour (${color}); set Colour to Auto for the true colours`;
          const bar = el("div", "legend-bar");
          bar.style.background = m.gradient;
          const card = el("div", "legend", el("div", "legend-label", m.label, tint), bar, el("div", "legend-ticks", ...m.ticks.map((t) => el("span", null, t.text))));
          card.dataset.objectId = id;
          if (m.tinted) card.dataset.tinted = "";
          return card;
        }),
      );
    }

    return {
      update(scene, local, prev) {
        // a doc change, content arriving (same scene and local) or load status; not hover
        const was = prev.local;
        if (was && scene === prev.scene && local !== was && local.status === was.status) return;
        render(scene);
      },
    };
  },
};
