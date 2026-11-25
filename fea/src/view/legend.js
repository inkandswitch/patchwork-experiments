// A result's colour bar, as HTML: the study's own view and the scene's
// overlay both show it.

const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Number(v.toPrecision(3)).toString());

/**
 * Fill `el` (class "legend") with a legend and a note under it; hidden with neither.
 * @param {HTMLElement} el
 * @param {{ title: string, unit: string, min: number, max: number, stops: string[] } | null} legend
 * @param {string} [note]
 */
export function showLegend(el, legend, note = "") {
  el.hidden = !legend && !note;
  if (el.hidden) return;
  el.innerHTML = legend
    ? `<div class="legend-title"></div><div class="legend-bar"></div><div class="legend-ends"><span></span><span></span><span></span></div><div class="legend-note"></div>`
    : `<div class="legend-note"></div>`;
  if (legend) {
    el.querySelector(".legend-title").textContent = legend.title;
    el.querySelector(".legend-bar").style.background = `linear-gradient(to right, ${legend.stops.join(", ")})`;
    const [lo, mid, hi] = el.querySelectorAll(".legend-ends span");
    lo.textContent = fmt(legend.min);
    mid.textContent = fmt((legend.min + legend.max) / 2);
    hi.textContent = `${fmt(legend.max)} ${legend.unit}`;
  }
  el.querySelector(".legend-note").textContent = note;
}
