import { compile } from "../engine/expr.ts";
import { multiplierAt, parsed } from "../engine/simulate.ts";
import { formatVariable } from "./format.ts";
import type { ParameterId, StockFlowModelDoc, VariableId } from "../types.ts";

export type InputEditorHandlers = {
  /** The curve as it stands: redrawn, or the scenario's. */
  curve: (id: VariableId) => number[];
  /** Records a new curve. */
  draw: (id: VariableId, curve: number[]) => void;
  /** Re-runs the model while a stroke goes on; throttled to one call a frame. */
  preview: () => void;
  /** Called once a stroke ends or a curve is reset. */
  commit: () => void;
  onHover: (id: VariableId | null) => void;
};

export type InputEditor = { element: HTMLElement; refresh: (parameters: Record<ParameterId, number>, description: string) => void };

/**
 * One small chart per input: drag across it to redraw the curve its multiplier follows over the run. The scale is the
 * input's range, widened to fit the curve it starts with.
 */
export function createInputEditor(model: StockFlowModelDoc, handlers: InputEditorHandlers): InputEditor {
  const element = document.createElement("div");
  element.className = "sf-input-controls";
  const intro = document.createElement("div");
  intro.className = "sf-input-intro";
  const description = document.createElement("p");
  description.className = "sf-hint";
  intro.append(Object.assign(document.createElement("h2"), { textContent: "Inputs over time" }), description);
  const inputs = Object.keys(model.variables).filter((id) => model.variables[id].kind === "input");
  const curves = inputs.map((id) => renderCurve(model, id, handlers));
  element.append(intro, ...curves.map((curve) => curve.element));
  return {
    element,
    refresh: (parameters, text) => {
      description.textContent = text;
      for (const curve of curves) curve.refresh(parameters);
    },
  };
}

type Part = { element: HTMLElement; refresh: (parameters: Record<ParameterId, number>) => void };

function renderCurve(model: StockFlowModelDoc, id: VariableId, handlers: InputEditorHandlers): Part {
  const variable = model.variables[id];
  if (variable.kind !== "input") throw new Error(`${id} is not an input`);
  const scenarioCurve = handlers.curve(id);
  const min = Math.min(variable.range[0], ...scenarioCurve);
  const max = Math.max(variable.range[1], ...scenarioCurve);
  const { startYear, years } = model.simulation;
  const element = document.createElement("div");
  element.className = "sf-input-editor";
  element.dataset.input = id;
  element.innerHTML = `
    <div class="sf-input-head">
      <span></span>
      <button type="button" class="sf-input-reset" title="Back to the balanced value">↺</button>
    </div>
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none">
      <title>Drag across the curve to redraw it. The dashed line is the balanced value.</title>
      <path class="input-area" />
      <line class="input-balance" x1="0" x2="${WIDTH}" />
      <path class="input-line" />
      <line class="input-cursor" y1="0" y2="${HEIGHT}" visibility="hidden" />
    </svg>
    <div class="sf-input-axis"><span>${startYear}</span><output></output><span>${startYear + years}</span></div>`;
  element.querySelector(".sf-input-head span")!.textContent = variable.label;

  const svg = element.querySelector("svg")!;
  const output = element.querySelector("output")!;
  const cursor = element.querySelector<SVGLineElement>(".input-cursor")!;
  const y = (value: number) => PAD + (HEIGHT - 2 * PAD) * (1 - (value - min) / (max - min));
  const x = (year: number) => (year / years) * WIDTH;
  let hovered: number | null = null;
  let parameters: Record<ParameterId, number> = {};
  const base = () => compile(parsed(variable.base))(parameters);

  const refresh = (next = parameters) => {
    parameters = next;
    const curve = handlers.curve(id);
    const line = curve.map((value, year) => `${year ? "L" : "M"}${x(year)},${y(value)}`).join("");
    element.querySelector(".input-line")!.setAttribute("d", line);
    element.querySelector(".input-area")!.setAttribute("d", `${line}L${WIDTH},${y(1)}L0,${y(1)}Z`);
    for (const end of ["y1", "y2"]) element.querySelector(".input-balance")!.setAttribute(end, String(y(1)));
    const multiplier = hovered === null ? 0 : multiplierAt(curve, hovered);
    output.textContent = hovered === null ? range(curve) : `${startYear + hovered}: ${percent(multiplier)} · ${formatVariable(model, id, base() * multiplier)}`;
  };

  const locate = (event: PointerEvent) => {
    const box = svg.getBoundingClientRect();
    const year = clamp(Math.round(((event.clientX - box.left) / box.width) * years), 0, years);
    const share = 1 - ((event.clientY - box.top) / box.height - PAD / HEIGHT) / (1 - (2 * PAD) / HEIGHT);
    const value = clamp(min + share * (max - min), min, max);
    return { year, value: Math.round(value * 100) / 100 };
  };
  const showCursor = (year: number | null) => {
    hovered = year;
    cursor.setAttribute("visibility", year === null ? "hidden" : "visible");
    if (year !== null) for (const end of ["x1", "x2"]) cursor.setAttribute(end, String(x(year)));
    refresh();
  };

  let last: { year: number; value: number } | null = null;
  let drawing: number[] | null = null;
  const changed = throttled(handlers.preview);
  const paint = (event: PointerEvent) => {
    const point = locate(event);
    const from = last ?? point;
    const step = Math.sign(point.year - from.year) || 1;
    drawing ??= [...handlers.curve(id)];
    for (let year = from.year; year !== point.year + step; year += step) {
      const t = point.year === from.year ? 1 : (year - from.year) / (point.year - from.year);
      drawing[year] = Math.round((from.value + (point.value - from.value) * t) * 100) / 100;
    }
    last = point;
    handlers.draw(id, [...drawing]);
    showCursor(point.year);
    changed();
  };

  svg.addEventListener("pointerdown", (event) => {
    svg.setPointerCapture(event.pointerId);
    last = null;
    drawing = null;
    paint(event);
  });
  svg.addEventListener("pointermove", (event) => {
    if (svg.hasPointerCapture(event.pointerId)) paint(event);
    else showCursor(locate(event).year);
  });
  svg.addEventListener("lostpointercapture", () => {
    last = null;
    drawing = null;
    handlers.commit();
  });
  svg.addEventListener("pointerleave", () => {
    if (last === null) showCursor(null);
  });
  element.querySelector(".sf-input-reset")!.addEventListener("click", () => {
    handlers.draw(id, Array.from({ length: years + 1 }, () => 1));
    handlers.commit();
  });
  element.addEventListener("mouseenter", () => handlers.onHover(id));
  element.addEventListener("mouseleave", () => handlers.onHover(null));
  return { element, refresh };
}

function range(curve: number[]): string {
  const low = Math.min(...curve);
  const high = Math.max(...curve);
  return low === high ? percent(low) : `${percent(low)} to ${percent(high)}`;
}

function percent(multiplier: number): string {
  return `${Math.round(multiplier * 100)}%`;
}

function throttled(callback: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      callback();
    });
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const WIDTH = 300;
const HEIGHT = 60;
const PAD = 4;
