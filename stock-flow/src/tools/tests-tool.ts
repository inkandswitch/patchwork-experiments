import { testsTable } from "../views/tests-table.ts";
import { modelBoundTool } from "./shared.ts";
import type { StockFlowTestsDoc } from "../types.ts";

/** The test battery, rerun in the browser whenever the tests or the model change. */
export const TestsTool = modelBoundTool<StockFlowTestsDoc>("sf-tests-tool", (model, doc) => testsTable(model, doc, doc.title));
