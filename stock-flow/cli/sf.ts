#!/usr/bin/env node
/**
 * sf: work on stock and flow models in Patchwork from the command line, so any LLM with a shell can build models,
 * run scenarios, and write analyses that embed live charts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type { DocHandle, Repo } from "@automerge/automerge-repo";
import { chartSpec, formatter } from "../src/charts/resolve.ts";
import { attribute, type AttributionFields } from "../src/engine/attribution.ts";
import { checkModel } from "../src/engine/check.ts";
import { estimate, type EstimateSpec } from "../src/engine/estimate.ts";
import { describeFit, fitStats } from "../src/engine/fit.ts";
import { causalGraph } from "../src/engine/graph.ts";
import { orderedScenarios, scenarioLabel, scenarioSettings, withKnob } from "../src/engine/scenarios.ts";
import { runSensitivity, type SensitivityFields } from "../src/engine/sensitivity.ts";
import { simulate } from "../src/engine/simulate.ts";
import { checkTests, runTests, type TestFields } from "../src/engine/tests.ts";
import { diagramSvg, layoutDiagram } from "../src/views/diagram.ts";
import {
  convertFences,
  hasFences,
  parseAttribution,
  parseFit,
  parseGuide,
  parseSensitivity,
  parseSweep,
  parseTests,
  parseYears,
  type Block,
  type ChartFields,
} from "./notebook.ts";
import { attributionReport, sensitivityReport, table, testsReport } from "./report.ts";
import { closeRepo, findDoc, openRepo, patchworkLink, waitForServerSync } from "./repo.ts";
import type {
  AutomergeUrl,
  FolderDoc,
  MarkdownDoc,
  StockFlowAttributionDoc,
  StockFlowChartDoc,
  StockFlowModelDoc,
  StockFlowScenarioDoc,
  StockFlowSensitivityDoc,
  StockFlowTestsDoc,
} from "../src/types.ts";

const HELP = `sf: stock and flow models in Patchwork

Models
  sf model new <model.json>                     create a model document from a JSON file
  sf model put <model-url> <model.json>         replace a model's contents with a JSON file
  sf show <url|file.json> [section] [--json]    summary; sections: variables parameters scenarios data loops links
  sf get <url> <path>                           print the JSON at a path, e.g. variables.rent
  sf set <url> <path> <value>                   set a value (JSON, or else a plain string)
  sf delete <url> <path>                        remove a key or list item
  sf check <model>                              equations, references, balanced run, time step, annotations

Running (offline when <model> is a .json file)
  sf run <model> <scenario> [--series a,b] [--years 2000-2025] [--every 1] [--set k=v,k=v] [--csv]
  sf graph <model> [--scenario ref] [--all | --view loops|stockFlow] [--svg out.svg]
  sf fit <model> <scenario> --data id,id [--years 2010-2024]      RMSE, MAPE, R², Theil U and its split against data series
  sf estimate <model> <scenario> --params a=5..6.5,b --data id,id*2 --years 2005-2019 [--write]
                                            bounded least squares (Nelder–Mead) over the fit window; a parameter without
                                            bounds uses its range or ±50%; *2 doubles a series' weight. --write puts the
                                            values and an "estimated" note into the model (file or document)

Validation (offline with a .json model and --spec; or pass the document's URL)
  sf tests <model> --spec <file>            Sterman's test battery: structure, equilibrium, integration, extreme, knockout, fit, holdout
  sf sensitivity <model> --spec <file>      one-at-a-time or Latin hypercube over parameter ranges, outcomes read off each run
  sf attribution <model> --spec <file>      Shapley shares of a change across drivers
  <file> is a fence body, or a markdown file whose first matching fence is used. Syntax: see SKILL.md.

Documents to embed in markdown
  sf chart new <model-url> --series a,b --scenarios ref,ref [--title t] [--data id,id] [--sweep k=1,2] [--years 2000-2040] [--guide "6 label"] [--fit]
  sf scenario new <model-url> <scenario-id>
  sf md new <file.md> [--model <model-url>]     a markdown document; chart, scenario, tests, sensitivity and attribution fences become embeds
  sf md put <md-url> <file.md> [--model <model-url>]
  sf md get <md-url>
  sf folder new <title> <url>...                a folder listing documents
  sf folder add <folder-url> <url>...

Scenario references: "real", "real without spillover and land", "real without rent→profitability".
Paths use dots, or slashes when a key has dots: data/students.cityDefinition/label.
Embed a document in markdown with [patchwork:<id without automerge:>/<tool>]; the chart and scenario commands print it.

Environment
  PATCHWORK_SYNC_SERVER   sync endpoint (default wss://subduction.sync.inkandswitch.com)
  STOCK_FLOW_MODULE_URL   where Patchwork loads the stock-flow tools from, stamped on new documents`;

const OPTIONS = {
  json: { type: "boolean" },
  csv: { type: "boolean" },
  all: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  series: { type: "string" },
  years: { type: "string" },
  every: { type: "string" },
  set: { type: "string" },
  scenario: { type: "string" },
  view: { type: "string" },
  scenarios: { type: "string" },
  svg: { type: "string" },
  title: { type: "string" },
  data: { type: "string" },
  sweep: { type: "string" },
  guide: { type: "string" },
  model: { type: "string" },
  spec: { type: "string" },
  fit: { type: "boolean" },
  params: { type: "string" },
  write: { type: "boolean" },
} as const;

type Options = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

async function main(): Promise<void> {
  const { values: options, positionals } = parseArgs({ options: OPTIONS, allowPositionals: true });
  const [command, ...args] = positionals;
  if (!command || options.help) return console.log(HELP);
  const grouped = COMMANDS[`${command} ${args[0]}`];
  const [run, rest] = grouped ? [grouped, args.slice(1)] : [COMMANDS[command], args];
  if (!run) throw new Error(`Unknown command "${command}". Run sf --help.`);
  await run(rest, options);
}

type Command = (args: string[], options: Options) => Promise<void>;

const COMMANDS: Record<string, Command> = {
  "model new": async ([file]) =>
    withRepo(async (repo) => {
      const model = readModelFile(required(file, "model.json"));
      const handle = repo.create<StockFlowModelDoc>(stamped<StockFlowModelDoc>(model));
      await report(repo, handle, "Model");
    }),

  "model put": async ([url, file]) =>
    withRepo(async (repo) => {
      const model = readModelFile(required(file, "model.json"));
      const handle = await findDoc<StockFlowModelDoc>(repo, required(url, "model-url"));
      handle.change((doc) => {
        const target = doc as unknown as Record<string, unknown>;
        for (const key of Object.keys(target)) if (key !== "@patchwork" && !(key in model)) delete target[key];
        for (const [key, value] of Object.entries(model)) if (key !== "@patchwork") target[key] = value;
      });
      await report(repo, handle, "Model");
    }),

  show: async ([target, section], options) => {
    const doc = await readAny(required(target, "url"));
    if (options.json) return print(JSON.stringify(section ? at(doc, section) : doc, null, 2));
    print(summarize(doc, section));
  },

  get: async ([url, docPath]) => print(JSON.stringify(at(await readAny(required(url, "url")), required(docPath, "path")), null, 2)),

  set: async ([url, docPath, value]) =>
    withRepo(async (repo) => {
      const handle = await findDoc<Record<string, unknown>>(repo, required(url, "url"));
      const parsed = parseValue(required(value, "value"));
      handle.change((doc) => setAt(doc, required(docPath, "path"), parsed));
      await report(repo, handle, "Changed");
    }),

  delete: async ([url, docPath]) =>
    withRepo(async (repo) => {
      const handle = await findDoc<Record<string, unknown>>(repo, required(url, "url"));
      handle.change((doc) => deleteAt(doc, required(docPath, "path")));
      await report(repo, handle, "Changed");
    }),

  check: async ([target]) => {
    const model = await readModel(required(target, "model"));
    const issues = checkModel(model);
    if (!issues.length) return print("No issues.");
    for (const issue of issues) print(`${issue.severity === "error" ? "error  " : "warning"} ${issue.where}: ${issue.message}`);
    if (issues.some((issue) => issue.severity === "error")) process.exitCode = 1;
  },

  run: async ([target, reference], options) => {
    const model = await readModel(required(target, "model"));
    const ref = reference ?? orderedScenarios(model)[0]?.[0] ?? "balanced";
    let settings = scenarioSettings(model, ref);
    for (const pair of list(options.set)) {
      const [knob, value] = pair.split("=");
      settings = withKnob(model, settings, knob.trim(), Number(value));
    }
    const run = simulate(model, settings);
    const series = list(options.series).length ? list(options.series) : defaultSeries(model);
    for (const id of series) if (!(id in model.variables)) throw new Error(`Unknown variable "${id}"`);
    const years = options.years ? parseYears(options.years) : undefined;
    const every = Number(options.every ?? 1);
    const rows = run.years.flatMap((year, index) => {
      const step = (year - run.years[0]) / every;
      if (Math.abs(step - Math.round(step)) > 1e-9 || (years && (year < years[0] || year > years[1]))) return [];
      return [[year, ...series.map((id) => run.values[id][index] * (model.variables[id].scale ?? 1))]];
    });
    if (options.csv) return print([["year", ...series].join(","), ...rows.map((row) => row.join(","))].join("\n"));
    print(`${scenarioLabel(model, ref)}${options.set ? ` with ${options.set}` : ""}`);
    print(table(["year", ...series], rows.map(([year, ...values]) => [String(year), ...values.map((value, i) => formatter(model.variables[series[i]].unit)(value))])));
    print(`Units: ${series.map((id) => `${id} ${model.variables[id].unit}`).join("; ")}`);
  },

  fit: async ([target, reference], options) => {
    const model = await readModel(required(target, "model"));
    const ref = required(reference, "scenario");
    const run = simulate(model, scenarioSettings(model, ref));
    const ids = list(options.data);
    if (!ids.length) throw new Error("Name the data series to fit against with --data id,id");
    const years = options.years ? parseYears(options.years) : undefined;
    print(`${scenarioLabel(model, ref)} against data${years ? ` ${years[0]}–${years[1]}` : ""}`);
    for (const id of ids) {
      if (!(id in model.data)) throw new Error(`Unknown data series "${id}"`);
      print(`  ${id} (${model.variables[model.data[id].variable].label}): ${describeFit(fitStats(model, run, id, years), formatter(model.data[id].unit))}`);
    }
  },

  estimate: async ([target, reference], options) => {
    const file = required(target, "model");
    const model = await readModel(file);
    const spec = estimateSpec(model, required(reference, "scenario"), options);
    const result = estimate(model, spec);
    print(`${scenarioLabel(model, spec.scenario)}: ${Object.keys(spec.parameters).length} parameters against ${spec.data.map((d) => d.series).join(", ")} ${spec.years[0]}–${spec.years[1]}`);
    print(`Loss ${result.loss.initial.toPrecision(4)} → ${result.loss.final.toPrecision(4)} in ${result.evaluations} runs`);
    print(
      table(
        ["parameter", "before", "after", "bounds"],
        Object.entries(result.values).map(([id, value]) => [
          id + (result.atBound.includes(id) ? " (at bound)" : ""),
          String(tidyNumber(result.initial[id])),
          String(tidyNumber(value)),
          `${spec.parameters[id].min}–${spec.parameters[id].max}`,
        ]),
      ),
    );
    for (const [id, stats] of Object.entries(result.fits)) print(`  ${id}: ${describeFit(stats, formatter(model.data[id].unit))}`);
    if (!options.write) return;
    const estimated = {
      from: spec.data.map((d) => d.series),
      years: spec.years,
      method: `Bounded least squares (Nelder–Mead) on normalised squared error, sf estimate, ${new Date().toISOString().slice(0, 10)}`,
    };
    if (file.startsWith("automerge:")) {
      await withRepo(async (repo) => {
        const handle = await findDoc<StockFlowModelDoc>(repo, file);
        handle.change((doc) => {
          for (const [id, value] of Object.entries(result.values)) {
            (doc.parameters[id] as { value: number }).value = tidyNumber(value);
            doc.parameters[id].estimated = { ...estimated, range: spec.parameters[id] };
          }
        });
        await waitForServerSync(repo, handle);
      });
    } else {
      const json = JSON.parse(readFileSync(file, "utf8")) as StockFlowModelDoc;
      for (const [id, value] of Object.entries(result.values)) {
        (json.parameters[id] as { value: number }).value = tidyNumber(value);
        json.parameters[id].estimated = { ...estimated, range: spec.parameters[id] };
      }
      writeFileSync(file, JSON.stringify(json, null, 1) + "\n");
    }
    print(`Wrote ${Object.keys(result.values).length} estimated values to ${file}`);
  },

  tests: async ([target], options) => {
    const { model, fields } = await validationInput<TestFields>(target, options, "tests", parseTests);
    checkTests(model, fields);
    const results = runTests(model, fields);
    print(testsReport(results));
    if (results.some((result) => result.status === "fail")) process.exitCode = 1;
  },

  sensitivity: async ([target], options) => {
    const { model, fields } = await validationInput<SensitivityFields>(target, options, "sensitivity", parseSensitivity);
    print(sensitivityReport(model, fields, runSensitivity(model, fields)));
  },

  attribution: async ([target], options) => {
    const { model, fields } = await validationInput<AttributionFields>(target, options, "attribution", parseAttribution);
    print(attributionReport(model, fields, attribute(model, fields)));
  },

  graph: async ([target], options) => {
    const model = await readModel(required(target, "model"));
    const reference = options.scenario ?? orderedScenarios(model)[0]?.[0] ?? "balanced";
    const settings = scenarioSettings(model, reference);
    const view = options.view as keyof NonNullable<StockFlowModelDoc["layout"]> | undefined;
    if (view && !model.layout?.[view]) throw new Error(`The model has no "${options.view}" layout; it has ${Object.keys(model.layout ?? {}).join(", ") || "none"}`);
    const visible = view ? Object.keys(model.layout![view]!.nodes) : undefined;
    const graph = causalGraph(model, simulate(model, settings), settings, visible ? { visible } : { all: options.all });
    if (options.svg) {
      writeFileSync(options.svg, diagramSvg(model, graph, layoutDiagram(model, graph), true));
      print(`Wrote ${options.svg}`);
    }
    print(`Links, with signs as they act in "${scenarioLabel(model, reference)}":`);
    for (const link of graph.links) {
      const between = [...new Set(link.via.flatMap((via) => via.split("→")))].filter((id) => id !== link.from && id !== link.to);
      print(
        `  ${link.polarity}  ${link.from} → ${link.to}${link.delays.length ? `  delayed by ${link.delays.join(", ")}` : ""}${between.length ? `  (through ${between.join(", ")})` : ""}`,
      );
    }
    print(`\nLoops (${graph.loops.length}):`);
    for (const loop of graph.loops) {
      const names = loop.named.map((id) => `${model.annotations.loops[id].label} ${model.annotations.loops[id].name}`).join(", ");
      print(`  ${loop.polarity.padEnd(11)} ${names ? `[${names}] ` : ""}${loop.variables.join(" → ")}`);
    }
  },

  "chart new": async ([url], options) =>
    withRepo(async (repo) => {
      const modelUrl = required(url, "model-url") as AutomergeUrl;
      const model = await readModel(modelUrl, repo);
      const fields: ChartFields = {
        title: options.title ?? "",
        scenarios: list(options.scenarios),
        series: list(options.series),
        data: list(options.data),
        ...(options.sweep ? { sweep: parseSweep(options.sweep.replace(/^([^=]+)=/, "$1 = ")) } : {}),
        ...(options.years ? { years: parseYears(options.years) } : {}),
        ...(options.guide ? { guide: parseGuide(options.guide) } : {}),
        ...(options.fit ? { fit: parseFit("true") } : {}),
      };
      const handle = await createChart(repo, model, modelUrl, fields);
      await report(repo, handle, "Chart");
      print(`Embed: ${embedSyntax(handle.url, "stock-flow-chart")}`);
    }),

  "scenario new": async ([url, scenario]) =>
    withRepo(async (repo) => {
      const modelUrl = required(url, "model-url") as AutomergeUrl;
      const model = await readModel(modelUrl, repo);
      if (!(required(scenario, "scenario-id") in model.scenarios)) throw new Error(`Unknown scenario "${scenario}"`);
      const handle = repo.create<StockFlowScenarioDoc>(stamped<StockFlowScenarioDoc>({ "@patchwork": { type: "stock-flow-scenario" }, model: modelUrl, scenario }));
      await report(repo, handle, "Scenario");
      print(`Embed: ${embedSyntax(handle.url, "stock-flow-scenario")}`);
    }),

  "md new": async ([file], options) =>
    withRepo(async (repo) => {
      const content = await markdownWithEmbeds(repo, readFileSync(required(file, "file.md"), "utf8"), options.model);
      const handle = repo.create<MarkdownDoc>({ "@patchwork": { type: "markdown" }, content });
      await report(repo, handle, "Markdown");
    }),

  "md put": async ([url, file], options) =>
    withRepo(async (repo) => {
      const handle = await findDoc<MarkdownDoc>(repo, required(url, "md-url"));
      const content = await markdownWithEmbeds(repo, readFileSync(required(file, "file.md"), "utf8"), options.model);
      handle.change((doc) => {
        doc.content = content;
      });
      await report(repo, handle, "Markdown");
    }),

  "md get": async ([url]) => print(((await readAny(required(url, "md-url"))) as MarkdownDoc).content),

  "folder new": async ([title, ...urls]) =>
    withRepo(async (repo) => {
      const docs = await folderEntries(repo, urls);
      const handle = repo.create<FolderDoc>({ "@patchwork": { type: "folder" }, title: required(title, "title"), docs });
      await report(repo, handle, "Folder");
    }),

  "folder add": async ([url, ...urls]) =>
    withRepo(async (repo) => {
      const handle = await findDoc<FolderDoc>(repo, required(url, "folder-url"));
      const docs = await folderEntries(repo, urls);
      handle.change((doc) => {
        for (const entry of docs) doc.docs.push(entry);
      });
      await report(repo, handle, "Folder");
    }),
};

async function createChart(repo: Repo, model: StockFlowModelDoc, modelUrl: AutomergeUrl, fields: ChartFields): Promise<DocHandle<StockFlowChartDoc>> {
  chartSpec(model, fields);
  return repo.create<StockFlowChartDoc>(stamped<StockFlowChartDoc>({ "@patchwork": { type: "stock-flow-chart" }, model: modelUrl, ...fields }));
}

/** Turns chart, scenario, tests, sensitivity and attribution fences into documents embedded in the markdown. */
async function markdownWithEmbeds(repo: Repo, markdown: string, modelUrl: string | undefined): Promise<string> {
  if (!hasFences(markdown)) return markdown;
  if (!modelUrl) throw new Error("This markdown has chart, scenario or validation blocks; pass --model <model-url> for them to run");
  const model = await readModel(modelUrl, repo);
  const created: DocHandle<unknown>[] = [];
  const url = modelUrl as AutomergeUrl;
  const content = await convertFences(markdown, model, async (block: Block) => {
    if (block.kind === "chart") {
      const handle = await createChart(repo, model, url, block.fields);
      created.push(handle);
      return embedSyntax(handle.url, "stock-flow-chart");
    }
    if (block.kind === "tests") {
      const handle = repo.create<StockFlowTestsDoc>(stamped<StockFlowTestsDoc>({ "@patchwork": { type: "stock-flow-tests" }, title: "", model: url, ...block.fields }));
      created.push(handle);
      return embedSyntax(handle.url, "stock-flow-tests");
    }
    if (block.kind === "sensitivity") {
      const handle = repo.create<StockFlowSensitivityDoc>(stamped<StockFlowSensitivityDoc>({ "@patchwork": { type: "stock-flow-sensitivity" }, title: "", model: url, ...block.fields }));
      created.push(handle);
      return embedSyntax(handle.url, "stock-flow-sensitivity");
    }
    if (block.kind === "attribution") {
      const handle = repo.create<StockFlowAttributionDoc>(stamped<StockFlowAttributionDoc>({ "@patchwork": { type: "stock-flow-attribution" }, title: "", model: url, ...block.fields }));
      created.push(handle);
      return embedSyntax(handle.url, "stock-flow-attribution");
    }
    const embeds = block.scenarios.map((scenario) => {
      const handle = repo.create<StockFlowScenarioDoc>(
        stamped<StockFlowScenarioDoc>({ "@patchwork": { type: "stock-flow-scenario" }, model: modelUrl as AutomergeUrl, scenario }),
      );
      created.push(handle);
      return embedSyntax(handle.url, "stock-flow-scenario");
    });
    return embeds.join("\n\n");
  });
  for (const handle of created) await waitForServerSync(repo, handle);
  print(`Created ${created.length} embedded documents.`);
  return content;
}

