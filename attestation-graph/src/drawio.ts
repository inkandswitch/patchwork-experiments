// draw.io (.drawio / mxfile XML) import and export.
import { type Cell, type Diagram, type Pt, DEFAULT_MODEL, uid } from "./model";

const KNOWN_ATTRS = new Set(["id", "value", "style", "parent", "vertex", "edge", "source", "target"]);

const toNum = (v: string | null): number | undefined => {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** draw.io may store a page deflated + base64'd instead of as plain XML. */
async function inflateDiagram(text: string): Promise<string> {
  const bytes = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return decodeURIComponent(await new Response(stream).text());
}

function parseCells(root: Element): Cell[] {
  const cells: Cell[] = [];
  for (const el of Array.from(root.children)) {
    // <object>/<UserObject> wrap an mxCell and carry its id and label
    let cellEl: Element | null = el;
    let wrapper: Element | null = null;
    if (el.tagName !== "mxCell") {
      wrapper = el;
      cellEl = el.querySelector(":scope > mxCell");
      if (!cellEl) continue;
    }
    const id = (wrapper ?? cellEl).getAttribute("id");
    if (id === null || id === "0" || id === "1") continue;
    const cell: Cell = {
      id,
      value: (wrapper ? wrapper.getAttribute("label") : cellEl.getAttribute("value")) ?? "",
      style: cellEl.getAttribute("style") ?? "",
      parent: cellEl.getAttribute("parent") ?? "1",
    };
    if (cellEl.getAttribute("vertex") === "1") cell.vertex = true;
    if (cellEl.getAttribute("edge") === "1") cell.edge = true;
    const source = cellEl.getAttribute("source");
    const target = cellEl.getAttribute("target");
    if (source) cell.source = source;
    if (target) cell.target = target;
    for (const attr of Array.from(cellEl.attributes)) {
      if (KNOWN_ATTRS.has(attr.name)) continue;
      (cell.attrs ??= {})[attr.name] = attr.value;
    }
    const geo = cellEl.querySelector(":scope > mxGeometry");
    if (geo) {
      const x = toNum(geo.getAttribute("x"));
      const y = toNum(geo.getAttribute("y"));
      const width = toNum(geo.getAttribute("width"));
      const height = toNum(geo.getAttribute("height"));
      if (x !== undefined) cell.x = x;
      if (y !== undefined) cell.y = y;
      if (width !== undefined) cell.width = width;
      if (height !== undefined) cell.height = height;
      if (geo.getAttribute("relative") === "1") cell.relative = true;
      const points: Pt[] = [];
      for (const p of Array.from(geo.querySelectorAll(':scope > Array[as="points"] > mxPoint'))) {
        points.push({ x: toNum(p.getAttribute("x")) ?? 0, y: toNum(p.getAttribute("y")) ?? 0 });
      }
      if (points.length) cell.points = points;
    }
    cells.push(cell);
  }
  return cells;
}

/** Parse a .drawio file into diagrams. Throws if it is not an mxfile. */
export async function parseDrawio(xml: string): Promise<Diagram[]> {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid draw.io file (XML parse error)");
  const top = doc.documentElement;
  let diagramEls: Element[];
  if (top.tagName === "mxfile") diagramEls = Array.from(top.querySelectorAll(":scope > diagram"));
  else if (top.tagName === "mxGraphModel") diagramEls = [top];
  else throw new Error("Not a draw.io file (expected <mxfile>)");

  const diagrams: Diagram[] = [];
  for (const el of diagramEls) {
    let modelEl: Element | null = el.tagName === "mxGraphModel" ? el : el.querySelector(":scope > mxGraphModel");
    if (!modelEl && el.textContent?.trim()) {
      const inner = new DOMParser().parseFromString(await inflateDiagram(el.textContent), "application/xml");
      if (inner.documentElement.tagName === "mxGraphModel") modelEl = inner.documentElement;
    }
    if (!modelEl) continue;
    const model: Record<string, string> = {};
    for (const attr of Array.from(modelEl.attributes)) model[attr.name] = attr.value;
    const root = modelEl.querySelector(":scope > root");
    diagrams.push({
      id: el.getAttribute("id") || uid("d"),
      name: el.getAttribute("name") || `Page-${diagrams.length + 1}`,
      model: Object.keys(model).length ? model : { ...DEFAULT_MODEL },
      cells: root ? parseCells(root) : [],
    });
  }
  if (!diagrams.length) throw new Error("The draw.io file contains no diagrams");
  return diagrams;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#xa;");

const attrs = (pairs: [string, string | number | undefined][]) =>
  pairs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");

function serializeCell(c: Cell): string {
  const head = attrs([
    ["id", c.id],
    ["value", c.value ?? ""],
    ["style", c.style ?? ""],
    ["parent", c.parent || "1"],
    ["vertex", c.vertex ? "1" : undefined],
    ["edge", c.edge ? "1" : undefined],
    ["source", c.source || undefined],
    ["target", c.target || undefined],
    ...Object.entries(c.attrs ?? {}),
  ]);
  if (!c.vertex && !c.edge) return `<mxCell${head} />`;
  const geo = attrs([
    ["x", c.x],
    ["y", c.y],
    ["width", c.width],
    ["height", c.height],
    ["relative", c.relative || c.edge ? "1" : undefined],
    ["as", "geometry"],
  ]);
  const points = (c.points ?? []).map((p) => `<mxPoint${attrs([["x", p.x], ["y", p.y]])} />`).join("");
  const inner = points ? `<Array as="points">${points}</Array>` : "";
  return `<mxCell${head}><mxGeometry${geo}${inner ? `>${inner}</mxGeometry>` : " />"}</mxCell>`;
}

/** Serialize diagrams as an uncompressed draw.io file. */
export function serializeDrawio(diagrams: Diagram[]): string {
  const pages = diagrams.map((d) => {
    const model = attrs(Object.entries({ ...DEFAULT_MODEL, ...(d.model ?? {}) }));
    const cells = (d.cells ?? []).map(serializeCell).join("");
    return `<diagram${attrs([["id", d.id], ["name", d.name]])}><mxGraphModel${model}><root><mxCell id="0" /><mxCell id="1" parent="0" />${cells}</root></mxGraphModel></diagram>`;
  });
  return `<mxfile host="app.diagrams.net">${pages.join("")}</mxfile>\n`;
}
