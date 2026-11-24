import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { formatter } from "../charts/resolve.ts";
import { element, renderChart } from "../charts/svg.ts";
import { parseRef } from "../engine/links.ts";
import { annotationList, rowNote } from "../views/annotations.ts";
import { errorMessage, mount, onResize, openDocument, watch } from "./shared.ts";
import type { StockFlowTableDoc } from "../types.ts";

/** A table: its result (charted when it is a value per year), the query that made it, its inputs and its notes. */
export const TableTool: ToolRender<StockFlowTableDoc> = (handle, toolElement) => {
  const { root, unmount } = mount(toolElement, "sf-linked");
  let table: StockFlowTableDoc | undefined;
  const render = () => {
    if (!table) return;
    try {
      renderTable(root, table);
    } catch (error) {
      root.replaceChildren(element("p", { class: "sf-error" }, errorMessage(error)));
    }
  };
  const stop = watch(handle, (doc) => {
    table = doc;
    render();
  });
  const stopResize = onResize(root, render);
  return () => {
    stop();
    stopResize();
    unmount();
  };
};

function renderTable(root: HTMLElement, table: StockFlowTableDoc): void {
  const header = element("header");
  header.append(element("h1", {}, table.label), element("p", { class: "sf-muted" }, `${table.unit} · ${table.result.length} rows`));
  const chart = element("div", { class: "sf-chart-box" });
  const query = element("pre", { class: "sf-query" });
  query.append(element("code", {}, table.query));
  root.replaceChildren(
    header,
    chart,
    element("h2", {}, "Query"),
    query,
    element("h2", {}, "Inputs"),
    inputList(root, table),
    element("h2", {}, "Result"),
    resultTable(table),
    element("h2", {}, "Annotations"),
    annotationList(table.annotations),
  );
  const points = yearValuePoints(table);
  if (points.length > 1) {
    renderChart(chart, { title: "", series: [{ label: table.label, points, color: "#1c7ed6", markers: true }], format: formatter(table.unit) });
  } else chart.remove();
}

function inputList(root: HTMLElement, table: StockFlowTableDoc): HTMLElement {
  const list = element("ul", { class: "sf-inputs" });
  for (const [name, url] of Object.entries(table.inputs)) {
    const item = element("li");
    const open = element("button", { title: url }, name);
    open.addEventListener("click", () => openDocument(root, `automerge:${parseRef(url).documentId}`));
    item.append(open, element("span", { class: "sf-muted" }, parseRef(url).heads ? " pinned to the version the result was built from" : " latest version (not pinned)"));
    list.append(item);
  }
  if (!list.children.length) list.append(element("li", { class: "sf-muted" }, "No inputs"));
  return list;
}

function resultTable(table: StockFlowTableDoc): HTMLElement {
  const columns = [...new Set(table.result.flatMap((row) => Object.keys(row)))];
  const grid = element("table");
  const head = element("tr");
  for (const column of [...columns, ""]) head.append(element("th", {}, column));
  grid.append(head);
  for (const row of table.result) {
    const line = element("tr");
    for (const column of columns) line.append(element("td", {}, row[column] === null || row[column] === undefined ? "–" : String(row[column])));
    const note = rowNote(table.annotations, "result", row.year);
    line.append(element("td", { class: "sf-muted" }, note ?? ""));
    grid.append(line);
  }
  return grid;
}

function yearValuePoints(table: StockFlowTableDoc): [number, number][] {
  return table.result.flatMap((row): [number, number][] => (typeof row.year === "number" && typeof row.value === "number" ? [[row.year, row.value]] : []));
}
