import type {
  Annotation,
  AutomergeUrl,
  DataSeries,
  LinkedModelDoc,
  LinkedParameter,
  LinkedScenario,
  LoopAnnotation,
  Parameter,
  Scenario,
  Simulation,
  StockFlowFitDoc,
  StockFlowModelDoc,
  StockFlowTableDoc,
  TableValue,
  Variable,
} from "../types.ts";

/** Fetches the document a URL names. It gets `automerge:<id>` or `automerge:<id>#<heads>`, never a path. */
export type Loader = (url: AutomergeUrl) => Promise<unknown>;

export function isLinkedModel(doc: unknown): doc is LinkedModelDoc {
  return isRecord(doc) && isRecord(doc["@patchwork"]) && doc["@patchwork"].type === "stock-flow-model" && "compare" in doc;
}

/**
 * The model the engine runs. Links are read: a table with a value per year turns its parameter into an input curve,
 * a table with one number or a number inside a fit run into a plain value. Annotations become meanings, sources,
 * loop stories and notes on data points, so the existing views show them.
 */
export async function resolveModel(doc: LinkedModelDoc, load: Loader): Promise<StockFlowModelDoc> {
  const read = cachedReader(load);
  const values = new Map<string, Resolved>();
  for (const url of linkedUrls(doc)) values.set(url, await resolveLink(url, read));
  const valueOf = (value: number | AutomergeUrl): Resolved => (typeof value === "number" ? { kind: "number", value, origin: "given" } : values.get(value)!);
  const notes = notesByTarget(doc.annotations);
  const curves = curveParameters(doc, valueOf);

  const variables: Record<string, Variable> = Object.fromEntries(
    Object.entries(structuredClone(doc.variables)).map(([id, variable]) => {
      const description = notes.get(`./variables/${id}`);
      return [id, description ? { ...variable, description } : variable];
    }),
  );
  const parameters: Record<string, Parameter> = {};
  for (const [id, parameter] of Object.entries(doc.parameters)) {
    if (curves.has(id)) {
      const { variable, scale } = inputFor(doc, id, parameter, valueOf(parameter.value), notes);
      if (id in variables) throw new Error(`"${id}" is both a variable and a parameter`);
      if (`${id}Scale` in doc.parameters) throw new Error(`"${id}Scale" is taken; it names the scale of ${id}'s curve`);
      variables[id] = variable;
      parameters[`${id}Scale`] = scale;
    } else parameters[id] = parameterFor(id, parameter, valueOf(parameter.value), notes);
  }

  const scales = Object.fromEntries([...curves].map((id) => [id, (parameters[`${id}Scale`] as { value: number }).value]));
  const scenarios: Record<string, Scenario> = {};
  Object.entries(doc.scenarios).forEach(([id, scenario], order) => {
    scenarios[id] = scenarioFor(doc, scenario, order, curves, scales, valueOf);
  });

  const data: Record<string, DataSeries> = {};
  for (const [id, { table, variable }] of Object.entries(doc.compare)) {
    const resolved = values.get(table)!;
    if (resolved.kind !== "path") throw new Error(`compare.${id} needs a table with a value per year; ${table} gives one number`);
    data[id] = seriesFor(resolved, variable);
  }

  const loops: Record<string, LoopAnnotation> = Object.fromEntries(
    Object.entries(doc.loops).map(([id, loop]) => [id, { ...loop, story: notes.get(`./loops/${id}`) ?? "" }]),
  );
  return {
    "@patchwork": { type: "stock-flow-model" },
    title: doc.title,
    description: notes.get(".") ?? "",
    simulation: doc.simulation,
    variables,
    parameters,
    data,
    scenarios,
    annotations: { loops, links: {} },
    ...(doc.layout ? { layout: doc.layout } : {}),
  };
}

/** Every URL a linked model reads: parameter values, scenario overrides and compared tables. */
export function linkedUrls(doc: LinkedModelDoc): AutomergeUrl[] {
  const urls = new Set<AutomergeUrl>();
  const add = (value: number | AutomergeUrl | undefined) => {
    if (typeof value === "string") urls.add(value);
  };
  for (const parameter of Object.values(doc.parameters)) add(parameter.value);
  for (const scenario of Object.values(doc.scenarios)) for (const value of Object.values(scenario.changes.parameters ?? {})) add(value);
  for (const { table } of Object.values(doc.compare)) add(table);
  return [...urls];
}

