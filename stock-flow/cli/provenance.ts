/**
 * `sf check --provenance`: everything a number in the folder rests on still holds. Raw files match their hashes,
 * tables reproduce their results, links resolve, fit runs kept their holdout out of the fit window, and every given
 * number says where it comes from.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { objectiveAt } from "../src/engine/fit-run.ts";
import { isLinkedModel, lookup, parseRef, resolveLink, resolveModel, type Loader } from "../src/engine/links.ts";
import type { LocalDocs } from "./local.ts";
import { checkTable } from "./tables.ts";
import type { Annotation, LinkedModelDoc, StockFlowFitDoc, StockFlowModelDoc } from "../src/types.ts";

export type ProvenanceIssue = { severity: "error" | "warning"; where: string; message: string };

export async function checkProvenance(docs: LocalDocs): Promise<ProvenanceIssue[]> {
  docs.refresh(true);
  const issues: ProvenanceIssue[] = [];
  const read = docs.loader();
  for (const { file, path: where } of docs.all()) {
    if (path.basename(file) === "datapackage.json") {
      issues.push(...checkDataPackage(file, where));
      continue;
    }
    if (!file.endsWith(".json")) continue;
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
    const type = doc["@patchwork"]?.type as string | undefined;
    if (!type) continue;
    issues.push(...(await checkAnnotations(doc, where, read)));
    if (type === "stock-flow-table") issues.push(...(await checkTableProvenance(file, where, docs)));
    else if (type === "stock-flow-fit") issues.push(...(await checkFit(doc as StockFlowFitDoc, where, docs, read)));
    else if (isLinkedModel(doc)) issues.push(...(await checkModelLinks(doc, where, read)));
    else if (typeof doc.model === "string" && type.startsWith("stock-flow-")) issues.push(...(await checkResolves(doc.model, `${where} model`, read)));
  }
  return issues;
}

/** Frictionless data package: each resource's file exists and has the sha256 the package records. */
function checkDataPackage(file: string, where: string): ProvenanceIssue[] {
  const issues: ProvenanceIssue[] = [];
  const pack = JSON.parse(readFileSync(file, "utf8")) as { resources?: { name?: string; path: string; hash?: string; sources?: unknown[] }[] };
  for (const resource of pack.resources ?? []) {
    const at = `${where} ${resource.name ?? resource.path}`;
    const target = path.join(path.dirname(file), resource.path);
    if (!existsSync(target)) {
      issues.push({ severity: "error", where: at, message: `${resource.path} is missing` });
      continue;
    }
    if (!resource.hash) issues.push({ severity: "warning", where: at, message: "no hash recorded" });
    else {
      const actual = `sha256:${createHash("sha256").update(readFileSync(target)).digest("hex")}`;
      if (resource.hash !== actual) issues.push({ severity: "error", where: at, message: `the file changed since it was recorded (${resource.hash.slice(0, 15)}… ≠ ${actual.slice(0, 15)}…)` });
    }
    if (!resource.sources?.length) issues.push({ severity: "warning", where: at, message: "no source recorded" });
  }
  return issues;
}

async function checkTableProvenance(file: string, where: string, docs: LocalDocs): Promise<ProvenanceIssue[]> {
  try {
    const { reproduces, moved, unpinned } = await checkTable(file, docs);
    return [
      ...(reproduces ? [] : [{ severity: "error" as const, where, message: "the query no longer gives the stored result; run sf table build" }]),
      ...moved.map((name) => ({
        severity: "warning" as const,
        where: `${where} inputs.${name}`,
        message: reproduces ? "changed since the table was built, though the query still gives the stored result; sf table build re-pins it" : "changed since the table was built",
      })),
      ...unpinned.map((name) => ({ severity: "warning" as const, where: `${where} inputs.${name}`, message: "not pinned; sf table build pins it" })),
    ];
  } catch (error) {
    return [{ severity: "error", where, message: error instanceof Error ? error.message : String(error) }];
  }
}

/**
 * The holdout stays out of the fit window, and the models still give the recorded objective at the fitted values.
 * Pointing parameters at the run changes a model's heads without changing its runs, so a moved model is re-run
 * rather than reported.
 */
async function checkFit(fit: StockFlowFitDoc, where: string, docs: LocalDocs, read: Loader): Promise<ProvenanceIssue[]> {
  const issues: ProvenanceIssue[] = [];
  const [from, to] = fit.objective.years;
  if (fit.holdout && fit.holdout.years[0] <= to && fit.holdout.years[1] >= from) {
    issues.push({ severity: "error", where, message: `holdout ${fit.holdout.years.join("–")} overlaps the fit window ${from}–${to}` });
  }
  const unpinned = fit.models.filter((url) => !parseRef(url).heads);
  for (const url of unpinned) issues.push({ severity: "error", where: `${where} models`, message: `${url} is not pinned, so the fitted version is unknown` });
  const moved = fit.models.map((url) => ({ url, entry: docs.entryOf(url) })).filter(({ url, entry }) => entry && entry.heads.join("|") !== parseRef(url).heads?.join("|"));
  if (moved.length && !unpinned.length) issues.push(...(await replayFit(fit, where, docs, read, moved.map(({ entry }) => entry!.path))));
  for (const id of fit.atBound) issues.push({ severity: "warning", where: `${where} values.${id}`, message: "at a bound" });
  return issues;
}

