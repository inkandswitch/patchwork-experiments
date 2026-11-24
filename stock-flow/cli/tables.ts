/**
 * Tables: one DuckDB query over named inputs. Raw CSV, JSON and Parquet files are read as they are; another table is
 * read from its stored result. Building pins every input to the version it read.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { LocalDocs } from "./local.ts";
import type { AutomergeUrl, StockFlowTableDoc, TableValue } from "../src/types.ts";

/** Runs the query against the inputs as they are on disk now, pins the inputs, and writes the result into the file. */
export async function buildTable(file: string, docs: LocalDocs): Promise<StockFlowTableDoc> {
  const table = readTable(file);
  docs.refresh(true);
  const result = await runQuery(table, docs);
  const inputs = Object.fromEntries(Object.entries(table.inputs).map(([name, url]) => [name, pinned(url, docs)]));
  const next: StockFlowTableDoc = { ...table, inputs, result };
  writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** Runs the query again and says whether it still gives the stored result, and which inputs moved since they were pinned. */
export async function checkTable(file: string, docs: LocalDocs): Promise<{ table: StockFlowTableDoc; reproduces: boolean; moved: string[]; unpinned: string[] }> {
  const table = readTable(file);
  const result = await runQuery(table, docs);
  const moved: string[] = [];
  const unpinned: string[] = [];
  for (const [name, url] of Object.entries(table.inputs)) {
    const hash = url.indexOf("#");
    if (hash < 0) unpinned.push(name);
    else if (pinned(url, docs) !== url) moved.push(name);
  }
  return { table, reproduces: JSON.stringify(result) === JSON.stringify(table.result), moved, unpinned };
}

export function readTable(file: string): StockFlowTableDoc {
  const doc = JSON.parse(readFileSync(file, "utf8")) as StockFlowTableDoc;
  if (doc["@patchwork"]?.type !== "stock-flow-table") throw new Error(`${file} is not a stock-flow-table`);
  return doc;
}

export async function runQuery(table: StockFlowTableDoc, docs: LocalDocs): Promise<Record<string, TableValue>[]> {
  const scratch = mkdtempSync(path.join(os.tmpdir(), "sf-table-"));
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    for (const [name, url] of Object.entries(table.inputs)) await connection.run(`CREATE VIEW ${identifier(name)} AS ${await inputSelect(name, url, docs, scratch)}`);
    const reader = await connection.runAndReadAll(table.query);
    return reader.getRowObjectsJS().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plainValue(value)])));
  } catch (error) {
    throw new Error(`${table.label}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    connection.closeSync();
    instance.closeSync();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** How DuckDB reads one input: a file by its type, a table from its stored result. */
async function inputSelect(name: string, url: AutomergeUrl, docs: LocalDocs, scratch: string): Promise<string> {
  const file = docs.pathOf(url);
  if (!file) throw new Error(`input "${name}" (${url}) is not in the pushwork folder ${docs.root}`);
  if (file.endsWith(".csv")) return `SELECT * FROM read_csv(${literal(file)}, nullstr = ['-', '.', 'x', '/', '...'])`;
  if (file.endsWith(".parquet")) return `SELECT * FROM read_parquet(${literal(file)})`;
  if (!file.endsWith(".json")) throw new Error(`input "${name}" is ${path.basename(file)}; DuckDB reads .csv, .json and .parquet files`);
  const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  if (doc["@patchwork"]?.type !== "stock-flow-table") return `SELECT * FROM read_json_auto(${literal(file)})`;
  const rows = (doc as StockFlowTableDoc).result;
  if (!rows.length) throw new Error(`input "${name}" (${doc.label}) has an empty result; build it first`);
  const copy = path.join(scratch, `${name}.json`);
  writeFileSync(copy, rows.map((row) => JSON.stringify(row)).join("\n"));
  return `SELECT * FROM read_json_auto(${literal(copy)}, format = 'newline_delimited')`;
}

function pinned(url: AutomergeUrl, docs: LocalDocs): AutomergeUrl {
  const entry = docs.entryOf(url);
  if (!entry) throw new Error(`${url} is not in the pushwork folder ${docs.root}`);
  return `${entry.url}#${entry.heads.join("|")}`;
}

function plainValue(value: unknown): TableValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return String(value);
}

function identifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}