type ValidationKind = "tests" | "sensitivity" | "attribution";

/**
 * The model and fields for a validation command: from a stock-flow-<kind> document's URL, or from a model plus a
 * --spec file holding a fence body or a markdown file with a matching fence.
 */
async function validationInput<Fields>(target: string | undefined, options: Options, kind: ValidationKind, parse: (source: string) => Fields): Promise<{ model: StockFlowModelDoc; fields: Fields }> {
  const where = required(target, `model or ${kind} url`);
  if (where.startsWith("automerge:")) {
    const doc = await readAny(where);
    const type = doc["@patchwork"]?.type;
    if (type === `stock-flow-${kind}`) {
      const { "@patchwork": _, title, model: modelUrl, ...fields } = doc;
      return { model: await readModel(modelUrl), fields: fields as Fields };
    }
    if (type !== "stock-flow-model") throw new Error(`${where} is a ${type ?? "unknown"} document, not a model or stock-flow-${kind}`);
  }
  const model = await readModel(where);
  if (!options.spec) throw new Error(`Pass --spec <file> with a ${kind} fence body (or a markdown file containing one)`);
  if (!existsSync(options.spec)) throw new Error(`No such file: ${options.spec}`);
  const text = readFileSync(options.spec, "utf8");
  const fence = new RegExp("```" + kind + "[^\\S\\n]*\\n([\\s\\S]*?)```").exec(text);
  return { model, fields: parse(fence ? fence[1] : text) };
}

