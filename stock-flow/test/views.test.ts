// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { initSubduction, Repo } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { beforeAll, describe, expect, it } from "vitest";
import { AttributionTool } from "../src/tools/attribution-tool.ts";
import { ChartTool } from "../src/tools/chart-tool.ts";
import { ModelTool } from "../src/tools/model-tool.ts";
import { ScenarioTool } from "../src/tools/scenario-tool.ts";
import { SensitivityTool } from "../src/tools/sensitivity-tool.ts";
import { TestsTool } from "../src/tools/tests-tool.ts";
import type {
  StockFlowAttributionDoc,
  StockFlowChartDoc,
  StockFlowModelDoc,
  StockFlowScenarioDoc,
  StockFlowSensitivityDoc,
  StockFlowTestsDoc,
} from "../src/types.ts";

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
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Loops", "Stock and flow", "Run", "Equations", "Parameters", "Scenarios", "Data", "Sources"]);
    expect(element.querySelector(".sf-cld .node[data-id=rent]")).not.toBeNull();
    expect(element.querySelector(".sf-cld .node[data-id=permitted]")).toBeNull();
    for (const tab of tabs) {
      tab.click();
      expect(element.querySelector(".sf-error")).toBeNull();
      expect(element.textContent!.length).toBeGreaterThan(200);
    }
    // The Sources tab is open now: data sources once each, parameters grouped by provenance.
    expect(element.textContent).toContain("Data: ");
    expect(element.textContent).toContain("No source yet");
    expect(element.querySelectorAll("h2").length).toBeGreaterThan(1);
    cleanup();
    expect(element.children.length).toBe(0);
  });

  it("the stock and flow page tweaks parameters, loops and inputs locally", async () => {
    const handle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const element = toolElement();
    const cleanup = ModelTool(handle, element);
    const tab = () => [...element.querySelectorAll<HTMLButtonElement>("nav button")].find((button) => button.textContent === "Stock and flow")!;
    tab().click();
    const spark = () => element.querySelector(".sf-sfd .spark[data-id=rent] .spark-line")!.getAttribute("d");
    const before = spark();
    expect(element.querySelector(".sf-sfd .spark-reference")).toBeNull();

    const construction = [...element.querySelectorAll<HTMLLabelElement>(".sf-field")].find((field) => field.textContent?.startsWith("Construction"))!;
    const slider = construction.querySelector("input")!;
    slider.value = "6";
    slider.dispatchEvent(new Event("input"));
    expect(construction.querySelector("output")!.textContent).toBe("6 years");
    expect(element.querySelector(".sf-sfd .link[data-from=permitted][data-to=underConstruction] .delay-label")!.textContent).toBe("3 y");
    expect(spark()).not.toBe(before);
    expect(element.querySelector(".sf-sfd .spark-reference")).not.toBeNull();

    const supply = [...element.querySelectorAll(".sf-loop-card")].find((card) => card.textContent?.includes("Supply response"))!;
    const toggle = supply.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    expect(element.querySelector(".sf-sfd .link[data-from=rent][data-to=profitability]")!.classList.contains("cut")).toBe(true);

    element.querySelector<HTMLButtonElement>(".sf-input-editor[data-input=intake] .sf-input-reset")!.click();
    expect(element.querySelector(".sf-input-intro")!.textContent).toContain("Your own curves for New students / year");

    [...element.querySelectorAll<HTMLButtonElement>("header button")].find((button) => button.textContent === "Reset")!.click();
    expect(element.querySelector(".sf-sfd .link[data-from=rent][data-to=profitability]")!.classList.contains("cut")).toBe(false);
    expect(element.querySelector(".sf-sfd .spark-reference")).toBeNull();
    expect(handle.doc().parameters.construction).toEqual(model.parameters.construction);
    cleanup();
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

  it("a chart with fit prints statistics under the plot", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const chart = repo.create<StockFlowChartDoc>({
      "@patchwork": { type: "stock-flow-chart" },
      model: modelHandle.url as StockFlowChartDoc["model"],
      title: "Rent",
      scenarios: ["real"],
      series: ["rent"],
      data: ["askingRentReal"],
      fit: { years: [2010, 2024] },
    });
    const element = toolElement();
    const cleanup = ChartTool(chart, element);
    await until(() => element.querySelector(".sf-fit"));
    expect(element.querySelector(".sf-fit")!.textContent).toMatch(/Theil U/);
    expect(element.querySelector(".sf-fit")!.textContent).toMatch(/n 15/);
    cleanup();
  });

  it("the tests table colours each row and follows model edits", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const tests = repo.create<StockFlowTestsDoc>({
      "@patchwork": { type: "stock-flow-tests" },
      model: modelHandle.url as StockFlowChartDoc["model"],
      title: "",
      scenario: "real",
      tests: [{ kind: "structure" }, { kind: "equilibrium" }, { kind: "knockout", loop: "pipeline", variable: "starts", minEffect: 0.05 }],
    });
    const element = toolElement();
    const cleanup = TestsTool(tests, element);
    await until(() => element.querySelector("tbody tr"));
    const rows = [...element.querySelectorAll("tbody tr")];
    expect(rows.map((row) => row.className)).toEqual(["warn", "pass", "fail"]);
    expect(element.querySelector(".sf-tally")!.textContent).toContain("1 passed");
    modelHandle.change((doc) => {
      (doc.parameters.pipelineResponse as { value: number }).value = 1;
    });
    await until(() => element.querySelectorAll("tbody tr")[2]?.className === "pass");
    cleanup();
  });

  it("the sensitivity view draws a tornado per outcome", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const doc = repo.create<StockFlowSensitivityDoc>({
      "@patchwork": { type: "stock-flow-sensitivity" },
      model: modelHandle.url as StockFlowChartDoc["model"],
      title: "",
      scenario: "real",
      parameters: { landYears: { min: 5, max: 30 }, rentSensitivity: { spread: 0.5 } },
      method: { kind: "one-at-a-time" },
      outcomes: [
        { kind: "value", variable: "rent", year: 2024 },
        { kind: "crossing", variable: "vacancy", level: 3, after: 2025 },
      ],
    });
    const element = toolElement();
    const cleanup = SensitivityTool(doc, element);
    await until(() => element.querySelectorAll(".sf-tornado").length === 2);
    expect(element.querySelectorAll(".sf-tornado rect.low")).toHaveLength(4);
    cleanup();
  });

  it("the attribution view draws a waterfall whose shares sum to the total", async () => {
    const modelHandle = repo.create<StockFlowModelDoc>(structuredClone(model));
    const doc = repo.create<StockFlowAttributionDoc>({
      "@patchwork": { type: "stock-flow-attribution" },
      model: modelHandle.url as StockFlowChartDoc["model"],
      title: "",
      scenario: "real",
      outcome: { kind: "change", variable: "rent", from: 2010, to: 2024, relative: true },
      drivers: { students: { label: "Students", inputs: ["intake"] }, others: { label: "Everyone else", inputs: ["population", "householdSize"] } },
    });
    const element = toolElement();
    const cleanup = AttributionTool(doc, element);
    await until(() => element.querySelector(".sf-attribution svg"));
    expect(element.querySelectorAll(".sf-attribution rect")).toHaveLength(4);
    expect(element.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(element.querySelector("tfoot")!.textContent).toContain("100%");
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
