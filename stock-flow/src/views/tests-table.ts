import { element, escapeHtml } from "../charts/svg.ts";
import { runTests, testLabel, type TestFields } from "../engine/tests.ts";
import type { StockFlowModelDoc, TestResult } from "../types.ts";

/** The test battery as a table: one row per test, coloured by status, with the summary and a tally. */
export function testsTable(model: StockFlowModelDoc, fields: TestFields, title = ""): HTMLElement {
  const results = runTests(model, fields);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const result of results) counts[result.status]++;
  const box = element("div", { class: "sf-tests" });
  box.innerHTML = `
    <header>
      <h3>${escapeHtml(title || `Model tests on "${escapeHtml(model.scenarios[fields.scenario]?.label ?? fields.scenario)}"`)}</h3>
      <span class="sf-tally">
        <span class="pass">${counts.pass} passed</span> · <span class="warn">${counts.warn} warning${counts.warn === 1 ? "" : "s"}</span> · <span class="fail">${counts.fail} failed</span>
      </span>
    </header>
    <table>
      <thead><tr><th></th><th>Test</th><th>Result</th></tr></thead>
      <tbody>${results.map(row).join("")}</tbody>
    </table>
    <p class="sf-hint">Passing proves nothing (Sterman §21.1); the battery exists to show where the model fails and whether a change broke something it used to do.</p>`;
  return box;
}

function row(result: TestResult): string {
  const details = result.details
    ? `<details><summary>numbers</summary><code>${escapeHtml(
        Object.entries(result.details)
          .map(([key, value]) => `${key} ${Number.isFinite(value) ? Number(value.toPrecision(4)) : value}`)
          .join("\n"),
      )}</code></details>`
    : "";
  return `<tr class="${result.status}">
    <td class="sf-status"><span class="sf-dot" title="${result.status}"></span></td>
    <td>${escapeHtml(testLabel(result.spec))}</td>
    <td>${escapeHtml(result.summary)}${details}</td>
  </tr>`;
}
