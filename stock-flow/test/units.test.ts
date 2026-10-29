import { expect, test } from "vitest";
import { parse } from "../src/engine/expr.ts";
import { describe, parseUnit, unitIssues, unitOf, type Dimensions } from "../src/engine/units.ts";
import type { StockFlowModelDoc } from "../src/types.ts";

test("reads unit strings", () => {
  expect(parseUnit("dwellings per year")).toEqual({ dwellings: 1, year: -1 });
  expect(parseUnit("€ per m² per month, 2000 prices")).toEqual({ "€": 1, "m²": -1, month: -1 });
  expect(parseUnit("% of dwellings")).toEqual({});
  expect(parseUnit("0 = balanced, 1 = no empty flats")).toEqual({});
  expect(parseUnit("share per year")).toEqual({ year: -1 });
  expect(parseUnit("per year")).toEqual({ year: -1 });
  expect(parseUnit("dwellings’ worth of land per year")).toEqual({ dwellings: 1, year: -1 });
  expect(parseUnit("students arriving per year")).toEqual({ students: 1, year: -1 });
  expect(parseUnit("widgets")).toBeNull();
});

test("works out the unit of an expression and flags mismatches", () => {
  const known: Record<string, Dimensions> = { flats: { dwellings: 1 }, lifetime: { year: 1 }, demand: { households: 1 }, share: {} };
  const lookup = (name: string) => known[name] ?? null;
  const problems: string[] = [];
  expect(unitOf(parse("flats / lifetime"), lookup, problems)).toEqual({ dwellings: 1, year: -1 });
  expect(unitOf(parse("max(0, flats) * (1 - share)"), lookup, problems)).toEqual({ dwellings: 1 });
  expect(unitOf(parse("(flats / demand) ^ 2"), lookup, problems)).toEqual({ dwellings: 2, households: -2 });
  expect(problems).toEqual([]);
  unitOf(parse("flats - demand"), lookup, problems);
  expect(problems).toEqual(["subtracting dwellings and households"]);
  expect(unitOf(parse("flats * unknown"), lookup, [])).toBeNull();
  expect(describe({ dwellings: 1, year: -1 })).toBe("dwellings per year");
});

test("checks a model's equations, flows and initial values", () => {
  const model = {
    "@patchwork": { type: "stock-flow-model" },
    title: "",
    description: "",
    simulation: { startYear: 2000, years: 10, dt: 0.25, recordInterval: 1 },
    variables: {
      flats: { label: "", unit: "dwellings", kind: "stock", initial: "baseFlats", inflows: ["completions"], outflows: [] },
      completions: { label: "", unit: "dwellings", kind: "flow", equation: "baseFlats / lifetime" },
      households: { label: "", unit: "households", kind: "auxiliary", equation: "flats" },
    },
    parameters: {
      baseFlats: { label: "", group: "", meaning: "", format: "number", unit: "dwellings", value: 100 },
      lifetime: { label: "", group: "", meaning: "", format: "years", value: 50 },
    },
    data: {},
    scenarios: {},
    annotations: { loops: {}, links: {} },
  } as unknown as StockFlowModelDoc;
  const messages = unitIssues(model).map((issue) => issue.message);
  expect(messages).toContain("1 parameters have no unit: lifetime");
  expect(messages).toContain('Units: flow "completions" is dwellings, but the stock needs dwellings per year');
  expect(messages).toContain("Units: the equation gives dwellings, declared households");
  expect(messages.some((m) => m.includes("completions.equation"))).toBe(false);
});
