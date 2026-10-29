import { modelPoints } from "../charts/resolve.ts";
import { compile, names } from "../engine/expr.ts";
import type { CausalGraph, GraphLink } from "../engine/graph.ts";
import { parsed } from "../engine/simulate.ts";
import { arrowMarker, boxEdge, controlPoint, delayBars, normal, offset, quadratic, svgEl, svgText, tangent, uniqueId, type Position } from "./diagram-parts.ts";
import { createHighlighter, loopMarker, namedLoops, type Highlighter, type LinkHover } from "./loop-diagram.ts";
import type { PlacedLayout } from "./view-layout.ts";
import type { LoopId, ParameterId, Run, Settings, StockFlowModelDoc, VariableId } from "../types.ts";

export type StockFlowData = { settings: Settings; parameters: Record<ParameterId, number>; run: Run; reference?: Run };

export type StockFlowDiagram = Highlighter & { fill: (data: StockFlowData) => void };

type Box = { center: Position; width: number; height: number };

/**
 * Stocks in boxes, everything else in rounded ones, joined by signed arrows. Clicking a box shows its curve over the
 * run; with a reference run, the scenario as written is drawn dashed behind it.
 */
export function createStockFlowDiagram(
  svg: SVGSVGElement,
  model: StockFlowModelDoc,
  graph: CausalGraph,
  layout: PlacedLayout,
  options: { onLinkHover: LinkHover; expanded: Set<VariableId>; onToggle: (id: VariableId) => void },
): StockFlowDiagram {
  const arrowId = uniqueId("sf-sfd-arrow");
  const loops = namedLoops(model, graph);
  const boxes = new Map(graph.nodes.map((id) => [id, nodeBox(layout, id, options.expanded.has(id))]));
  svg.setAttribute("viewBox", layout.viewBox);
  svg.classList.add("sf-sfd");
  svg.replaceChildren(
    arrowMarker(arrowId),
    ...graph.links.map((link) => drawLink(model, link, boxes, layout, loops, arrowId, options.onLinkHover)),
    ...[...loops].map(([id, loop]) => loopMarker(model, id, loop.cycles, layout, arrowId, false, (on) => highlighter.highlightLoop(on ? id : null))),
    ...graph.nodes.map((id) => drawNode(model, id, layout, boxes.get(id)!, options.expanded.has(id), options.onToggle)),
  );
  const highlighter = createHighlighter(svg, loops);
  const links = new Map(graph.links.map((link) => [`${link.from}→${link.to}`, link]));
  return { ...highlighter, fill: (data) => fill(svg, model, links, data) };
}

function fill(svg: SVGSVGElement, model: StockFlowModelDoc, links: Map<string, GraphLink>, { settings, parameters, run, reference }: StockFlowData): void {
  const off = (loop: LoopId) => model.annotations.loops[loop].cut.every((cut) => settings.linkGain[cut] === 0);
  for (const element of svg.querySelectorAll<SVGGElement>(".link")) {
    const cutBy = (element.dataset.cutBy ?? "").split(" ").filter(Boolean);
    element.classList.toggle("cut", cutBy.some(off));
  }
  for (const marker of svg.querySelectorAll<SVGGElement>(".cld-loop")) marker.classList.toggle("off", off(marker.dataset.loop!));
  for (const label of svg.querySelectorAll<SVGTextElement>(".delay-label")) {
    const link = links.get(label.dataset.link!)!;
    label.textContent = `${round(delayYears(model, link, parameters))} y`;
  }
  for (const spark of svg.querySelectorAll<SVGGElement>(".spark")) {
    const id = spark.dataset.id!;
    drawSparkline(model, spark, modelPoints(model, run, id), reference && modelPoints(model, reference, id));
  }
}

/**
 * How long the delay on a link takes: the time constant of the first-order delay it passes through, such as
 * `permitted / (construction / 2)`, or else the delay parameter itself.
 */
export function delayYears(model: StockFlowModelDoc, link: GraphLink, parameters: Record<ParameterId, number>): number {
  const along = new Set(link.via.map((key) => key.split("→")[1]));
  for (const id of along) {
    const variable = model.variables[id];
    if (variable.kind !== "flow" && variable.kind !== "auxiliary") continue;
    const equation = parsed(variable.equation);
    const delay = link.delays.find((name) => names(equation).has(name));
    if (!delay) continue;
    if (equation.type === "binary" && equation.op === "/" && names(equation.right).has(delay)) {
      const denominator = compile(equation.right)(parameters);
      if (Number.isFinite(denominator)) return denominator;
    }
    return parameters[delay];
  }
  return parameters[link.delays[0]];
}

