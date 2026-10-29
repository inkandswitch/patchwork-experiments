import type { ChartSpec, Series } from "./resolve.ts";

/** Title, legend, hover readout and the plot, sized to the container. */
export function renderChart(container: HTMLElement, spec: ChartSpec): void {
  const readout = element("p", { class: "sf-readout" });
  const plot = element("div", { class: "sf-plot" });
  container.replaceChildren(element("h3", {}, spec.title), legend(spec.series), readout, plot);
  const geometry = chartGeometry(spec, Math.max(plot.clientWidth, 240), Math.max(plot.clientHeight, 120));
  plot.innerHTML = plotSvg(spec, geometry);
  bindReadout(plot, spec, geometry, readout);
}

type Pad = { top: number; right: number; bottom: number; left: number };
type Axis = { ticks: number[]; y: (value: number) => number };
type Geometry = {
  width: number;
  height: number;
  pad: Pad;
  x0: number;
  x1: number;
  x: (value: number) => number;
  left: Axis;
  right: Axis | null;
};

function chartGeometry(spec: ChartSpec, width: number, height: number): Geometry {
  const left = spec.series.filter((series) => series.axis !== "right");
  const right = spec.series.filter((series) => series.axis === "right");
  const pad = { top: right.length ? 18 : 10, right: right.length ? 54 : 14, bottom: 22, left: 54 };
  const xs = spec.series.flatMap((series) => series.points.map(([x]) => x));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const tickCount = Math.max(3, Math.floor((height - pad.top - pad.bottom) / 24));
  return {
    width,
    height,
    pad,
    x0,
    x1,
    x: (value) => pad.left + ((value - x0) / (x1 - x0 || 1)) * (width - pad.left - pad.right),
    left: yAxis(values(left, spec.guide), tickCount, height, pad),
    right: right.length ? yAxis(values(right), tickCount, height, pad) : null,
  };
}

function plotSvg(spec: ChartSpec, g: Geometry): string {
  const { width, height, pad, x, left, right } = g;
  const axisFor = (series: Series) => (series.axis === "right" && right ? right : left);
  return `
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(spec.title)}">
      ${left.ticks.map((tick) => gridLine(left.y(tick), width, pad)).join("")}
      ${left.ticks.map((tick) => tickLabel(spec.format(tick), pad.left - 6, left.y(tick), "end")).join("")}
      ${right
        ? right.ticks.map((tick) => tickLabel((spec.formatRight ?? spec.format)(tick), width - pad.right + 6, right.y(tick), "start")).join("")
        : ""}
      ${niceTicks(g.x0, g.x1, Math.max(2, Math.floor(width / 70)))
        .map((tick) => `<text class="tick" x="${x(tick)}" y="${height - 6}" text-anchor="middle">${tick}</text>`)
        .join("")}
      <line class="baseline" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"/>
      ${spec.guide ? guideLine(spec.guide, left.y(spec.guide.value), width, pad) : ""}
      ${spec.series.map((series) => seriesPath(series, x, axisFor(series).y)).join("")}
      ${right ? axisTitles(spec, width, pad) : ""}
      <line class="hover-line" x1="0" x2="0" y1="${pad.top}" y2="${height - pad.bottom}" visibility="hidden"/>
    </svg>`;
}

function bindReadout(plot: HTMLElement, spec: ChartSpec, g: Geometry, readout: HTMLElement): void {
  const svg = plot.querySelector("svg")!;
  const line = svg.querySelector<SVGLineElement>(".hover-line")!;
  svg.addEventListener("mousemove", (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * g.width;
    const at = g.x0 + ((px - g.pad.left) / (g.width - g.pad.left - g.pad.right)) * (g.x1 - g.x0);
    const year = Math.round(at);
    const parts = spec.series.flatMap((series) => {
      const nearest = nearestPoint(series.points, year);
      const format = series.axis === "right" ? (spec.formatRight ?? spec.format) : spec.format;
      return nearest && Math.abs(nearest[0] - year) < 0.5 ? [`${series.label} ${format(nearest[1])}`] : [];
    });
    line.setAttribute("x1", String(g.x(year)));
    line.setAttribute("x2", String(g.x(year)));
    line.setAttribute("visibility", "visible");
    readout.textContent = `${year}: ${parts.join(" · ") || "no values"}`;
  });
  svg.addEventListener("mouseleave", () => {
    line.setAttribute("visibility", "hidden");
    readout.textContent = "";
  });
}

