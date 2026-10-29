// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { initSubduction, Repo } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { beforeAll, describe, expect, it } from "vitest";
import { ChartTool } from "../src/tools/chart-tool.ts";
import { ModelTool } from "../src/tools/model-tool.ts";
import { ScenarioTool } from "../src/tools/scenario-tool.ts";
import type { StockFlowChartDoc, StockFlowModelDoc, StockFlowScenarioDoc } from "../src/types.ts";

const model = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "examples", "aachen", "model.json"), "utf8")) as StockFlowModelDoc;
let repo: Repo;

beforeAll(async () => {
  await initSubduction();
  repo = new Repo({ network: [] });
});

describe("views", () => {
  it("the model viewer renders every tab", async () => {
    const handle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const element = toolElement();
    const cleanup = ModelTool(handle, element);
    const tabs = [...element.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Loops", "Run", "Equations", "Parameters", "Scenarios", "Data"]);
    expect(element.querySelector("svg [data-node=rent]")).not.toBeNull();
    for (const tab of tabs) {
      tab.click();
      expect(element.querySelector(".sf-error")).toBeNull();
      expect(element.textContent!.length).toBeGreaterThan(200);
    }
    cleanup();
    expect(element.children.length).toBe(0);
  });

  it("a chart renders a line per scenario and follows model edits", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const chart = repo.create<StockFlowChartDoc>({
      "@patchwork": { type: "stock-flow-chart" },
      model: modelHandle.url as StockFlowChartDoc["model"],
      title: "Rent",
      scenarios: ["real", "no-surge"],
      series: ["rent"],
      data: ["askingRentReal"],
    });
    const element = toolElement();
    const cleanup = ChartTool(chart, element);
    await until(() => element.querySelector("svg"));
    const before = element.querySelector("svg")!.innerHTML;
    expect(element.textContent).toContain("Aachen housing");
    modelHandle.change((doc) => {
      (doc.parameters.rentSensitivity as { value: number }).value = 0.01;
    });
    await until(() => element.querySelector("svg")!.innerHTML !== before);
    cleanup();
  });

  it("a scenario card shows its scenario", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const card = repo.create<StockFlowScenarioDoc>({ "@patchwork": { type: "stock-flow-scenario" }, model: modelHandle.url as StockFlowChartDoc["model"], scenario: "no-surge" });
    const element = toolElement();
    const cleanup = ScenarioTool(card, element);
    await until(() => element.textContent?.includes(model.scenarios["no-surge"].label));
    cleanup();
  });
});

function toolElement(): ToolElement {
  const element = document.createElement("div") as unknown as ToolElement;
  Object.assign(element, { repo });
  document.body.append(element);
  return element;
}

async function until(condition: () => unknown, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for the view");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
