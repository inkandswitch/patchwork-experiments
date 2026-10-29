export type AutomergeUrl = `automerge:${string}`;

export type PatchworkMeta<T extends string> = { type: T; suggestedImportUrl?: string };

/** The model: variables and equations, parameters, the data it is compared with, and the scenarios that run it. */
export type StockFlowModelDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-model">;
  title: string;
  description: string;
  simulation: Simulation;
  variables: Record<VariableId, Variable>;
  parameters: Record<ParameterId, Parameter>;
  data: Record<SeriesId, DataSeries>;
  scenarios: Record<ScenarioId, Scenario>;
  /** Prose about the structure the loop view derives from the equations. */
  annotations: Annotations;
};

/** One chart over one model, embeddable in markdown as [patchwork:<documentId>/stock-flow-chart]. */
export type StockFlowChartDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-chart">;
  title: string;
  model: AutomergeUrl;
  /** Scenario references: "real", "real without spillover", "real without rent→profitability". */
  scenarios: string[];
  series: VariableId[];
  data: SeriesId[];
  sweep?: { knob: string; values: number[] };
  years?: [number, number];
  guide?: { value: number; label: string };
};

/** A scenario's question, expectation, input curves and changes, embeddable as [patchwork:<documentId>/stock-flow-scenario]. */
export type StockFlowScenarioDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-scenario">;
  model: AutomergeUrl;
  scenario: ScenarioId;
};

export type VariableId = string;
export type ParameterId = string;
export type SeriesId = string;
export type ScenarioId = string;
export type LoopId = string;

/**
 * An arithmetic expression over variables, parameters and `time` (model years since the start):
 * `min(desiredStarts, maxStarts)`. Operators + − * / ^, functions min, max, clamp, abs, exp, ln, sqrt.
 * Initial values and derived parameters may also call `inputAt(input, year)`.
 */
export type Expr = string;

export type Simulation = {
  /** Calendar year of model year 0, for charts next to real data. */
  startYear: number;
  years: number;
  dt: number;
  recordInterval: number;
};

export type Variable = {
  label: string;
  unit: string;
  description?: string;
  /** Multiply by this for charts, e.g. 100 for a share shown in %. */
  scale?: number;
  /** Drawn in the loop view; the variables in between are folded into the links between key variables. */
  key?: boolean;
} & VariableKind;

export type VariableKind =
  | { kind: "stock"; initial: Expr; inflows: VariableId[]; outflows: VariableId[] }
  | { kind: "flow"; equation: Expr }
  | { kind: "auxiliary"; equation: Expr }
  /** A driver drawn over time: scenarios give one multiplier per model year; `base` is what a multiplier of 1 stands for. */
  | { kind: "input"; base: Expr; range: [min: number, max: number] };

export type Parameter = {
  label: string;
  /** Grouping in the parameter table: "Students", "Land", "Delays", … */
  group: string;
  meaning: string;
  format: "number" | "percent" | "years" | "currency";
  /** Shown as a slider in the viewer. */
  range?: { min: number; max: number; step: number };
  /** A delay time. The links it delays are found from the equations that mention it. */
  delay?: { kind: string; shape: string };
} & ({ value: number } | { derived: Expr });

export type DataSeries = {
  label: string;
  unit: string;
  /** The model variable it is compared with. */
  variable: VariableId;
  points: [year: number, value: number][];
  source: DataSource;
  notes: string[];
  /** Where each value came from, when values come from different editions or pages. */
  pointSources?: Record<string, string>;
  subgroup?: string;
};

export type DataSource = {
  publisher: string;
  title: string;
  url: string;
  table?: string;
  location?: string;
  retrieved: string;
  method: string;
};

export type Scenario = {
  label: string;
  question: string;
  /** What you expect to happen, written before running it. */
  expectation?: string;
  /** The scenario these changes apply to; the balanced model if left out. */
  base?: ScenarioId;
  changes: Changes;
  /** How the input curves were made, when they come from data. */
  derivedFrom?: { series: SeriesId[]; method: string };
  order: number;
};

export type Changes = {
  parameters?: Record<ParameterId, number>;
  /** One multiplier per model year, 0 to simulation.years. */
  inputs?: Record<VariableId, number[]>;
  /**
   * Gain on an equation link "from→to", default 1. The equation of `to` sees ref + gain × (from − ref), where ref
   * is `from` at the start of the balanced run. 0 cuts the link: a loop knockout.
   */
  linkGain?: Record<LinkKey, number>;
  dt?: number;
};

/** "rent→profitability" */
export type LinkKey = string;

export type Annotations = {
  /** Named feedback loops. A loop is every cycle through one of its `cut` links; a knockout sets their gain to 0. */
  loops: Record<LoopId, LoopAnnotation>;
  /** Explanations of the links in the loop view, by "from→to" between key variables. */
  links: Record<LinkKey, string>;
};

export type LoopAnnotation = { label: string; name: string; story: string; cut: LinkKey[] };

/** A model with every scenario change applied. Never stored. */
export type Settings = {
  parameters: Record<ParameterId, number>;
  inputs: Record<VariableId, number[]>;
  linkGain: Record<LinkKey, number>;
  dt: number;
};

/** Recorded values of every variable, column by column. */
export type Run = { years: number[]; values: Record<VariableId, number[]> };

export type MarkdownDoc = { "@patchwork": { type: "markdown" }; content: string };

export type FolderDoc = { "@patchwork": { type: "folder" }; title: string; docs: { name: string; type: string; url: AutomergeUrl }[] };