function axisTitles(spec: ChartSpec, width: number, pad: Pad): string {
  const [left, right] = spec.axisTitles ?? [];
  return `
    <text class="axis-title" x="${pad.left - 6}" y="${pad.top - 4}" text-anchor="end">${escapeHtml(left ?? "")}</text>
    <text class="axis-title" x="${width - pad.right + 6}" y="${pad.top - 4}" text-anchor="start">${escapeHtml(right ?? "")}</text>`;
}

function nearestPoint(points: [number, number][], x: number): [number, number] | undefined {
  let best: [number, number] | undefined;
  for (const point of points) if (!best || Math.abs(point[0] - x) < Math.abs(best[0] - x)) best = point;
  return best;
}

function yAxis(all: number[], tickCount: number, height: number, pad: Pad): Axis {
  const [min, max] = paddedRange(all);
  return {
    ticks: niceTicks(min, max, tickCount),
    y: (value) => pad.top + (1 - (value - min) / (max - min)) * (height - pad.top - pad.bottom),
  };
}

function values(series: Series[], guide?: { value: number }): number[] {
  return [...series.flatMap((s) => s.points.map(([, y]) => y)), ...(guide ? [guide.value] : [])];
}

function legend(series: Series[]): HTMLUListElement {
  const list = element("ul", { class: "sf-legend" });
  for (const item of series) {
    const entry = element("li", {});
    const swatch = element("span", { class: `swatch${item.dashed ? " dashed" : ""}${item.markers ? " markers" : ""}` });
    swatch.style.setProperty("--color", item.color);
    entry.append(swatch, item.label + (item.axis === "right" ? " (right axis)" : ""));
    list.append(entry);
  }
  return list;
}

function seriesPath(series: Series, x: (v: number) => number, y: (v: number) => number): string {
  const dash = series.dashed ? `stroke-dasharray="5 4"` : "";
  const paths = splitAtGaps(series.points).map((points) => {
    const d = points.map(([px, py], i) => `${i === 0 ? "M" : "L"}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join("");
    return `<path d="${d}" fill="none" stroke="${series.color}" stroke-width="2" ${dash}/>`;
  });
  const markers = series.markers
    ? series.points.map(
        ([px, py]) =>
          `<circle cx="${x(px).toFixed(1)}" cy="${y(py).toFixed(1)}" r="2.6" fill="${series.color}"><title>${escapeHtml(series.label)}, ${px}: ${py.toLocaleString("en")}</title></circle>`,
      )
    : [];
  return [...paths, ...markers].join("");
}

function splitAtGaps(points: [number, number][]): [number, number][][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const step = Math.min(...sorted.slice(1).map(([px], i) => px - sorted[i][0]));
  const segments: [number, number][][] = [];
  for (const point of sorted) {
    const current = segments[segments.length - 1];
    if (current && point[0] - current[current.length - 1][0] <= step * 1.5) current.push(point);
    else segments.push([point]);
  }
  return segments;
}

function gridLine(yPos: number, width: number, pad: Pad): string {
  return `<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${yPos}" y2="${yPos}"/>`;
}

function tickLabel(text: string, xPos: number, yPos: number, anchor: "start" | "end"): string {
  return `<text class="tick" x="${xPos}" y="${yPos}" text-anchor="${anchor}" dominant-baseline="middle">${text}</text>`;
}

function guideLine(guide: { value: number; label: string }, yPos: number, width: number, pad: Pad): string {
  return `
    <line class="guide" x1="${pad.left}" x2="${width - pad.right}" y1="${yPos}" y2="${yPos}"/>
    <text class="guide-label" x="${width - pad.right}" y="${yPos - 5}" text-anchor="end">${escapeHtml(guide.label)}</text>`;
}

function paddedRange(all: number[]): [number, number] {
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  return [min - span * 0.08, max + span * 0.08];
}

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return ticks;
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}