function drawLink(
  model: StockFlowModelDoc,
  link: GraphLink,
  boxes: Map<VariableId, Box>,
  layout: PlacedLayout,
  loops: Map<LoopId, { links: Set<string> }>,
  arrowId: string,
  onHover: LinkHover,
): SVGGElement {
  const bend = layout.bend(link);
  const from = boxes.get(link.from)!;
  const to = boxes.get(link.to)!;
  const control = controlPoint(from.center, to.center, bend);
  const start = edgePoint(from, control);
  const end = edgePoint(to, control);
  const d = `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
  const curve = (t: number) => quadratic(start, control, end, t);
  const direction = (t: number) => tangent(start, control, end, t);
  const beside = (t: number, distance: number) => offset(curve(t), normal(direction(t)), distance);
  const side = bend >= 0 ? 1 : -1;
  const key = `${link.from}→${link.to}`;
  const cutBy = Object.entries(model.annotations.loops)
    .filter(([, loop]) => loop.cut.some((cut) => link.via.includes(cut)))
    .map(([id]) => id);

  const group = svgEl("g", {
    class: `link${link.polarity === "0" ? " zero" : ""}`,
    "data-from": link.from,
    "data-to": link.to,
    "data-loops": [...loops].filter(([, loop]) => loop.links.has(key)).map(([id]) => id).join(" "),
    "data-cut-by": cutBy.join(" "),
  });
  const hitArea = svgEl("path", { class: "hit", d });
  hitArea.addEventListener("mouseenter", (event) => onHover(link, event));
  hitArea.addEventListener("mousemove", (event) => onHover(link, event));
  hitArea.addEventListener("mouseleave", () => onHover(null));
  group.append(svgEl("path", { class: "line", d, "marker-end": `url(#${arrowId})` }));
  if (link.delays.length) {
    const labelAt = beside(0.45, -24 * side);
    const label = svgText("", labelAt.x, labelAt.y, "delay-label");
    label.dataset.link = key;
    group.append(delayBars(curve(0.45), direction(0.45)), label);
  }
  if (cutBy.length) {
    const at = curve(0.65);
    group.append(svgText("✕", at.x, at.y, "cut-mark"));
  }
  const signAt = beside(0.82, 12 * side);
  group.append(svgText(link.polarity, signAt.x, signAt.y, "sign"), hitArea);
  return group;
}

function drawNode(model: StockFlowModelDoc, id: VariableId, layout: PlacedLayout, box: Box, isExpanded: boolean, onToggle: (id: VariableId) => void): SVGGElement {
  const variable = model.variables[id];
  const lines = layout.lines(id);
  const labelHeight = lines.length * LINE_HEIGHT + LABEL_PADDING;
  const labelMiddle = isExpanded ? labelHeight / 2 : box.height / 2;
  const group = svgEl("g", {
    class: `node ${variable.kind}${isExpanded ? " expanded" : ""}`,
    "data-id": id,
    transform: `translate(${box.center.x - box.width / 2} ${box.center.y - box.height / 2})`,
  });
  const title = svgEl("title", {});
  title.textContent = `${variable.label} (${id}, ${variable.kind}): click to ${isExpanded ? "hide" : "show"} its curve.`;
  const label = svgEl("text", { class: "label" });
  lines.forEach((line, i) => {
    const tspan = svgEl("tspan", { x: box.width / 2, y: labelMiddle + (i - (lines.length - 1) / 2) * LINE_HEIGHT });
    tspan.textContent = line;
    label.append(tspan);
  });
  group.append(title, svgEl("rect", { width: box.width, height: box.height, rx: variable.kind === "stock" ? 3 : Math.min(box.height / 2, 14) }), label);
  if (isExpanded) {
    group.append(svgEl("g", { class: "spark", "data-id": id, "data-x": 10, "data-y": labelHeight - 2, "data-w": box.width - 20, "data-h": box.height - labelHeight - 6 }));
  }
  group.addEventListener("click", () => onToggle(id));
  return group;
}

function nodeBox(layout: PlacedLayout, id: VariableId, isExpanded: boolean): Box {
  const lines = layout.lines(id);
  const width = Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH + 24;
  const height = lines.length * LINE_HEIGHT + LABEL_PADDING;
  return { center: layout.position(id), width: isExpanded ? Math.max(width, 124) : width, height: isExpanded ? height + SPARK_HEIGHT : height };
}

function edgePoint(box: Box, toward: Position): Position {
  return boxEdge(box.center, box.width / 2 + 3, box.height / 2 + 3, toward);
}

function drawSparkline(model: StockFlowModelDoc, spark: SVGGElement, points: [number, number][], reference: [number, number][] | undefined): void {
  const [x, y, width, height] = ["x", "y", "w", "h"].map((name) => Number(spark.dataset[name]));
  const all = [...points, ...(reference ?? [])].map(([, value]) => value);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const flat = max - min < 1e-6 * Math.max(Math.abs(max), 1);
  const { startYear, years } = model.simulation;
  const px = (year: number) => x + ((year - startYear) / years) * width;
  const py = (value: number) => (flat ? y + height / 2 : y + (1 - (value - min) / (max - min)) * height);
  const path = (series: [number, number][]) => series.map(([year, value], i) => `${i === 0 ? "M" : "L"}${px(year).toFixed(1)},${py(value).toFixed(1)}`).join("");
  spark.replaceChildren();
  if (reference) spark.append(svgEl("path", { class: "spark-reference", d: path(reference) }));
  spark.append(svgEl("path", { class: "spark-line", d: path(points) }));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const CHAR_WIDTH = 8.4;
const LINE_HEIGHT = 17;
const LABEL_PADDING = 11;
const SPARK_HEIGHT = 26;
