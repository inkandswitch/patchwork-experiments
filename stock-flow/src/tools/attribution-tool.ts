import { attributionView } from "../views/waterfall.ts";
import { modelBoundTool } from "./shared.ts";
import type { StockFlowAttributionDoc } from "../types.ts";

/** The Shapley waterfall, recomputed whenever the document or the model changes. */
export const AttributionTool = modelBoundTool<StockFlowAttributionDoc>("sf-attribution-tool", (model, doc) => attributionView(model, doc, doc.title));
