import { describe, expect, test } from "vitest";
import { checkModel } from "../src/engine/check.ts";
import { causalGraph } from "../src/engine/graph.ts";
import { scenarioSettings, withKnob } from "../src/engine/scenarios.ts";
import { resolveParameters, simulate } from "../src/engine/simulate.ts";
import { delayYears } from "../src/views/stock-flow-diagram.ts";
import type { Run, StockFlowModelDoc } from "../src/types.ts";
import expected from "../examples/aachen/expected.json" with { type: "json" };
import aachen from "../examples/aachen/model.json" with { type: "json" };

const model = aachen as unknown as StockFlowModelDoc;

/** The old app's loop strength for B5 is the pipelineResponse parameter here. */
const KNOBS: Record<string, string> = { pipeline: "pipelineResponse" };

describe("the Aachen model reproduces the original simulate()", () => {
  for (const { reference, values } of expected.runs) {
    test(reference, () => compare(simulate(model, scenarioSettings(model, reference)), values));
  }
  for (const { reference, knob, value, values } of expected.sweeps) {
    test(`${reference} with ${knob} = ${value}`, () => {
      const settings = withKnob(model, scenarioSettings(model, reference), KNOBS[knob] ?? knob, value);
      compare(simulate(model, settings), values);
    });
  }
});

describe("the loop view", () => {
  const settings = scenarioSettings(model, "real");
  const graph = causalGraph(model, simulate(model, settings), settings);
  const link = (key: string) => graph.links.find((candidate) => `${candidate.from}→${candidate.to}` === key);

  test("folds the variables between key ones into links with the right sign", () => {
    expect(link("rent→demand")?.polarity).toBe("−");
    expect(link("rent→profitability")?.polarity).toBe("+");
    expect(link("notionalVacancy→rent")?.polarity).toBe("−");
    expect(link("students→demand")?.polarity).toBe("+");
    expect(link("permitted→starts")?.polarity).toBe("0");
  });

  test("marks delays from the equations", () => {
    expect(link("permitted→underConstruction")?.delays).toEqual(["construction"]);
    expect(link("rent→shareOutside")?.delays).toEqual(["moving"]);
    expect(link("notionalVacancy→perceivedPressure")?.delays).toEqual(["recognition"]);
  });

  test("finds every named loop as balancing", () => {
    for (const id of ["supply", "spillover", "land", "policy"]) {
      const cycles = graph.loops.filter((loop) => loop.named.includes(id));
      expect(cycles.some((loop) => loop.polarity === "balancing"), id).toBe(true);
    }
    expect(graph.loops.filter((loop) => loop.named.includes("pipeline")).every((loop) => loop.polarity === "inactive")).toBe(true);
  });

  test("finds the loop the hand-drawn diagram left out: students priced out slow the growth builders see", () => {
    const loop = graph.loops.find((candidate) => candidate.links.includes("shareOutside→demandGrowth"));
    expect(loop?.polarity).toBe("reinforcing");
  });

  test("a knockout makes its loop inactive", () => {
    const cut = scenarioSettings(model, "real without spillover");
    const knocked = causalGraph(model, simulate(model, cut), cut);
    const spillover = knocked.loops.filter((loop) => loop.named.includes("spillover"));
    expect(spillover.every((loop) => loop.polarity === "inactive")).toBe(true);
  });
});

describe("views that hide stocks", () => {
  const settings = scenarioSettings(model, "real");
  const run = simulate(model, settings);
  const graphFor = (view: "loops" | "stockFlow") => causalGraph(model, run, settings, { visible: Object.keys(model.layout![view]!.nodes) });
  const linkIn = (graph: ReturnType<typeof graphFor>, key: string) => graph.links.find((candidate) => `${candidate.from}→${candidate.to}` === key);

  test("show exactly the variables of the layout", () => {
    expect(graphFor("loops").nodes).not.toContain("permitted");
    expect(graphFor("stockFlow").nodes).toContain("permitted");
  });

  test("join the links through a hidden stock, multiplying signs and keeping delays", () => {
    const loops = graphFor("loops");
    const throughPermitted = linkIn(loops, "starts→underConstruction");
    expect(throughPermitted?.polarity).toBe("+");
    expect(throughPermitted?.delays).toEqual(["construction"]);
    expect(throughPermitted?.via).toEqual(expect.arrayContaining(["starts→permitted", "permitted→buildingBegins", "buildingBegins→underConstruction"]));
    expect(loops.links.some((link) => link.from === "permitted" || link.to === "permitted")).toBe(false);
  });

  test("keep the named loops", () => {
    const loops = graphFor("loops");
    for (const id of ["supply", "spillover", "land", "policy", "pipeline"]) expect(loops.loops.some((loop) => loop.named.includes(id)), id).toBe(true);
  });

  test("label each construction stage with its own time constant", () => {
    const parameters = resolveParameters(model, settings);
    const stockFlow = graphFor("stockFlow");
    expect(delayYears(model, linkIn(stockFlow, "permitted→underConstruction")!, parameters)).toBe(1.5);
    expect(delayYears(model, linkIn(stockFlow, "notionalVacancy→perceivedPressure")!, parameters)).toBe(4);
  });
});

test("the model passes its checks apart from unit warnings", () => {
  // The v1 example predates parameter units and mixes households with dwellings; the unit checker is meant to say so.
  const issues = checkModel(model);
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(issues.filter((issue) => !issue.message.includes("unit") && !issue.message.startsWith("Units:"))).toEqual([]);
});

function compare(run: Run, values: Record<string, number[]>): void {
  const yearly = run.years.flatMap((year, index) => (Number.isInteger(year) ? [index] : []));
  for (const [id, expectedValues] of Object.entries(values)) {
    const actual = yearly.map((index) => run.values[id][index]);
    expect(actual.length, id).toBe(expectedValues.length);
    actual.forEach((value, index) => {
      const scale = Math.max(1, Math.abs(expectedValues[index]));
      expect(Math.abs(value - expectedValues[index]) / scale, `${id} in year ${index}`).toBeLessThan(1e-9);
    });
  }
}