async function folderEntries(repo: Repo, urls: string[]): Promise<FolderDoc["docs"]> {
  const entries: FolderDoc["docs"] = [];
  for (const url of urls) {
    const doc = (await findDoc<Record<string, unknown>>(repo, url)).doc() as Record<string, any>;
    const type = doc["@patchwork"]?.type ?? "unknown";
    entries.push({ name: titleOf(doc), type, url: url as AutomergeUrl });
  }
  return entries;
}

function titleOf(doc: Record<string, any>): string {
  if (typeof doc.title === "string" && doc.title) return doc.title;
  if (typeof doc.content === "string") return /(^|\n)#\s+(.+)/.exec(doc.content)?.[2] ?? "Untitled";
  return doc.scenario ? `Scenario ${doc.scenario}` : "Untitled";
}

function summarize(doc: Record<string, any>, section?: string): string {
  const type = doc["@patchwork"]?.type;
  if (type !== "stock-flow-model") {
    if (type === "markdown") return doc.content;
    return JSON.stringify(doc, null, 2);
  }
  const model = doc as StockFlowModelDoc;
  const lines: string[] = [];
  const show = (name: string) => !section || section === name;
  if (!section) {
    const kinds = Object.values(model.variables).reduce<Record<string, number>>((counts, variable) => {
      counts[variable.kind] = (counts[variable.kind] ?? 0) + 1;
      return counts;
    }, {});
    lines.push(`${model.title}`, model.description, "");
    lines.push(
      `${Object.entries(kinds).map(([kind, count]) => `${count} ${kind === "auxiliary" ? "auxiliaries" : `${kind}s`}`).join(", ")}; ${Object.keys(model.parameters).length} parameters; ${Object.keys(model.scenarios).length} scenarios; ${Object.keys(model.data).length} data series`,
    );
    lines.push(`Runs ${model.simulation.years} years from ${model.simulation.startYear}, dt ${model.simulation.dt}`, "");
  }
  if (show("variables")) {
    lines.push("Variables:");
    for (const [id, variable] of Object.entries(model.variables)) {
      const formula = variable.kind === "stock" ? `+${variable.inflows.join(" +")} −${variable.outflows.join(" −")}; starts at ${variable.initial}` : variable.kind === "input" ? `${variable.base} × curve` : variable.equation;
      lines.push(`  ${variable.kind.padEnd(9)} ${id}${variable.key ? " *" : ""} = ${formula}   [${variable.unit}]`);
    }
    lines.push("  (* key variable in the loop view)", "");
  }
  if (show("parameters")) {
    lines.push("Parameters:");
    for (const [id, parameter] of Object.entries(model.parameters)) {
      lines.push(`  ${id} = ${"value" in parameter ? parameter.value : parameter.derived}${parameter.delay ? "  (delay)" : ""}   ${parameter.meaning}`);
    }
    lines.push("");
  }
  if (show("scenarios")) {
    lines.push("Scenarios:");
    for (const [id, scenario] of orderedScenarios(model)) {
      const changes = Object.entries(scenario.changes).map(([kind, value]) => `${kind}: ${Object.keys(value as object).join(", ") || value}`);
      lines.push(`  ${id}: ${scenario.label}${scenario.base ? ` (on ${scenario.base})` : ""}${changes.length ? ` — changes ${changes.join("; ")}` : ""}`);
    }
    lines.push("");
  }
  if (show("loops")) {
    lines.push("Named loops:");
    for (const [id, loop] of Object.entries(model.annotations.loops)) lines.push(`  ${id}: ${loop.label} ${loop.name}, cut by ${loop.cut.join(", ")}`);
    lines.push("");
  }
  if (section === "links") for (const [key, text] of Object.entries(model.annotations.links)) lines.push(`  ${key}: ${text}`);
  if (section === "data") {
    for (const [id, series] of Object.entries(model.data)) lines.push(`  ${id}: ${series.label} [${series.unit}] vs ${series.variable}, ${series.points.length} points`);
  }
  return lines.join("\n");
}

