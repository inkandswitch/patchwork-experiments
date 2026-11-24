import type { CausalGraph, GraphLink, GraphLoop } from "../engine/graph.ts";
import {
  arrowMarker,
  boxEdge,
  controlPoint,
  delayBars,
  drawLoopMarker,
  normal,
  offset,
  quadratic,
  signedArea,
  svgEl,
  svgText,
  tangent,
  uniqueId,
  type Position,
} from "./diagram-parts.ts";
import type { PlacedLayout } from "./view-layout.ts";
import type { LinkKey, LoopId, StockFlowModelDoc, VariableId } from "../types.ts";

export type LinkHover = (link: GraphLink | null, event?: MouseEvent) => void;

export type Highlighter = {
  /** Picks out a named loop: every cycle through its cut links. */
  highlightLoop: (loop: LoopId | null) => void;
  highlightLinks: (links: LinkKey[] | null, focus?: VariableId[]) => void;
};

/** The causal loop diagram: variable names joined by signed arrows, with a marker in each named loop. */
export function renderLoopDiagram(
  svg: SVGSVGElement,
  model: StockFlowModelDoc,
  graph: CausalGraph,
  layout: PlacedLayout,
  options: { onLinkHover: LinkHover; off: Set<LoopId> },
): Highlighter {
  const arrowId = uniqueId("sf-cld-arrow");
  const loops = namedLoops(model, graph);
  svg.setAttribute("viewBox", layout.viewBox);
  svg.classList.add("sf-cld");
  svg.replaceChildren(
    arrowMarker(arrowId),
    ...graph.links.map((link) => drawLink(link, layout, loops, arrowId, options.onLinkHover)),
    ...[...loops].map(([id, loop]) => {
      const marker = loopMarker(model, id, loop.cycles, layout, arrowId, true, (on) => highlighter.highlightLoop(on ? id : null));
      marker.classList.toggle("off", options.off.has(id));
      return marker;
    }),
    ...graph.nodes.map((id) => drawNode(model, id, layout)),
  );
  const highlighter = createHighlighter(svg, loops);
  return highlighter;
}

/** Named loops and the links of all their cycles; loops with no cycle in this view are left out. */
export function namedLoops(model: StockFlowModelDoc, graph: CausalGraph): Map<LoopId, { cycles: GraphLoop[]; links: Set<LinkKey> }> {
  const loops = new Map<LoopId, { cycles: GraphLoop[]; links: Set<LinkKey> }>();
  for (const id of Object.keys(model.annotations.loops)) {
    const cycles = graph.loops.filter((loop) => loop.named.includes(id));
    if (cycles.length) loops.set(id, { cycles, links: new Set(cycles.flatMap((cycle) => cycle.links)) });
  }
  return loops;
}

export function loopMarker(
  model: StockFlowModelDoc,
  id: LoopId,
  cycles: GraphLoop[],
  layout: PlacedLayout,
  arrowId: string,
  showName: boolean,
  onHover: (on: boolean) => void,
): SVGGElement {
  const annotation = model.annotations.loops[id];
  const variables = cycles.map((cycle) => cycle.variables);
  const path = variables[0].map(layout.position);
  const center = layout.marker(id, variables);
  return drawLoopMarker({ id, ...annotation }, center, { clockwise: signedArea(path) > 0, showName, arrowId }, onHover);
}

export function createHighlighter(svg: SVGSVGElement, loops: Map<LoopId, { links: Set<LinkKey> }>): Highlighter {
  const highlightLinks = (links: LinkKey[] | null, focus: VariableId[] = []) => {
    const on = links !== null;
    const active = new Set(links ?? []);
    const activeNodes = new Set(focus);
    svg.classList.toggle("highlighting", on);
    for (const link of svg.querySelectorAll<SVGGElement>(".link")) {
      const isActive = on && active.has(`${link.dataset.from}→${link.dataset.to}`);
      link.classList.toggle("active", isActive);
      if (isActive) {
        activeNodes.add(link.dataset.from!);
        activeNodes.add(link.dataset.to!);
      }
    }
    for (const node of svg.querySelectorAll<SVGElement>(".node")) {
      node.classList.toggle("active", activeNodes.has(node.dataset.id!));
      node.classList.toggle("focus", focus.includes(node.dataset.id!));
    }
  };
  return {
    highlightLinks: (links, focus) => {
      highlightLinks(links, focus);
      for (const marker of svg.querySelectorAll<SVGGElement>(".cld-loop")) marker.classList.remove("active");
    },
    highlightLoop: (loop) => {
      highlightLinks(loop === null ? null : [...(loops.get(loop)?.links ?? [])]);
      for (const marker of svg.querySelectorAll<SVGGElement>(".cld-loop")) marker.classList.toggle("active", marker.dataset.loop === loop);
    },
  };
}

function drawLink(
  link: GraphLink,
  layout: PlacedLayout,
  loops: Map<LoopId, { links: Set<LinkKey> }>,
  arrowId: string,
  onHover: LinkHover,
): SVGGElement {
  const bend = layout.bend(link);
  const control = controlPoint(layout.position(link.from), layout.position(link.to), bend);
  const start = edgePoint(layout, link.from, control);
  const end = edgePoint(layout, link.to, control);
  const d = `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`;
  const key = `${link.from}→${link.to}`;
  const memberOf = [...loops].filter(([, loop]) => loop.links.has(key)).map(([id]) => id);
  const group = svgEl("g", { class: `link${link.polarity === "0" ? " zero" : ""}`, "data-from": link.from, "data-to": link.to, "data-loops": memberOf.join(" ") });
  const hitArea = svgEl("path", { class: "hit", d });
  hitArea.addEventListener("mouseenter", (event) => onHover(link, event));
  hitArea.addEventListener("mousemove", (event) => onHover(link, event));
  hitArea.addEventListener("mouseleave", () => onHover(null));

  const curve = (t: number) => quadratic(start, control, end, t);
  const side = bend >= 0 ? 1 : -1;
  const signAt = offset(curve(0.82), normal(tangent(start, control, end, 0.82)), 12 * side);
  group.append(svgEl("path", { class: "line", d, "marker-end": `url(#${arrowId})` }));
  if (link.delays.length) group.append(delayBars(curve(0.5), tangent(start, control, end, 0.5)));
  group.append(svgText(link.polarity, signAt.x, signAt.y, "sign"), hitArea);
  return group;
}

function drawNode(model: StockFlowModelDoc, id: VariableId, layout: PlacedLayout): SVGTextElement {
  const { x, y } = layout.position(id);
  const lines = layout.lines(id);
  const text = svgEl("text", { class: `node ${model.variables[id].kind}`, "data-id": id });
  const title = svgEl("title", {});
  title.textContent = `${model.variables[id].label} (${id})`;
  text.append(title);
  lines.forEach((line, i) => {
    const tspan = svgEl("tspan", { x, y: y + (i - (lines.length - 1) / 2) * LINE_HEIGHT });
    tspan.textContent = line;
    text.append(tspan);
  });
  return text;
}

/** Where the line from a variable's centre towards a point leaves the box around its name. */
function edgePoint(layout: PlacedLayout, id: VariableId, toward: Position): Position {
  const lines = layout.lines(id);
  const halfWidth = (Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH) / 2 + 6;
  const halfHeight = (lines.length * LINE_HEIGHT) / 2 + 5;
  return boxEdge(layout.position(id), halfWidth, halfHeight, toward);
}

const CHAR_WIDTH = 8.4;
const LINE_HEIGHT = 18;
