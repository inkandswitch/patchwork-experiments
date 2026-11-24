import dagre from "@dagrejs/dagre";
import type { CausalGraph, GraphLink } from "../engine/graph.ts";
import { wrap } from "./diagram.ts";
import type { Position } from "./diagram-parts.ts";
import type { DiagramLayout, Layouts, LoopId, StockFlowModelDoc, VariableId } from "../types.ts";

export type ViewName = keyof Layouts;

/** Everything a diagram needs to place what the graph says to draw. */
export type PlacedLayout = {
  viewBox: string;
  position: (id: VariableId) => Position;
  lines: (id: VariableId) => string[];
  bend: (link: GraphLink) => number;
  /** Where a named loop's marker goes, given the cycles that belong to it. */
  marker: (loop: LoopId, cycles: VariableId[][]) => Position;
};

/** The variables a view shows: the stored layout's, or the key variables when there is none. */
export function viewVariables(model: StockFlowModelDoc, view: ViewName): VariableId[] | undefined {
  const stored = model.layout?.[view];
  return stored ? Object.keys(stored.nodes).filter((id) => id in model.variables) : undefined;
}

export function placeLayout(model: StockFlowModelDoc, view: ViewName, graph: CausalGraph): PlacedLayout {
  const stored = model.layout?.[view];
  return stored ? storedLayout(model, stored) : automaticLayout(model, graph);
}

function storedLayout(model: StockFlowModelDoc, layout: DiagramLayout): PlacedLayout {
  const position = (id: VariableId) => layout.nodes[id];
  return {
    viewBox: (layout.viewBox ?? boundingBox(Object.values(layout.nodes))).join(" "),
    position,
    lines: (id) => layout.nodes[id]?.lines ?? [model.variables[id].label],
    bend: (link) => layout.bends?.[`${link.from}→${link.to}`] ?? 0,
    marker: (loop, cycles) => layout.markers?.[loop] ?? cycleCenter(cycles, position),
  };
}

/** A layered layout for models without a stored one; arrows that run both ways between two variables bow apart. */
function automaticLayout(model: StockFlowModelDoc, graph: CausalGraph): PlacedLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 70, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  const lines = new Map(graph.nodes.map((id) => [id, wrap(model.variables[id].label)]));
  for (const id of graph.nodes) {
    const label = lines.get(id)!;
    g.setNode(id, { width: Math.max(...label.map((line) => line.length)) * 8.4 + 24, height: label.length * 18 + 12 });
  }
  for (const link of graph.links) g.setEdge(link.from, link.to);
  dagre.layout(g);
  const positions = new Map(graph.nodes.map((id) => [id, { x: g.node(id).x, y: g.node(id).y }]));
  const pairs = new Set(graph.links.map((link) => `${link.from}→${link.to}`));
  const { width = 0, height = 0 } = g.graph();
  const position = (id: VariableId) => positions.get(id)!;
  return {
    viewBox: `0 0 ${width} ${height}`,
    position,
    lines: (id) => lines.get(id) ?? [model.variables[id].label],
    bend: (link) => (pairs.has(`${link.to}→${link.from}`) ? 25 : 0),
    marker: (_, cycles) => cycleCenter(cycles, position),
  };
}

function cycleCenter(cycles: VariableId[][], position: (id: VariableId) => Position): Position {
  const points = (cycles[0] ?? []).map(position).filter(Boolean);
  if (!points.length) return { x: 0, y: 0 };
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
}

function boundingBox(points: Position[]): [number, number, number, number] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [left, top] = [Math.min(...xs) - 90, Math.min(...ys) - 40];
  return [left, top, Math.max(...xs) + 90 - left, Math.max(...ys) + 50 - top];
}