function defaultSeries(model: StockFlowModelDoc): string[] {
  const ids = Object.keys(model.variables);
  const keyStocks = ids.filter((id) => model.variables[id].kind === "stock" && model.variables[id].key);
  return (keyStocks.length ? keyStocks : ids.filter((id) => model.variables[id].kind === "stock")).slice(0, 6);
}

/** --params a=5..6.5,b  --data rent,vacancy*2  --years 2005-2019 */
function estimateSpec(model: StockFlowModelDoc, scenario: string, options: Options): EstimateSpec {
  const settings = scenarioSettings(model, scenario);
  const parameters = Object.fromEntries(
    list(options.params).map((entry) => {
      const [id, bounds] = entry.split("=");
      const parameter = model.parameters[id];
      if (!parameter) throw new Error(`Unknown parameter "${id}"`);
      if (bounds) {
        const [min, max] = bounds.split("..").map(Number);
        if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error(`Bounds for ${id} must look like 5..6.5`);
        return [id, { min, max }];
      }
      if (parameter.range) return [id, { min: parameter.range.min, max: parameter.range.max }];
      const value = settings.parameters[id] ?? ("value" in parameter ? parameter.value : NaN);
      return [id, { min: Math.min(value * 0.5, value * 1.5), max: Math.max(value * 0.5, value * 1.5) }];
    }),
  );
  if (!Object.keys(parameters).length) throw new Error("Name the parameters to estimate with --params a,b");
  const data = list(options.data).map((entry) => {
    const [series, weight] = entry.split("*");
    return { series, weight: weight ? Number(weight) : 1 };
  });
  if (!options.years) throw new Error("Give the fit window with --years 2005-2019");
  return { scenario, parameters, data, years: parseYears(options.years) };
}

