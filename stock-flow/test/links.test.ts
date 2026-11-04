import { describe, expect, test } from "vitest";
import { checkFitRun, fitRun, objectiveAt } from "../src/engine/fit-run.ts";
import { lookup, notesByTarget, parseRef, resolveModel, type Loader } from "../src/engine/links.ts";
import { scenarioSettings } from "../src/engine/scenarios.ts";
import { simulate } from "../src/engine/simulate.ts";
import { valueAt } from "../src/engine/fit.ts";
import type { AutomergeUrl, LinkedModelDoc, StockFlowFitDoc, StockFlowModelDoc, StockFlowTableDoc } from "../src/types.ts";

describe("references", () => {
  test("a URL carries a document, a path and pinned heads", () => {
    expect(parseRef('automerge:abc/values/tau#h1|h2')).toEqual({ documentId: "abc", heads: ["h1", "h2"], path: [{ key: "values" }, { key: "tau" }] });
    expect(parseRef("automerge:abc")).toEqual({ documentId: "abc", path: [] });
  });

  test("relative references point into the document they sit in", () => {
    expect(parseRef(".")).toEqual({ path: [] });
    expect(parseRef("./result/@2/value")).toEqual({ path: [{ key: "result" }, { index: 2 }, { key: "value" }] });
    expect(parseRef(`./result/${encodeURIComponent('{"year":2011}')}`)).toEqual({ path: [{ key: "result" }, { match: { year: 2011 } }] });
  });

  test("a match pattern finds the row it describes", () => {
    const doc = { result: [{ year: 2010, value: 1 }, { year: 2011, value: 2 }] };
    expect(lookup(doc, parseRef('./result/{"year":2011}/value').path)).toBe(2);
    expect(lookup(doc, parseRef('./result/{"year":2012}').path)).toBeUndefined();
  });

  test("annotations on the same target are joined, whether or not the target is encoded", () => {
    const notes = notesByTarget([
      { target: './result/{"year":2011}', text: "One." },
      { target: `./result/${encodeURIComponent('{"year":2011}')}`, text: "Two." },
    ]);
    expect(notes.get('./result/{"year":2011}')).toBe("One. Two.");
  });
});

const years = Array.from({ length: 16 }, (_, index) => 2000 + index);
const inflowPath = years.map((year) => ({ year, value: year < 2006 ? 100 : 160 }));

describe("resolving a linked model", () => {
  test("a table with a value per year becomes an input curve scaled by its first value", async () => {
    const model = await resolveModel(linkedModel({ tau: 2 }), loader());
    expect(model.variables.inflow).toMatchObject({ kind: "input", base: "inflowScale" });
    expect(model.parameters.inflowScale).toMatchObject({ value: 100, group: "Data" });
    expect(model.scenarios.real.changes.inputs?.inflow.slice(0, 7)).toEqual([1, 1, 1, 1, 1, 1, 1.6]);
  });

  test("a scenario that links a single number holds the curve flat", async () => {
    const model = await resolveModel(linkedModel({ tau: 2 }), loader());
    expect(model.scenarios.flat.changes.inputs?.inflow.every((multiplier) => multiplier === 1.2)).toBe(true);
  });

  test("a given number takes its source from its annotation, a table number is data, a fit-run number is estimated", async () => {
    const model = await resolveModel(linkedModel({ tau: "automerge:fit/values/tau" }), loader({ fit: fitDoc({ tau: 2.5 }) }));
    expect(model.parameters.tau).toMatchObject({ value: 2.5, group: "Estimated", estimated: { from: ["stock"], years: [2000, 2010] } });
    expect(model.parameters.loss).toMatchObject({ value: 0.05, group: "Data" });
    const given = await resolveModel(linkedModel({ tau: 2 }), loader());
    expect(given.parameters.tau).toMatchObject({ value: 2, group: "Given", source: "Guessed from the literature.", meaning: "How long the stock holds things." });
  });

  test("compared tables become data series with notes on their points", async () => {
    const model = await resolveModel(linkedModel({ tau: 2 }), loader());
    expect(model.data.stock.points.slice(0, 2)).toEqual([
      [2000, 200],
      [2001, 200],
    ]);
    expect(model.data.stock.pointSources).toEqual({ "2003": "Report 2003, p. 4." });
    expect(model.variables.stock.description).toBe("What is held.");
  });
});

