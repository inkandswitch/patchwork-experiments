import { scenarioSettings, withKnob } from "../engine/scenarios.ts";
import type { LoopId, Run, Settings, StockFlowModelDoc, VariableId } from "../types.ts";

export type Tab = "loops" | "stock-flow" | "run" | "equations" | "parameters" | "scenarios" | "data";

/** What the reader has picked and tweaked. Kept in the view only: the document is changed through the CLI. */
export type ViewState = {
  tab: Tab;
  scenario?: string;
  /** Loops switched off. */
  cuts: Set<LoopId>;
  /** Strength of loops left on, as the gain on the links that cut them. */
  gains: Record<LoopId, number>;
  overrides: Record<string, number>;
  /** Input curves the reader redrew, replacing the scenario's. */
  inputs: Record<VariableId, number[]>;
  /** Stock and flow boxes showing their curve. */
  expanded?: Set<VariableId>;
  allVariables: boolean;
  charted?: VariableId[];
  year?: number;
};

export type Context = { model: StockFlowModelDoc; state: ViewState; settings: Settings; run: Run; rerender: () => void };

export function initialState(): ViewState {
  return { tab: "loops", cuts: new Set(), gains: {}, overrides: {}, inputs: {}, allVariables: false };
}

export function currentSettings(model: StockFlowModelDoc, state: ViewState): Settings {
  const reference = state.cuts.size ? `${state.scenario} without ${[...state.cuts].join(" and ")}` : state.scenario!;
  let settings = scenarioSettings(model, reference);
  for (const [knob, value] of Object.entries(state.overrides)) settings = withKnob(model, settings, knob, value);
  for (const [loop, gain] of Object.entries(state.gains)) {
    if (!state.cuts.has(loop) && loop in model.annotations.loops && gain !== 1) settings = withKnob(model, settings, loop, gain);
  }
  for (const [id, curve] of Object.entries(state.inputs)) settings.inputs[id] = [...curve];
  return settings;
}

export function isTweaked(state: ViewState): boolean {
  return Boolean(state.cuts.size || Object.keys(state.overrides).length || Object.keys(state.gains).length || Object.keys(state.inputs).length);
}

export function resetTweaks(state: ViewState): void {
  state.cuts.clear();
  state.gains = {};
  state.overrides = {};
  state.inputs = {};
}