function tidyNumber(value: number): number {
  return Number(value.toPrecision(4));
}

async function readModel(target: string, repo?: Repo): Promise<StockFlowModelDoc> {
  const doc = repo && target.startsWith("automerge:") ? plain((await findDoc(repo, target)).doc()) : await readAny(target);
  if ((doc as any)["@patchwork"]?.type !== "stock-flow-model") throw new Error(`${target} is not a stock-flow-model`);
  return doc as StockFlowModelDoc;
}

async function readAny(target: string): Promise<Record<string, any>> {
  if (!target.startsWith("automerge:")) {
    if (!existsSync(target)) throw new Error(`No such file: ${target}`);
    return JSON.parse(readFileSync(target, "utf8"));
  }
  return withRepo(async (repo) => plain((await findDoc(repo, target)).doc()));
}

function readModelFile(file: string): StockFlowModelDoc {
  const model = JSON.parse(readFileSync(file, "utf8")) as StockFlowModelDoc;
  model["@patchwork"] = { type: "stock-flow-model" };
  const errors = checkModel(model).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`The model has errors:\n${errors.map((issue) => `  ${issue.where}: ${issue.message}`).join("\n")}`);
  return model;
}

/** Points new documents at the module that renders them, for Patchwork instances that don't have it installed. */
function stamped<T extends { "@patchwork": { type: string; suggestedImportUrl?: string } }>(doc: T): T {
  const moduleUrl = process.env.STOCK_FLOW_MODULE_URL ?? pushworkUrl();
  if (moduleUrl) doc["@patchwork"] = { ...doc["@patchwork"], suggestedImportUrl: moduleUrl };
  return doc;
}