async function replayFit(fit: StockFlowFitDoc, where: string, docs: LocalDocs, read: Loader, movedPaths: string[]): Promise<ProvenanceIssue[]> {
  try {
    const models = await Promise.all(
      fit.models.map(async (url) => {
        const file = docs.pathOf(url);
        const doc = file ? JSON.parse(readFileSync(file, "utf8")) : await read(url);
        return isLinkedModel(doc) ? resolveModel(doc, read) : (doc as StockFlowModelDoc);
      }),
    );
    const spec = { scenario: fit.scenario, parameters: fit.bounds, compare: fit.objective.compare, years: fit.objective.years };
    const now = objectiveAt(models, spec, fit.values);
    if (Math.abs(now - fit.objectiveValue) <= 1e-3 * Math.max(fit.objectiveValue, 1e-9)) return [];
    return [{ severity: "warning", where: `${where} models`, message: `${movedPaths.join(", ")} changed since this fit: the objective at the fitted values is now ${now.toPrecision(4)}, not ${fit.objectiveValue.toPrecision(4)}; fit again` }];
  } catch (error) {
    return [{ severity: "error", where: `${where} models`, message: `can't re-run the fit: ${error instanceof Error ? error.message : String(error)}` }];
  }
}

/** Every parameter links to something that resolves, or carries an annotation saying where its number comes from. */
async function checkModelLinks(model: LinkedModelDoc, where: string, read: Loader): Promise<ProvenanceIssue[]> {
  const issues: ProvenanceIssue[] = [];
  const targets = new Set((model.annotations ?? []).map(({ target }) => decodeURIComponent(target)));
  for (const [id, parameter] of Object.entries(model.parameters)) {
    const at = `${where} parameters.${id}`;
    if (typeof parameter.value === "string") issues.push(...(await checkResolves(parameter.value, at, read)));
    else if (!targets.has(`./parameters/${id}/value`) && !targets.has(`./parameters/${id}`)) {
      issues.push({ severity: "error", where: at, message: `${parameter.value} has no annotation saying where it comes from` });
    }
  }
  for (const [id, scenario] of Object.entries(model.scenarios)) {
    for (const [parameter, value] of Object.entries(scenario.changes.parameters ?? {})) {
      if (typeof value === "string") issues.push(...(await checkResolves(value, `${where} scenarios.${id}.${parameter}`, read)));
    }
  }
  for (const [id, { table }] of Object.entries(model.compare)) issues.push(...(await checkResolves(table, `${where} compare.${id}`, read)));
  return issues;
}

async function checkResolves(url: string, where: string, read: Loader): Promise<ProvenanceIssue[]> {
  try {
    await resolveOrRead(url, read);
    return [];
  } catch (error) {
    return [{ severity: "error", where, message: error instanceof Error ? error.message : String(error) }];
  }
}

/** A table or a number inside a document is resolved as a parameter would be; any other document only has to exist. */
async function resolveOrRead(url: string, read: Loader): Promise<void> {
  const ref = parseRef(url);
  if (!ref.documentId) throw new Error(`"${url}" is not an automerge: URL`);
  const doc = (await read(`automerge:${ref.documentId}`)) as Record<string, any>;
  const type = doc["@patchwork"]?.type;
  if (type === "stock-flow-table" || ref.path.length) await resolveLink(url as `automerge:${string}`, read);
}

/** Relative targets exist in their document; absolute ones in theirs. Text ranges are taken on trust. */
async function checkAnnotations(doc: { annotations?: Annotation[] }, where: string, read: Loader): Promise<ProvenanceIssue[]> {
  const issues: ProvenanceIssue[] = [];
  for (const [index, { target }] of (doc.annotations ?? []).entries()) {
    if (/\/(\[|%5B)/.test(target)) continue;
    try {
      const ref = parseRef(target);
      const base = ref.documentId ? await read(`automerge:${ref.documentId}`) : doc;
      if (ref.path.length && lookup(base, ref.path) === undefined) {
        issues.push({ severity: "warning", where: `${where} annotations.${index}`, message: `${target} points at nothing` });
      }
    } catch (error) {
      issues.push({ severity: "warning", where: `${where} annotations.${index}`, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return issues;
}
