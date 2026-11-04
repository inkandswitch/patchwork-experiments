import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertFences, parseChart } from "../cli/notebook.ts";
import type { StockFlowModelDoc } from "../src/types.ts";

const dir = path.join(import.meta.dirname, "..", "examples", "aachen");
const model = JSON.parse(readFileSync(path.join(dir, "model.json"), "utf8")) as StockFlowModelDoc;
const notebooks = readdirSync(path.join(dir, "notebooks")).filter((file) => file.endsWith(".md"));

describe("notebook fences", () => {
  it.each(notebooks)("%s converts into embeds", async (file) => {
    const markdown = readFileSync(path.join(dir, "notebooks", file), "utf8");
    let count = 0;
    const converted = await convertFences(markdown, model, async (block) => `[embed ${block.kind} ${++count}]`);
    expect(count).toBeGreaterThan(0);
    expect(converted).not.toMatch(/```(chart|scenario)/);
  });

  it("reads every chart field", () => {
    expect(parseChart("title: Rent\nscenarios: real, no-surge\nseries: rent\ndata: askingRentReal\nsweep: growthResponse = 1, 0\nyears: 2000–2025\nguide: 3 normal vacancy")).toEqual({
      title: "Rent",
      scenarios: ["real", "no-surge"],
      series: ["rent"],
      data: ["askingRentReal"],
      sweep: { knob: "growthResponse", values: [1, 0] },
      years: [2000, 2025],
      guide: { value: 3, label: "normal vacancy" },
    });
  });

  it("rejects a chart that names an unknown variable", async () => {
    await expect(convertFences("```chart\nscenarios: real\nseries: nope\n```", model, async () => "")).rejects.toThrow();
  });
});
