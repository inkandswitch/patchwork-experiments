import { describe, expect, test } from "vitest";
import { convertFences, parseAttribution, parseChart, parseSensitivity, parseTestLine, parseTests } from "../cli/notebook.ts";
import { attribute } from "../src/engine/attribution.ts";
import { checkModel } from "../src/engine/check.ts";
import { estimate } from "../src/engine/estimate.ts";
import { fitStats, statistics, valueAt } from "../src/engine/fit.ts";
import { measure, parseOutcome } from "../src/engine/outcomes.ts";
import { scenarioSettings } from "../src/engine/scenarios.ts";
import { latinHypercube, runSensitivity } from "../src/engine/sensitivity.ts";
import { simulate } from "../src/engine/simulate.ts";
import { checkTests, holdInputs, runTests } from "../src/engine/tests.ts";
import type { StockFlowModelDoc } from "../src/types.ts";
import aachen from "../examples/aachen/model.json" with { type: "json" };

const model = aachen as unknown as StockFlowModelDoc;
const real = simulate(model, scenarioSettings(model, "real"));

describe("fit statistics", () => {
  test("a perfect fit has zero error and all shares zero except covariation", () => {
    const stats = statistics([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    expect(stats.rmse).toBe(0);
    expect(stats.mape).toBe(0);
    expect(stats.r2).toBe(1);
    expect(stats.theilU).toBe(0);
  });

  test("a constant offset is all bias", () => {
    const stats = statistics([
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    expect(stats.rmse).toBeCloseTo(1);
    expect(stats.bias).toBeCloseTo(1);
    expect(stats.variation).toBeCloseTo(0);
    expect(stats.covariation).toBeCloseTo(0);
  });

  test("the Theil shares add up to one", () => {
    const stats = statistics([
      [1, 2],
      [4, 2],
      [2, 5],
      [6, 3],
    ]);
    expect(stats.bias + stats.variation + stats.covariation).toBeCloseTo(1);
    expect(stats.theilU).toBeGreaterThan(0);
    expect(stats.theilU).toBeLessThan(1);
  });

  test("reads the run at a year, scaled like the chart", () => {
    expect(valueAt(real, "rent", 2000)).toBeCloseTo(real.values.rent[0]);
    expect(valueAt(real, "rent", 1999)).toBeNaN();
    const stats = fitStats(model, real, "askingRentReal", [2010, 2024]);
    expect(stats.n).toBe(15);
    expect(stats.rmse).toBeGreaterThan(0);
    expect(fitStats(model, real, "vacancyRate").rmse).toBeLessThan(10);
  });
});

describe("outcomes", () => {
  test("parse every form", () => {
    expect(parseOutcome("rent@2024")).toEqual({ kind: "value", variable: "rent", year: 2024 });
    expect(parseOutcome("rent in 2024")).toEqual({ kind: "value", variable: "rent", year: 2024 });
    expect(parseOutcome("peak rent 2020–2040")).toEqual({ kind: "peak", variable: "rent", years: [2020, 2040] });
    expect(parseOutcome("vacancy crosses 3 after 2025")).toEqual({ kind: "crossing", variable: "vacancy", level: 3, after: 2025 });
    expect(parseOutcome("change rent 2010-2024 relative")).toEqual({ kind: "change", variable: "rent", from: 2010, to: 2024, relative: true });
    expect(() => parseOutcome("rent sometime")).toThrow();
  });

  test("measure agrees with the run", () => {
    const index = real.years.indexOf(2024);
    expect(measure(model, real, { kind: "value", variable: "rent", year: 2024 })).toBeCloseTo(real.values.rent[index]);
    expect(measure(model, real, { kind: "value", variable: "vacancy", year: 2024 })).toBeCloseTo(real.values.vacancy[index] * 100);
    const change = measure(model, real, { kind: "change", variable: "rent", from: 2010, to: 2024, relative: true });
    expect(change).toBeGreaterThan(0.1);
    const crossing = measure(model, real, { kind: "crossing", variable: "vacancy", level: 3, after: 2025 });
    expect(crossing).toBeGreaterThan(2025);
    expect(measure(model, real, { kind: "crossing", variable: "vacancy", level: 99 })).toBeNaN();
  });
});

describe("the test battery", () => {
  const fields = parseTests(`scenario: real
structure
equilibrium
integration 0.02
extreme "no new students" inputs intake=0 expect students settles 0, rent min 0
extreme "triple intake" inputs intake=3 expect vacancy between 0 100, flats finite
knockout supply starts 0.05
knockout pipeline starts 0.05
fit askingRentReal 2010–2024 mape 0.5
holdout askingRentReal fit 2010–2019 test 2020–2024`);

  test("parses each line into a spec", () => {
    expect(fields.tests.map((spec) => spec.kind)).toEqual(["structure", "equilibrium", "integration", "extreme", "extreme", "knockout", "knockout", "fit", "holdout"]);
    expect(parseTestLine('extreme "x" set landYears=5 inputs intake=0 expect rent min 4')).toEqual({
      kind: "extreme",
      label: "x",
      set: { landYears: 5 },
      inputs: { intake: 0 },
      expect: [{ variable: "rent", check: "min", value: 4 }],
    });
    expect(() => parseTestLine("knockout supply")).toThrow();
    expect(() => parseTestLine("fit askingRentReal mape")).toThrow();
    expect(() => parseTestLine("wobble")).toThrow();
  });

  test("parses indexed fits and knockouts that set a switch", () => {
    expect(parseTestLine("fit askingRentReal 2010–2019 index 2010 mape 0.1")).toEqual({ kind: "fit", data: "askingRentReal", years: [2010, 2019], index: 2010, max: { mape: 0.1 } });
    expect(parseTestLine("holdout askingRentReal fit 2010–2019 test 2020–2024 index mean")).toEqual({
      kind: "holdout",
      data: "askingRentReal",
      fitYears: [2010, 2019],
      testYears: [2020, 2024],
      index: "mean",
    });
    expect(parseTestLine("knockout growthResponse=0 starts 0.05")).toEqual({ kind: "knockout", set: { growthResponse: 0 }, variable: "starts", minEffect: 0.05 });
    expect(() => parseTestLine("fit askingRentReal index soon")).toThrow();
    expect(parseTestLine("fit completions 2005–2018 index mean lead 0–1 rmse 0.4")).toEqual({
      kind: "fit",
      data: "completions",
      years: [2005, 2018],
      index: "mean",
      lead: [0, 1],
      max: { rmse: 0.4 },
    });
    expect(() => parseTestLine("fit completions lead 1–0")).toThrow();
  });

  test("a lead compares the data with the model that many years later and keeps the best", () => {
    const shifted = structuredClone(model);
    const variable = model.data.dwellings.variable!;
    shifted.data.dwellings.points = model.data.dwellings.points.map(([year]) => [year - 1, valueAt(real, variable, year) * (model.variables[variable].scale ?? 1)]);
    const [result] = runTests(shifted, { scenario: "real", tests: [{ kind: "fit", data: "dwellings", years: [2004, 2018], lead: [0, 2] }] });
    expect(result.details!.lead).toBe(1);
    expect(result.details!.rmse).toBeCloseTo(0);
  });

  test("an indexed fit compares changes, not levels", () => {
    const doubled = structuredClone(model);
    doubled.data.askingRentReal.points = doubled.data.askingRentReal.points.map(([year, value]) => [year, value * 2]);
    const level = fitStats(doubled, real, "askingRentReal", [2010, 2019]);
    const byYear = fitStats(doubled, real, "askingRentReal", [2010, 2019], { index: 2010 });
    const byMean = fitStats(doubled, real, "askingRentReal", [2010, 2019], { index: "mean" });
    expect(byYear.rmse).toBeLessThan(level.rmse / 10);
    expect(byMean.mape).toBeCloseTo(fitStats(model, real, "askingRentReal", [2010, 2019], { index: "mean" }).mape);
    expect(() => fitStats(model, real, "askingRentReal", [2010, 2019], { index: 1990 })).toThrow(/1990/);
  });

  test("parses extremes held from a year and inert switches", () => {
    expect(parseTestLine('extreme "late flood" inputs intake=3 from 2012 expect rent finite')).toEqual({
      kind: "extreme",
      label: "late flood",
      inputs: { intake: 3 },
      from: 2012,
      expect: [{ variable: "rent", check: "finite" }],
    });
    expect(parseTestLine("inert growthResponse=0 rent,flats inputs population=1 0.02")).toEqual({
      kind: "inert",
      set: { growthResponse: 0 },
      inputs: { population: 1 },
      variables: ["rent", "flats"],
      maxEffect: 0.02,
    });
    expect(() => parseTestLine("inert rent flats")).toThrow();
  });

  test("an input held from a year follows the scenario until then", () => {
    const settings = scenarioSettings(model, "real");
    const held = holdInputs(model, settings, { intake: 3 }, 2012);
    const index = 2012 - model.simulation.startYear;
    expect(held.inputs.intake.slice(0, index)).toEqual(settings.inputs.intake.slice(0, index));
    expect(held.inputs.intake.slice(index).every((value) => value === 3)).toBe(true);
  });

  test("an inert test passes when the switch changes nothing it should not", () => {
    const [still, moved] = runTests(model, {
      scenario: "real",
      tests: [
        { kind: "inert", set: { growthResponse: 1 }, variables: ["rent", "starts"], maxEffect: 0 },
        { kind: "inert", set: { growthResponse: 0 }, variables: ["rent", "starts"], maxEffect: 0.02 },
      ],
    });
    expect(still.status).toBe("pass");
    expect(moved.status).toBe("fail");
  });

  test("a knockout that sets a switch compares against the run as it is", () => {
    const [moved, still] = runTests(model, {
      scenario: "real",
      tests: [
        { kind: "knockout", set: { growthResponse: 0 }, variable: "starts", minEffect: 0.05 },
        { kind: "knockout", set: { growthResponse: 1 }, variable: "starts", minEffect: 0.05 },
      ],
    });
    expect(moved.status).toBe("pass");
    expect(moved.summary).toMatch(/^Setting growthResponse=0 moves starts/);
    expect(still.status).toBe("fail");
    expect(still.details!.effect).toBe(0);
  });

  test("checks references before running", () => {
    expect(() => checkTests(model, fields)).not.toThrow();
    expect(() => checkTests(model, { scenario: "real", tests: [{ kind: "knockout", loop: "gravity", variable: "rent", minEffect: 0.1 }] })).toThrow(/gravity/);
    expect(() => checkTests(model, { scenario: "real", tests: [{ kind: "fit", data: "nope" }] })).toThrow(/nope/);
  });

  test("a series without a variable is shown for reference and never compared", () => {
    const reference = structuredClone(model);
    const { variable: _, ...rest } = reference.data.askingRentReal;
    reference.data.askingRentReal = rest;
    expect(checkModel(reference).filter((issue) => issue.where === "data.askingRentReal")).toEqual([]);
    expect(() => fitStats(reference, real, "askingRentReal")).toThrow(/not compared/);
    expect(() => checkTests(reference, { scenario: "real", tests: [{ kind: "fit", data: "askingRentReal" }] })).toThrow(/not compared/);
    const spec = { scenario: "real", parameters: { rentSensitivity: { min: 0.1, max: 0.5 } }, data: [{ series: "askingRentReal" }], years: [2010, 2019] as [number, number] };
    expect(() => estimate(reference, spec)).toThrow(/not compared/);
  });

  test("runs and reports what the v1 model does", () => {
    const results = runTests(model, fields);
    const status = Object.fromEntries(results.map((result) => [`${result.spec.kind}:${"label" in result.spec ? result.spec.label : "loop" in result.spec ? result.spec.loop : ""}`, result.status]));
    expect(status["structure:"]).toBe("warn");
    expect(results[0].summary).toMatch(/without a source/);
    expect(status["equilibrium:"]).toBe("pass");
    expect(status["integration:"]).toBe("pass");
    expect(status["extreme:no new students"]).toBe("pass");
    expect(status["extreme:triple intake"]).toBe("pass");
    expect(status["knockout:supply"]).toBe("pass");
    expect(status["knockout:pipeline"]).toBe("fail");
    expect(results.find((result) => result.spec.kind === "fit")!.details!.n).toBe(15);
    expect(results.find((result) => result.spec.kind === "holdout")!.status).toBe("warn");
  });

  test("a failing expectation says what went wrong", () => {
    const [result] = runTests(model, { scenario: "real", tests: [{ kind: "extreme", label: "impossible", expect: [{ variable: "rent", check: "max", value: 1 }] }] });
    expect(result.status).toBe("fail");
    expect(result.summary).toMatch(/rent rises to .* above 1/);
  });
});

describe("sensitivity", () => {
  test("one-at-a-time gives two samples per parameter around the base", () => {
    const fields = parseSensitivity(`scenario: real
parameters: landYears 5–30, rentSensitivity ±50%
outcomes: rent@2024, vacancy crosses 3 after 2025`);
    expect(fields.parameters).toEqual({ landYears: { min: 5, max: 30 }, rentSensitivity: { spread: 0.5 } });
    const result = runSensitivity(model, fields);
    expect(result.samples).toHaveLength(4);
    expect(result.ranges.rentSensitivity).toEqual({ min: 0.025, max: 0.075, value: 0.05 });
    const [low, high] = result.samples.filter((sample) => sample.varied === "landYears").map((sample) => sample.outcomes[0]);
    expect(low).toBeGreaterThan(high);
    expect(result.base[0]).toBeGreaterThan(high);
    expect(result.base[0]).toBeLessThan(low);
  });

  test("Latin hypercube samples cover every stratum and are reproducible", () => {
    const ranges = { a: { min: 0, max: 10, value: 5 }, b: { min: 100, max: 200, value: 150 } };
    const points = latinHypercube(ranges, 10, 3);
    expect(points).toHaveLength(10);
    const strata = points.map((point) => Math.floor(point.parameters.a)).sort((x, y) => x - y);
    expect(strata).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(latinHypercube(ranges, 10, 3)).toEqual(points);
    expect(latinHypercube(ranges, 10, 4)).not.toEqual(points);
  });

  test("a ranking counts wins across samples", () => {
    const fields = parseSensitivity(`scenario: real
parameters: landYears 5–30
method: latin-hypercube 6 seed 1
outcomes: rent@2040
ranking: forecast-low, forecast-high by 0 lower`);
    const result = runSensitivity(model, fields);
    expect(result.ranking).toEqual([
      { scenario: "forecast-low", wins: 1 },
      { scenario: "forecast-high", wins: 0 },
    ]);
  });

  test("rejects derived parameters and unknown methods", () => {
    expect(() => runSensitivity(model, { scenario: "real", parameters: { baseFlats: { spread: 0.1 } }, method: { kind: "one-at-a-time" }, outcomes: [] })).toThrow(/derived/);
    expect(() => parseSensitivity("scenario: real\nparameters: landYears\nmethod: dice\noutcomes: rent@2024")).toThrow(/method/);
  });
});

describe("attribution", () => {
  const fields = parseAttribution(`scenario: real
outcome: change rent 2010–2024 relative
drivers: More students = intake; More residents = population; Smaller households = householdSize`);

  test("parses drivers into ids, inputs and parameters", () => {
    expect(Object.keys(fields.drivers)).toEqual(["more-students", "more-residents", "smaller-households"]);
    expect(fields.drivers["more-students"]).toEqual({ label: "More students", inputs: ["intake"] });
    expect(parseAttribution("scenario: real\noutcome: rent@2024\ndrivers: Land = landDesignated, landYears=30").drivers.land).toEqual({
      label: "Land",
      inputs: ["landDesignated"],
      parameters: { landYears: 30 },
    });
  });

  test("Shapley shares add up to the total, whatever the interaction", () => {
    const result = attribute(model, fields);
    const sum = Object.values(result.shares).reduce((total, share) => total + share, 0);
    expect(sum).toBeCloseTo(result.total, 10);
    expect(result.total).toBeGreaterThan(0.1);
    expect(result.baseline).toBeCloseTo(0, 6);
    expect(Math.abs(result.interaction)).toBeGreaterThan(0);
    expect(Object.keys(result.oneAtATime)).toEqual(Object.keys(result.shares));
  });

  test("with one driver the share is the whole effect", () => {
    const result = attribute(model, { ...fields, drivers: { students: { label: "Students", inputs: ["intake"] } } });
    expect(result.shares.students).toBeCloseTo(result.total);
    expect(result.interaction).toBeCloseTo(0);
  });

  test("an uncertainty line puts Latin-hypercube bands on the shares", () => {
    const withBands = parseAttribution(`scenario: real
outcome: change rent 2010–2024 relative
drivers: Students = intake; Others = population, householdSize
uncertainty: rentSensitivity ±50%, landYears 5–30; 6 samples seed 2`);
    expect(withBands.uncertainty).toEqual({ parameters: { rentSensitivity: { spread: 0.5 }, landYears: { min: 5, max: 30 } }, samples: 6, seed: 2 });
    const result = attribute(model, withBands);
    expect(result.bands?.samples).toBe(6);
    for (const id of Object.keys(withBands.drivers)) {
      const band = result.bands!.shares[id];
      expect(band.low).toBeLessThanOrEqual(band.median);
      expect(band.median).toBeLessThanOrEqual(band.high);
    }
    expect(result.bands!.total.high).toBeGreaterThan(result.bands!.total.low);
    expect(attribute(model, fields).bands).toBeUndefined();
    expect(() => parseAttribution("scenario: real\noutcome: rent@2024\ndrivers: S = intake\nuncertainty: ; 3 samples")).toThrow(/at least one parameter/);
  });
});

describe("fences", () => {
  test("a chart reads its fit window", () => {
    expect(parseChart("scenarios: real\nseries: rent\ndata: askingRentReal\nfit: 2010–2024").fit).toEqual({ years: [2010, 2024] });
    expect(parseChart("scenarios: real\nseries: rent\nfit: true").fit).toBe(true);
  });

  test("tests, sensitivity and attribution fences become embeds", async () => {
    const markdown = [
      "Text",
      "```tests\nscenario: real\nstructure\nknockout supply starts\n```",
      "```sensitivity\nscenario: real\nparameters: landYears 5–30\noutcomes: rent@2024\n```",
      "```attribution\nscenario: real\noutcome: rent@2024\ndrivers: Students = intake\n```",
      "End",
    ].join("\n\n");
    const kinds: string[] = [];
    const converted = await convertFences(markdown, model, async (block) => {
      kinds.push(block.kind);
      return `[${block.kind}]`;
    });
    expect(kinds).toEqual(["tests", "sensitivity", "attribution"]);
    expect(converted).toBe("Text\n\n[tests]\n\n[sensitivity]\n\n[attribution]\n\nEnd");
  });

  test("a fence that names something the model lacks is rejected before publishing", async () => {
    await expect(convertFences("```tests\nscenario: real\nknockout gravity rent\n```", model, async () => "")).rejects.toThrow(/gravity/);
    await expect(convertFences("```attribution\nscenario: real\noutcome: rent@2024\ndrivers: X = notAnInput\n```", model, async () => "")).rejects.toThrow(/not an input/);
  });
});
