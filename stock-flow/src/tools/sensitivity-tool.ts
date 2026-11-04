import { sensitivityView } from "../views/tornado.ts";
import { modelBoundTool } from "./shared.ts";
import type { StockFlowSensitivityDoc } from "../types.ts";

/** Tornado charts or Latin hypercube quantiles, recomputed whenever the document or the model changes. */
export const SensitivityTool = modelBoundTool<StockFlowSensitivityDoc>("sf-sensitivity-tool", (model, doc) => sensitivityView(model, doc, doc.title));