/** What a link stands for once read. */
export type Resolved =
  | { kind: "number"; value: number; origin: "given" }
  | { kind: "number"; value: number; origin: "table"; url: AutomergeUrl; table: StockFlowTableDoc }
  | { kind: "number"; value: number; origin: "fit"; url: AutomergeUrl; fit: StockFlowFitDoc; parameter: string }
  | { kind: "number"; value: number; origin: "document"; url: AutomergeUrl }
  | { kind: "path"; points: [year: number, value: number][]; url: AutomergeUrl; table: StockFlowTableDoc };

export async function resolveLink(url: AutomergeUrl, read: Loader): Promise<Resolved> {
  const ref = parseRef(url);
  if (!ref.documentId) throw new Error(`"${url}" is not an automerge: URL`);
  const doc = await read(documentUrl(ref));
  if (ref.path.length) {
    const value = lookup(doc, ref.path);
    if (typeof value !== "number") throw new Error(`${url} points at ${JSON.stringify(value)}, not a number`);
    const last = ref.path.at(-1)!;
    if (typeOf(doc) === "stock-flow-fit" && "key" in last) return { kind: "number", value, origin: "fit", url, fit: doc as StockFlowFitDoc, parameter: last.key };
    if (typeOf(doc) === "stock-flow-table") return { kind: "number", value, origin: "table", url, table: doc as StockFlowTableDoc };
    return { kind: "number", value, origin: "document", url };
  }
  if (typeOf(doc) !== "stock-flow-table") throw new Error(`${url} is a ${typeOf(doc) ?? "document without a type"}; link a table, or a number inside a document`);
  const table = doc as StockFlowTableDoc;
  const single = singleNumber(table.result);
  if (single !== undefined) return { kind: "number", value: single, origin: "table", url, table };
  return { kind: "path", points: yearValues(table, url), url, table };
}

/** A reference into a document: its id and pinned heads (absent for `.` and `./…`), and the path inside it. */
export type Ref = { documentId?: string; heads?: string[]; path: Segment[] };

/** One step into a document: a key, an array index (`@3`), or the array item matching a pattern (`{"year":2011}`). */
export type Segment = { key: string } | { index: number } | { match: Record<string, unknown> };

export function parseRef(ref: string): Ref {
  if (ref === ".") return { path: [] };
  if (ref.startsWith("./")) return { path: parsePath(ref.slice(2)) };
  if (!ref.startsWith("automerge:")) throw new Error(`"${ref}" is neither ".", "./<path>" nor an automerge: URL`);
  const rest = ref.slice("automerge:".length);
  const hash = rest.indexOf("#");
  const main = hash < 0 ? rest : rest.slice(0, hash);
  const heads = hash < 0 ? undefined : rest.slice(hash + 1).split("|").filter(Boolean);
  const [documentId, ...segments] = main.split("/");
  return { documentId, ...(heads?.length ? { heads } : {}), path: parsePath(segments.join("/")) };
}

/** `automerge:<id>`, with `#<heads>` when the reference is pinned. */
export function documentUrl(ref: Ref): AutomergeUrl {
  if (!ref.documentId) throw new Error("A relative reference names no document");
  return `automerge:${ref.documentId}${ref.heads ? `#${ref.heads.join("|")}` : ""}`;
}

export function lookup(doc: unknown, path: Segment[]): unknown {
  let value: unknown = doc;
  for (const segment of path) {
    if ("key" in segment) value = isRecord(value) ? value[segment.key] : undefined;
    else if ("index" in segment) value = Array.isArray(value) ? value[segment.index] : undefined;
    else value = Array.isArray(value) ? value.find((item) => isRecord(item) && Object.entries(segment.match).every(([key, wanted]) => item[key] === wanted)) : undefined;
    if (value === undefined) return undefined;
  }
  return value;
}

/** The text of every annotation on a target, joined; targets are compared after decoding. */
export function notesByTarget(annotations: Annotation[] | undefined): Map<string, string> {
  const notes = new Map<string, string>();
  for (const { target, text } of annotations ?? []) {
    const key = canonicalTarget(target);
    notes.set(key, notes.has(key) ? `${notes.get(key)} ${text}` : text);
  }
  return notes;
}

