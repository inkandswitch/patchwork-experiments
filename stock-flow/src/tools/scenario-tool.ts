import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { element } from "../charts/svg.ts";
import { scenarioCard } from "../views/scenario-card.ts";
import { errorMessage, mount, openDocument, watch, watchModel } from "./shared.ts";
import type { StockFlowModelDoc, StockFlowScenarioDoc } from "../types.ts";

export const ScenarioTool: ToolRender<StockFlowScenarioDoc> = (handle, toolElement) => {
  const { root, unmount } = mount(toolElement, "sf-scenario-tool");
  let card: StockFlowScenarioDoc | undefined;
  let model: StockFlowModelDoc | undefined;
  let problem: string | undefined;

  const render = () => {
    if (problem) return root.replaceChildren(element("p", { class: "sf-error" }, problem));
    if (!card || !model) return root.replaceChildren(element("p", { class: "sf-muted" }, "Loading the model…"));
    const open = element("button", { title: "Open the model" }, `Open ${model.title}`);
    open.addEventListener("click", () => openDocument(root, card!.model));
    try {
      root.replaceChildren(scenarioCard(model, card.scenario, [open]));
    } catch (error) {
      root.replaceChildren(element("p", { class: "sf-error" }, errorMessage(error)));
    }
  };

  const follow = watchModel(
    toolElement.repo,
    () => card?.model,
    (next, error) => {
      model = next;
      problem = error;
      render();
    },
  );
  const stop = watch(handle, (doc) => {
    card = doc;
    follow.refresh();
    render();
  });
  return () => {
    stop();
    follow.stop();
    unmount();
  };
};