function pushworkUrl(): string | undefined {
  const config = path.join(import.meta.dirname, "..", ".pushwork", "config.json");
  return existsSync(config) ? JSON.parse(readFileSync(config, "utf8")).rootUrl : undefined;
}

function embedSyntax(url: string, tool: string): string {
  return `[patchwork:${url.replace(/^automerge:/, "")}/${tool}]`;
}

async function report(repo: Repo, handle: DocHandle<unknown>, what: string): Promise<void> {
  const synced = await waitForServerSync(repo, handle);
  print(`${what}: ${handle.url}${synced ? "" : "  (PENDING: not confirmed by the sync server yet)"}`);
  print(`  ${patchworkLink(handle.url)}`);
}

let shared: Promise<Repo> | undefined;

/** One repo per process, closed when the command finishes. */
async function withRepo<T>(work: (repo: Repo) => Promise<T>): Promise<T> {
  shared ??= openRepo();
  return work(await shared);
}

function pathParts(docPath: string): string[] {
  return docPath.includes("/") ? docPath.split("/").filter(Boolean) : docPath.split(".");
}

function at(doc: unknown, docPath: string): unknown {
  let value: any = doc;
  for (const part of pathParts(docPath)) {
    if (value === undefined || value === null) throw new Error(`Nothing at "${docPath}"`);
    value = value[part];
  }
  if (value === undefined) throw new Error(`Nothing at "${docPath}"`);
  return value;
}

function setAt(doc: Record<string, any>, docPath: string, value: unknown): void {
  const parts = pathParts(docPath);
  const last = parts.pop()!;
  let target: any = doc;
  for (const part of parts) {
    if (target[part] === undefined) target[part] = {};
    target = target[part];
  }
  if (Array.isArray(target)) target[Number(last)] = value;
  else target[last] = value;
}

function deleteAt(doc: Record<string, any>, docPath: string): void {
  const parts = pathParts(docPath);
  const last = parts.pop()!;
  const target = at(doc, parts.join("/") || "") as any;
  if (Array.isArray(target)) target.splice(Number(last), 1);
  else delete target[last];
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function plain<T>(doc: T): T {
  return JSON.parse(JSON.stringify(doc));
}

function list(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing <${name}>. Run sf --help.`);
  return value;
}

function print(text: string): void {
  console.log(text);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!shared) return;
    await closeRepo(await shared);
    process.exit();
  });
