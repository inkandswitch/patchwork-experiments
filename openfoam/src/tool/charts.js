// Line charts on a canvas: one y axis (never two), a legend for two or more
// series plus a direct label at each line's end, a recessive grid, and a
// crosshair with a tooltip on hover. Colours are read from the tool's CSS
// tokens when drawn, so they follow the theme.

/**
 * A colour token, resolved to something a canvas can paint. Reading a custom
 * property gives its text, and ours are color-mix() expressions, which a
 * canvas's fillStyle refuses (and then silently keeps the last colour). An
 * element's computed `color` is evaluated, so the token is set on one and read back.
 */
export function cssColor(el, name, fallback) {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${name}, ${fallback})`;
  el.append(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return c || fallback;
}
const css = (el, name, fallback) => (name.includes("family") ? getComputedStyle(el).getPropertyValue(name).trim() || fallback : cssColor(el, name, fallback));

function niceTicks(lo, hi, n = 5) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => span / s <= n) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

const fmt = (v) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e4 || a < 1e-2) return v.toExponential(1);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

/**
 * @param {HTMLElement} host
 * @param {{ height?: number, yLog?: boolean, xLabel?: string, yLabel?: string, format?: (v:number)=>string }} opts
 * @returns {{ update(series: { name: string, color: string, points: number[][], dashed?: boolean }[], o?: { band?: [number, number] }): void, el: HTMLElement }}
 */
export function lineChart(host, { height = 180, yLog = false, xLabel = "", yLabel = "", format = fmt, skipStart = 0, markers = false } = {}) {
  const el = document.createElement("div");
  el.className = "chart";
  const legend = document.createElement("div");
  legend.className = "legend";
  const canvas = document.createElement("canvas");
  const tip = document.createElement("div");
  tip.className = "tip";
  el.append(legend, canvas, tip);
  host.append(el);
  let data = [];
  let hover = null;
  let geom = null;

  const draw = () => {
    const w = Math.max(200, el.clientWidth || 400);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, height);
    const ink = css(el, "--openfoam-fg", "black");
    const muted = css(el, "--openfoam-muted", "gray");
    const grid = css(el, "--openfoam-grid", "#ddd");
    const family = css(el, "--openfoam-family", "system-ui");
    const pts = data.flatMap((s) => s.points).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!yLog || p[1] > 0));
    if (!pts.length) {
      g.fillStyle = muted;
      g.font = `12px ${family}`;
      g.fillText("waiting for data…", 8, height / 2);
      geom = null;
      return;
    }
    let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    if (x1 === x0) x1 = x0 + 1;
    // the y range can leave out each series' start-up (a solver's first
    // iterations are often ten times what it settles to); lines are clipped
    const ranged = skipStart > 0 ? data.flatMap((s) => s.points.slice(Math.floor(s.points.length * skipStart))).filter((p) => Number.isFinite(p[1]) && (!yLog || p[1] > 0)) : pts;
    const ys = (ranged.length ? ranged : pts).map((p) => (yLog ? Math.log10(p[1]) : p[1]));
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (yLog) {
      y0 = Math.floor(y0);
      y1 = Math.ceil(y1);
    } else {
      const pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.1 || 1;
      y0 = Math.min(0, y0 - pad);
      y1 += pad;
    }
    if (y1 === y0) y1 = y0 + 1;
    g.font = `11px ${family}`;
    const labelW = 22 + Math.max(40, ...data.map((s) => g.measureText(s.name).width));
    const L = 46, R = labelW, T = 8, B = 26;
    const X = (x) => L + ((x - x0) / (x1 - x0)) * (w - L - R);
    const Y = (y) => T + (1 - ((yLog ? Math.log10(y) : y) - y0) / (y1 - y0)) * (height - T - B);
    geom = { X, x0, x1, L, R, w };
    // grid + axes (recessive)
    g.font = `11px ${family}`;
    g.lineWidth = 1;
    const yt = yLog ? Array.from({ length: y1 - y0 + 1 }, (_, i) => 10 ** (y0 + i)) : niceTicks(y0, y1, 4);
    for (const v of yt) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = grid;
      g.beginPath();
      g.moveTo(L, y);
      g.lineTo(w - R, y);
      g.stroke();
      g.fillStyle = muted;
      g.textAlign = "right";
      g.textBaseline = "middle";
      g.fillText(yLog ? `1e${Math.round(Math.log10(v))}` : format(v), L - 6, y);
    }
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const v of niceTicks(x0, x1, 6)) g.fillText(String(v), X(v), height - B + 6);
    if (xLabel) {
      g.textAlign = "right";
      g.fillText(xLabel, w - R, height - 12);
    }
    if (yLabel) {
      g.textAlign = "left";
      g.textBaseline = "top";
      g.fillText(yLabel, L + 4, T);
    }
    // the band (e.g. the averaging window)
    // lines
    const ends = [];
    g.save();
    g.beginPath();
    g.rect(L, T - 1, w - L - R, height - T - B + 2);
    g.clip();
    for (const s of data) {
      const p = s.points.filter((q) => Number.isFinite(q[1]) && (!yLog || q[1] > 0));
      if (!p.length) continue;
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.setLineDash(s.dashed ? [4, 3] : []);
      g.lineJoin = "round";
      g.beginPath();
      // thin a long series to about a point per pixel
      const stride = Math.max(1, Math.floor(p.length / (w - L - R)));
      p.forEach((q, i) => {
        if (i % stride && i !== p.length - 1) return;
        const x = X(q[0]), y = Y(q[1]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      g.setLineDash([]);
      if (markers || p.length <= 12)
        for (const q of p) {
          g.fillStyle = s.color;
          g.beginPath();
          g.arc(X(q[0]), Y(q[1]), 4, 0, Math.PI * 2);
          g.fill();
        }
      const last = p[p.length - 1];
      ends.push({ name: s.name, y: Math.min(height - B, Math.max(T, Y(last[1]))), color: s.color });
    }
    g.restore();
    // direct labels at the line ends, nudged apart
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    g.textAlign = "left";
    g.textBaseline = "middle";
    for (const e of ends) {
      g.fillStyle = e.color;
      g.fillRect(w - R + 4, e.y - 1, 8, 2);
      g.fillStyle = ink;
      g.fillText(e.name, w - R + 15, e.y);
    }
    // hover crosshair
    if (hover != null) {
      const x = X(hover);
      g.strokeStyle = muted;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, T);
      g.lineTo(Math.round(x) + 0.5, height - B);
      g.stroke();
      for (const s of data) {
        const q = nearest(s.points, hover);
        if (!q || !Number.isFinite(q[1]) || (yLog && q[1] <= 0)) continue;
        g.fillStyle = s.color;
        g.beginPath();
        g.arc(X(q[0]), Y(q[1]), 4, 0, Math.PI * 2);
        g.fill();
      }
    }
  };

  const nearest = (pts, x) => {
    let best = null, d = Infinity;
    for (const p of pts) {
      const e = Math.abs(p[0] - x);
      if (e < d) {
        d = e;
        best = p;
      }
    }
    return best;
  };

  canvas.addEventListener("pointermove", (ev) => {
    if (!geom) return;
    const r = canvas.getBoundingClientRect();
    const px = ev.clientX - r.left;
    if (px < geom.L || px > geom.w - geom.R) {
      hover = null;
      tip.removeAttribute("data-show");
      draw();
      return;
    }
    hover = geom.x0 + ((px - geom.L) / (geom.w - geom.L - geom.R)) * (geom.x1 - geom.x0);
    const rows = data
      .map((s) => ({ s, q: nearest(s.points, hover) }))
      .filter((r) => r.q)
      .map(({ s, q }) => `<div><i style="display:inline-block;width:10px;height:2px;background:${s.color};vertical-align:middle;margin-right:6px"></i>${s.name} <b>${format(q[1])}</b></div>`);
    const at = nearest(data[0]?.points ?? [], hover);
    tip.innerHTML = `<div>${xLabel || "x"} ${at ? at[0] : ""}</div>${rows.join("")}`;
    tip.setAttribute("data-show", "");
    const left = px + 12 + 180 > r.width ? px - 190 : px + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${24}px`;
    draw();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    tip.removeAttribute("data-show");
    draw();
  });
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  ro?.observe(el);
  // a canvas keeps the colours it was painted with: repaint when the theme changes
  const mo = typeof MutationObserver === "function" ? new MutationObserver(() => draw()) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style"] });

  return {
    el,
    update(series) {
      data = series;
      legend.innerHTML =
        series.length >= 2
          ? series.map((s) => `<span><i style="background:${s.color}${s.dashed ? ";height:0;border-top:2px dashed " + s.color : ""}"></i>${s.name}</span>`).join("")
          : "";
      draw();
    },
    dispose() {
      ro?.disconnect();
      mo?.disconnect();
      el.remove();
    },
  };
}

/** The tool's series colours, resolved now (canvas needs real colours). */
export function seriesColors(el) {
  return [1, 2, 3, 4].map((i) => css(el, `--openfoam-series-${i}`, ["black", "royalblue", "darkorange", "purple"][i - 1]));
}
export { fmt as formatNumber };