function canonicalTarget(target: string): string {
  if (target === "." || !target.startsWith("./")) return target;
  return `./${target
    .slice(2)
    .split("/")
    .map((segment) => decodeSegment(segment))
    .join("/")}`;
}

function parsePath(path: string): Segment[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (/^@\d+$/.test(segment)) return { index: Number(segment.slice(1)) };
      const decoded = decodeSegment(segment);
      if (decoded.startsWith("{")) {
        const match = JSON.parse(decoded) as unknown;
        if (!isRecord(match)) throw new Error(`"${decoded}" must be a JSON object`);
        return { match };
      }
      if (decoded.startsWith("[")) throw new Error(`Text ranges ("${decoded}") point into text; they can't be looked up as values`);
      return { key: decoded.startsWith("\\") ? decoded.slice(1) : decoded };
    });
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Parameters some scenario sets to a value per year: those become input variables with a curve per scenario. */
function curveParameters(doc: LinkedModelDoc, valueOf: (value: number | AutomergeUrl) => Resolved): Set<string> {
  const curves = new Set<string>();
  for (const [id, parameter] of Object.entries(doc.parameters)) if (valueOf(parameter.value).kind === "path") curves.add(id);
  for (const scenario of Object.values(doc.scenarios)) {
    for (const [id, value] of Object.entries(scenario.changes.parameters ?? {})) {
      if (!(id in doc.parameters)) throw new Error(`A scenario sets "${id}", which is not a parameter`);
      if (valueOf(value).kind === "path") curves.add(id);
    }
  }
  return curves;
}

function parameterFor(id: string, parameter: LinkedParameter, resolved: Resolved, notes: Map<string, string>): Parameter {
  if (resolved.kind === "path") throw new Error(`"${id}" has a value per year`);
  const meaning = notes.get(`./parameters/${id}`) ?? "";
  const common = { label: parameter.label, unit: parameter.unit, format: formatOf(parameter.unit), meaning, value: resolved.value };
  if (resolved.origin === "fit") {
    const { fit } = resolved;
    return {
      ...common,
      group: "Estimated",
      estimated: {
        from: Object.keys(fit.objective.compare),
        years: fit.objective.years,
        method: `Fit run "${fit.title}", ${resolved.url}`,
        ...(fit.bounds[resolved.parameter] ? { range: fit.bounds[resolved.parameter] } : {}),
      },
    };
  }
  if (resolved.origin === "table") return { ...common, group: "Data", source: `Data: ${resolved.table.label}, ${resolved.url}` };
  if (resolved.origin === "document") return { ...common, group: "Data", source: `Data: ${resolved.url}` };
  const source = notes.get(`./parameters/${id}/value`) ?? notes.get(`./parameters/${id}`);
  return { ...common, group: "Given", ...(source ? { source } : {}) };
}

function inputFor(
  doc: LinkedModelDoc,
  id: string,
  parameter: LinkedParameter,
  resolved: Resolved,
  notes: Map<string, string>,
): { variable: Variable; scale: Parameter } {
  const scale = resolved.kind === "path" ? resolved.points.find(([, value]) => value !== 0)?.[1] ?? 1 : resolved.value || 1;
  const curve = curveOf(doc.simulation, resolved, scale);
  const source = resolved.kind === "path" ? `Data: ${resolved.table.label}, ${resolved.url}` : (notes.get(`./parameters/${id}/value`) ?? notes.get(`./parameters/${id}`));
  return {
    variable: {
      label: parameter.label,
      unit: parameter.unit,
      kind: "input",
      base: `${id}Scale`,
      range: [0, Math.max(2, Math.ceil(Math.max(...curve) * 15) / 10)],
      ...(notes.has(`./parameters/${id}`) ? { description: notes.get(`./parameters/${id}`) } : {}),
    },
    scale: {
      label: `${parameter.label}: scale of the curve`,
      group: "Data",
      meaning: `What a multiplier of 1 stands for in the curve of ${id}`,
      unit: parameter.unit,
      format: formatOf(parameter.unit),
      value: scale,
      ...(source ? { source } : {}),
    },
  };
}

