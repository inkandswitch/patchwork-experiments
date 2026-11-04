import dagre from "@dagrejs/dagre";
import type { CausalGraph, GraphLink } from "../engine/graph.ts";
import type { LinkKey, StockFlowModelDoc, VariableId } from "../types.ts";

export type Point = { x: number; y: number };
export type DiagramLayout = {
  width: number;
  height: number;
  nodes: Map<VariableId, { x: number; y: number; width: number; height: number; lines: string[] }>;
  edges: Map<LinkKey, Point[]>;
};

/** Positions from a layered layout of the derived graph; nothing about the picture is stored in the model. */
export function layoutDiagram(model: StockFlowModelDoc, graph: CausalGraph): DiagramLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 34, ranksep: 44, edgesep: 14, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of graph.nodes) {
    const lines = wrap(model.variables[id].label);
    g.setNode(id, { width: Math.max(...lines.map((line) => line.length)) * 6.6 + 18, height: lines.length * 14 + 12, lines });
  }
  for (const link of graph.links) g.setEdge(link.from, link.to);
  dagre.layout(g);
  const nodes: DiagramLayout["nodes"] = new Map();
  for (const id of graph.nodes) {
    const node = g.node(id) as unknown as { x: number; y: number; width: number; height: number; lines: string[] };
    nodes.set(id, { x: node.x, y: node.y, width: node.width, height: node.height, lines: node.lines });
  }
  const edges: DiagramLayout["edges"] = new Map();
  for (const link of graph.links) edges.set(key(link), (g.edge(link.from, link.to) as { points: Point[] }).points);
  const { width = 0, height = 0 } = g.graph();
  return { width, height, nodes, edges };
}

/** Standalone SVG files carry their own styles; in the viewer they come from the shared stylesheet. */
export function diagramSvg(model: StockFlowModelDoc, graph: CausalGraph, layout: DiagramLayout, standalone = false): string {
  const edges = graph.links.map((link) => edgeSvg(link, layout.edges.get(key(link))!)).join("");
  const nodes = graph.nodes
    .map((id) => {
      const node = layout.nodes.get(id)!;
      const kind = model.variables[id].kind;
      const top = node.y - ((node.lines.length - 1) * 14) / 2;
      const text = node.lines
        .map((line, index) => `<text x="${node.x}" y="${top + index * 14}" text-anchor="middle" dominant-baseline="middle">${escape(line)}</text>`)
        .join("");
      return `<g class="node ${kind}" data-node="${id}">
        <rect x="${node.x - node.width / 2}" y="${node.y - node.height / 2}" width="${node.width}" height="${node.height}" rx="${kind === "stock" ? 3 : 10}"/>
        ${text}<title>${escape(model.variables[id].label)} (${id}, ${kind})</title></g>`;
    })
    .join("");
  return `<svg class="sf-diagram" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}" xmlns="http://www.w3.org/2000/svg">
    ${standalone ? `<style>${diagramStyles}</style>` : ""}
    <defs><marker id="sf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>
    ${edges}${nodes}</svg>`;
}

export function key(link: Pick<GraphLink, "from" | "to">): LinkKey {
  return `${link.from}→${link.to}`;
}

function edgeSvg(link: GraphLink, points: Point[]): string {
  const sign = { "+": "plus", "−": "minus", "±": "mixed", "0": "zero" }[link.polarity];
  const label = labelPoint(points);
  const delay = link.delays.length ? delayMark(points) : "";
  return `<g class="edge ${sign}" data-link="${key(link)}">
    <path class="hit" d="${smooth(points)}"/>
    <path class="line" d="${smooth(points)}" marker-end="url(#sf-arrow)"/>
    ${delay}
    <text class="sign" x="${label.x}" y="${label.y}" text-anchor="middle" dominant-baseline="middle">${link.polarity === "0" ? "0" : link.polarity}</text>
  </g>`;
}

/** Quadratic curves through the midpoints, so bends are rounded. */
function smooth(points: Point[]): string {
  if (points.length < 3) return `M${points.map((p) => `${p.x},${p.y}`).join(" L")}`;
  let d = `M${points[0].x},${points[0].y} L${mid(points[0], points[1]).x},${mid(points[0], points[1]).y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const end = i === points.length - 2 ? points[i + 1] : mid(points[i], points[i + 1]);
    d += ` Q${points[i].x},${points[i].y} ${end.x},${end.y}`;
  }
  return d;
}

/** Beside the arrow head, where causal loop diagrams put the sign. */
function labelPoint(points: Point[]): Point {
  const end = points[points.length - 1];
  const before = points[points.length - 2] ?? end;
  const length = Math.hypot(end.x - before.x, end.y - before.y) || 1;
  const [dx, dy] = [(end.x - before.x) / length, (end.y - before.y) / length];
  return { x: end.x - dx * 14 - dy * 8, y: end.y - dy * 14 + dx * 8 };
}

function delayMark(points: Point[]): string {
  const middle = Math.floor((points.length - 1) / 2);
  const [a, b] = [points[middle], points[middle + 1] ?? points[middle]];
  const center = mid(a, b);
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const [dx, dy] = [(b.x - a.x) / length, (b.y - a.y) / length];
  const bar = (offset: number) =>
    `<line class="delay" x1="${center.x + dx * offset - dy * 6}" y1="${center.y + dy * offset + dx * 6}" x2="${center.x + dx * offset + dy * 6}" y2="${center.y + dy * offset - dx * 6}"/>`;
  return bar(-2) + bar(2);
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function wrap(label: string): string[] {
  const lines: string[] = [];
  for (const word of label.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= 16) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

export const diagramStyles = `
.sf-diagram { font: 11.5px system-ui, -apple-system, "Segoe UI", sans-serif; }
.sf-diagram .node rect { fill: #fff; stroke: #adb5bd; stroke-width: 1; }
.sf-diagram .node.stock rect { stroke: #212529; stroke-width: 1.6; }
.sf-diagram .node.input rect { fill: #f1f3f5; stroke-dasharray: 3 2; }
.sf-diagram .node text { fill: #212529; }
.sf-diagram .edge .line { fill: none; stroke: #868e96; stroke-width: 1.4; }
.sf-diagram .edge .hit { fill: none; stroke: transparent; stroke-width: 10; }
.sf-diagram .edge.minus .line { stroke: #c2255c; }
.sf-diagram .edge.plus .line { stroke: #4c6ef5; }
.sf-diagram .edge.zero .line { stroke: #ced4da; stroke-dasharray: 4 3; }
.sf-diagram .edge.mixed .line { stroke: #e8590c; }
.sf-diagram .edge .sign { font-weight: 700; font-size: 12px; fill: #495057; }
.sf-diagram .edge.zero .sign { fill: #adb5bd; font-weight: 400; }
.sf-diagram .edge .delay { stroke: #212529; stroke-width: 1.6; }
.sf-diagram.highlighting .edge:not(.on), .sf-diagram.highlighting .node:not(.on) { opacity: 0.18; }
.sf-diagram .edge.on .line { stroke-width: 2.4; }
`;