describe("fit runs", () => {
  test("recover the value the data were made with, from every start", async () => {
    const model = await resolveModel(linkedModel({ tau: 1 }), loader({ stock: stockTable(await dataWith(2)) }));
    const result = fitRun([model], { scenario: "real", parameters: { tau: { min: 0.5, max: 5 } }, compare: { stock: 1 }, years: [2000, 2010], holdout: [2011, 2015], starts: 4, seed: 3 });
    expect(result.values.tau).toBeCloseTo(2, 2);
    expect(result.restarts).toHaveLength(4);
    for (const restart of result.restarts) expect(restart.end.tau).toBeCloseTo(2, 2);
    expect(result.comparisons[0].holdout?.mape).toBeLessThan(1e-3);
    expect(result.atBound).toEqual([]);
  });

  test("a panel shares the parameters across models", async () => {
    const data = stockTable(await dataWith(2));
    const one = await resolveModel(linkedModel({ tau: 1 }), loader({ stock: data }));
    const two = await resolveModel(linkedModel({ tau: 3 }), loader({ stock: data }));
    const result = fitRun([one, two], { scenario: "real", parameters: { tau: { min: 0.5, max: 5 } }, compare: { stock: 1 }, years: [2000, 2010], starts: 2, seed: 1 });
    expect(result.values.tau).toBeCloseTo(2, 2);
    expect(result.comparisons.map(({ model }) => model)).toEqual([0, 1]);
  });

  test("the profile of an identified parameter has its minimum next to the fit", async () => {
    const model = await resolveModel(linkedModel({ tau: 1 }), loader({ stock: stockTable(await dataWith(2)) }));
    const result = fitRun([model], { scenario: "real", parameters: { tau: { min: 0.5, max: 5 } }, compare: { stock: 1 }, years: [2000, 2010], starts: 1, seed: 1, profile: true });
    const profile = result.profiles!.tau;
    const lowest = profile.reduce((best, point) => (point.objective < best.objective ? point : best));
    expect(Math.abs(lowest.value - 2)).toBeLessThan(0.5);
  });

  test("the objective at the fitted values is the one recorded", async () => {
    const model = await resolveModel(linkedModel({ tau: 1 }), loader({ stock: stockTable(await dataWith(2.4)) }));
    const spec = { scenario: "real", parameters: { tau: { min: 0.5, max: 5 } }, compare: { stock: 1 }, years: [2000, 2010] as [number, number], starts: 1, seed: 1 };
    const result = fitRun([model], spec);
    expect(objectiveAt([model], spec, result.values)).toBeCloseTo(result.objectiveValue, 8);
  });

  test("a holdout inside the fit window is refused", async () => {
    const model = await resolveModel(linkedModel({ tau: 1 }), loader());
    expect(() =>
      checkFitRun([model], { scenario: "real", parameters: { tau: { min: 0.5, max: 5 } }, compare: { stock: 1 }, years: [2000, 2010], holdout: [2008, 2015], starts: 1, seed: 1 }),
    ).toThrow(/overlaps/);
  });
});

/** One stock fed by a per-year inflow from a table, drained by a delay `tau` and a loss share from a single-number table. */
function linkedModel(values: { tau: number | AutomergeUrl }): LinkedModelDoc {
  return {
    "@patchwork": { type: "stock-flow-model" },
    title: "Test",
    simulation: { startYear: 2000, years: 15, dt: 0.0625, recordInterval: 0.25 },
    variables: {
      stock: { label: "Stock", unit: "things", kind: "stock", initial: "inflowScale * tau / (1 + loss * tau)", inflows: ["filling"], outflows: ["draining", "losing"] },
      filling: { label: "Filling", unit: "things per year", kind: "flow", equation: "inflow" },
      draining: { label: "Draining", unit: "things per year", kind: "flow", equation: "stock / tau" },
      losing: { label: "Losing", unit: "things per year", kind: "flow", equation: "stock * loss" },
    },
    parameters: {
      inflow: { label: "Inflow", unit: "things per year", value: "automerge:inflow" },
      tau: { label: "Holding time", unit: "years", value: values.tau },
      loss: { label: "Loss", unit: "share per year", value: "automerge:loss" },
    },
    compare: { stock: { table: "automerge:stock", variable: "stock" } },
    scenarios: {
      real: { label: "Real", question: "Does it fit?", changes: {} },
      flat: { label: "Flat", question: "Without the step?", base: "real", changes: { parameters: { inflow: "automerge:flat" } } },
    },
    loops: {},
    annotations: [
      { target: "./variables/stock", text: "What is held." },
      { target: "./parameters/tau", text: "How long the stock holds things." },
      { target: "./parameters/tau/value", text: "Guessed from the literature." },
    ],
  };
}

function loader(extra: Record<string, unknown> = {}): Loader {
  const docs: Record<string, unknown> = {
    inflow: table("Inflow", inflowPath),
    flat: table("Flat inflow", [{ value: 120 }]),
    loss: table("Loss", [{ value: 0.05 }]),
    stock: stockTable(years.map((year) => ({ year, value: 200 }))),
    ...extra,
  };
  return async (url) => {
    const id = parseRef(url).documentId!;
    if (!(id in docs)) throw new Error(`No document ${id}`);
    return docs[id];
  };
}

function stockTable(rows: { year: number; value: number }[]): StockFlowTableDoc {
  return { ...table("Stock", rows), annotations: [{ target: './result/{"year":2003}', text: "Report 2003, p. 4." }] };
}

function table(label: string, result: StockFlowTableDoc["result"]): StockFlowTableDoc {
  return { "@patchwork": { type: "stock-flow-table" }, label, unit: "things", inputs: {}, query: "SELECT 1", result, annotations: [] };
}

/** The stock the model gives with this holding time, as a table of yearly values. */
async function dataWith(tau: number): Promise<{ year: number; value: number }[]> {
  const model: StockFlowModelDoc = await resolveModel(linkedModel({ tau }), loader());
  const run = simulate(model, scenarioSettings(model, "real"));
  return years.map((year) => ({ year, value: valueAt(run, "stock", year) }));
}

function fitDoc(values: Record<string, number>): StockFlowFitDoc {
  return {
    "@patchwork": { type: "stock-flow-fit" },
    title: "Test fit",
    models: [],
    scenario: "real",
    objective: { compare: { stock: 1 }, years: [2000, 2010] },
    bounds: { tau: { min: 0.5, max: 5 } },
    method: { kind: "nelder-mead", starts: 1, seed: 1, maxEvaluations: 80 },
    restarts: [],
    values,
    objectiveValue: 0,
    atBound: [],
    comparisons: [],
    run: { command: "", version: "", at: "" },
    annotations: [],
  };
}