function scenarioFor(
  doc: LinkedModelDoc,
  scenario: LinkedScenario,
  order: number,
  curves: Set<string>,
  scales: Record<string, number>,
  valueOf: (value: number | AutomergeUrl) => Resolved,
): Scenario {
  const parameters: Record<string, number> = {};
  const inputs: Record<string, number[]> = structuredClone(scenario.changes.inputs ?? {});
  const set = scenario.changes.parameters ?? {};
  for (const id of curves) {
    const value = id in set ? set[id] : scenario.base ? undefined : doc.parameters[id].value;
    if (value !== undefined) inputs[id] = curveOf(doc.simulation, valueOf(value), scales[id]);
  }
  for (const [id, value] of Object.entries(set)) {
    if (curves.has(id)) continue;
    const resolved = valueOf(value);
    if (resolved.kind === "path") throw new Error(`Scenario sets "${id}" to a value per year`);
    parameters[id] = resolved.value;
  }
  const { linkGain, dt } = scenario.changes;
  return {
    label: scenario.label,
    question: scenario.question,
    ...(scenario.expectation ? { expectation: scenario.expectation } : {}),
    ...(scenario.base ? { base: scenario.base } : {}),
    changes: {
      ...(Object.keys(parameters).length ? { parameters } : {}),
      ...(Object.keys(inputs).length ? { inputs } : {}),
      ...(linkGain ? { linkGain } : {}),
      ...(dt ? { dt } : {}),
    },
    order,
  };
}

/** One multiplier per model year: the table's value in that year over the scale, interpolated, held flat past either end. */
function curveOf(simulation: Simulation, resolved: Resolved, scale: number): number[] {
  const at = (year: number) => (resolved.kind === "path" ? valueInYear(resolved.points, year) : resolved.value);
  return Array.from({ length: simulation.years + 1 }, (_, index) => at(simulation.startYear + index) / scale);
}

function valueInYear(points: [number, number][], year: number): number {
  if (year <= points[0][0]) return points[0][1];
  if (year >= points.at(-1)![0]) return points.at(-1)![1];
  const after = points.findIndex(([at]) => at >= year);
  const [y0, v0] = points[after - 1];
  const [y1, v1] = points[after];
  return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
}

function seriesFor(resolved: Extract<Resolved, { kind: "path" }>, variable: string): DataSeries {
  const { table, url } = resolved;
  const notes = notesByTarget(table.annotations);
  const pointSources: Record<string, string> = {};
  for (const [year] of resolved.points) {
    const note = notes.get(`./result/${JSON.stringify({ year })}`);
    if (note) pointSources[String(year)] = note;
  }
  return {
    label: table.label,
    unit: table.unit,
    variable,
    points: resolved.points,
    source: { publisher: "", title: table.label, url, retrieved: "", method: `Table query over ${Object.keys(table.inputs).join(", ") || "no inputs"}` },
    notes: notes.has(".") ? [notes.get(".")!] : [],
    ...(Object.keys(pointSources).length ? { pointSources } : {}),
  };
}

function yearValues(table: StockFlowTableDoc, url: string): [number, number][] {
  const points: [number, number][] = [];
  for (const row of table.result) {
    const { year, value } = row;
    if (typeof year !== "number") throw new Error(`${url} (${table.label}) has rows without a numeric "year"; a linked table returns year, value`);
    if (typeof value === "number") points.push([year, value]);
    else if (value !== null) throw new Error(`${url} (${table.label}) has a non-numeric value in ${year}`);
  }
  if (!points.length) throw new Error(`${url} (${table.label}) has no values`);
  return points.sort(([a], [b]) => a - b);
}

function singleNumber(rows: Record<string, TableValue>[]): number | undefined {
  if (rows.length !== 1 || "year" in rows[0]) return undefined;
  const values = Object.values(rows[0]);
  return values.length === 1 && typeof values[0] === "number" ? values[0] : undefined;
}

function cachedReader(load: Loader): Loader {
  const cache = new Map<string, Promise<unknown>>();
  return (url) => {
    if (!cache.has(url)) cache.set(url, load(url));
    return cache.get(url)!;
  };
}

function formatOf(unit: string): Parameter["format"] {
  if (/^years?\b/.test(unit)) return "years";
  if (/share|%/.test(unit)) return "percent";
  if (/€|EUR/.test(unit)) return "currency";
  return "number";
}

function typeOf(doc: unknown): string | undefined {
  return isRecord(doc) && isRecord(doc["@patchwork"]) && typeof doc["@patchwork"].type === "string" ? doc["@patchwork"].type : undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
