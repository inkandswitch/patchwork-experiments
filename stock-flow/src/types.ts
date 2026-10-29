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
  /** Where the diagrams put things. Without it, they are laid out automatically. */
  layout?: Layouts;
};

export type Layouts = { loops?: DiagramLayout; stockFlow?: DiagramLayout };

/** Placement only: which links are drawn and their signs still come from the equations. */
export type DiagramLayout = {
  /** The variables the diagram shows, in model coordinates; the others are folded into the links between these. */
  nodes: Record<VariableId, { x: number; y: number; lines?: string[] }>;
  /** How far an arrow bows out, in pixels, to the right of its direction of travel. */
  bends?: Record<LinkKey, number>;
  /** Where each named loop's marker sits. */
  markers?: Record<LoopId, { x: number; y: number }>;
  viewBox?: [number, number, number, number];
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
  /** Print fit statistics for each data series under the chart, over the chart's years or the given window. */
  fit?: boolean | { years: [number, number] };
};

/** Sterman's test battery over one model, recomputed live. Embeddable as [patchwork:<documentId>/stock-flow-tests]. */
export type StockFlowTestsDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-tests">;
  title: string;
  model: AutomergeUrl;
  /** Scenario reference the behaviour tests run on. */
  scenario: string;
  tests: TestSpec[];
};

export type TestSpec =
  /** What `sf check` finds, plus parameters with neither a source nor an estimation note. */
  | { kind: "structure" }
  /** Every stock stays put with no inputs and no cuts. */
  | { kind: "equilibrium"; tolerance?: number }
  /** Halving dt changes no stock by more than `tolerance` (share of its range). */
  | { kind: "integration"; tolerance?: number }
  /** Parameters set and inputs held at a constant multiplier; each expectation is a predicate over the run. */
  | { kind: "extreme"; label: string; set?: Record<string, number>; inputs?: Record<VariableId, number>; expect: Expectation[] }
  /** Knocking out a loop must move the variable by at least `minEffect` (share of its range), or the loop is inert. */
  | { kind: "knockout"; loop: LoopId; variable: VariableId; minEffect: number }
  /** Model against a data series over a window; `max` bounds the statistics. */
  | { kind: "fit"; data: SeriesId; years?: [number, number]; max?: Partial<FitStats> }
  /** Model against data on years the parameters were not estimated on. */
  | { kind: "holdout"; data: SeriesId; fitYears: [number, number]; testYears: [number, number]; max?: Partial<FitStats> };

/**
 * min/max: every value at or above/below `value`. between: every value within [a, b]. finite: no NaN or ±∞.
 * settles: the final value is within 1% of the variable's range of `value`. Values are in the units charts show.
 */
export type Expectation = { variable: VariableId; check: "min" | "max" | "between" | "finite" | "settles"; value?: number | [number, number] };

/** Behaviour reproduction statistics (Sterman §21.4.7). bias + variation + covariation = 1. */
export type FitStats = {
  n: number;
  rmse: number;
  /** Mean absolute percentage error, as a share. */
  mape: number;
  r2: number;
  /** Theil's inequality coefficient, 0 (perfect) to 1. */
  theilU: number;
  /** Share of the squared error from unequal means. */
  bias: number;
  /** Share from unequal variances. */
  variation: number;
  /** Share from imperfect correlation: unsystematic. */
  covariation: number;
};

/** Computed, never stored. */
export type TestResult = { spec: TestSpec; status: "pass" | "warn" | "fail"; summary: string; details?: Record<string, number> };

/** How answers move with parameter uncertainty. Embeddable as [patchwork:<documentId>/stock-flow-sensitivity]. */
export type StockFlowSensitivityDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-sensitivity">;
  title: string;
  model: AutomergeUrl;
  scenario: string;
  /** Parameters to vary, each with an explicit range or a symmetric spread (share of its value). */
  parameters: Record<ParameterId, { min: number; max: number } | { spread: number }>;
  method: { kind: "one-at-a-time" } | { kind: "latin-hypercube"; samples: number; seed: number };
  outcomes: Outcome[];
  /** Compare scenarios on one outcome (index into `outcomes`) and report how often each wins. */
  ranking?: { scenarios: string[]; outcome: number; lowerIsBetter: boolean };
};

/** A number read off a run. Levels and values are in the units charts show (the variable's scale applied). */
export type Outcome =
  | { kind: "value"; variable: VariableId; year: number }
  | { kind: "peak"; variable: VariableId; years?: [number, number] }
  /** The first year after `after` the variable crosses `level`; NaN if it never does. */
  | { kind: "crossing"; variable: VariableId; level: number; after?: number }
  | { kind: "change"; variable: VariableId; from: number; to: number; relative?: boolean };

/** Shapley attribution of a change to the drivers that caused it. Embeddable as [patchwork:<documentId>/stock-flow-attribution]. */
export type StockFlowAttributionDoc = {
  "@patchwork": PatchworkMeta<"stock-flow-attribution">;
  title: string;
  model: AutomergeUrl;
  /** The scenario with every driver on. */
  scenario: string;
  outcome: Outcome;
  /** A driver "off" holds its inputs at their year-0 multiplier and sets its parameters to the given values. */
  drivers: Record<string, { label: string; inputs?: VariableId[]; parameters?: Record<ParameterId, number> }>;
  /** Repeat the attribution over a Latin hypercube of these parameters to put bands on the shares. */
  uncertainty?: { parameters: Record<ParameterId, { min: number; max: number } | { spread: number }>; samples: number; seed: number };
};

/** Computed. The shares sum to `total`; `interaction` is how far the one-at-a-time effects fall short of it. */
export type Attribution = {
  baseline: number;
  total: number;
  shares: Record<string, number>;
  oneAtATime: Record<string, number>;
  interaction: number;
  /** 5th, 50th and 95th percentile of each share (and of the total) over the uncertainty samples. */
  bands?: { samples: number; shares: Record<string, Quantiles>; total: Quantiles };
};

export type Quantiles = { low: number; median: number; high: number };

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
  /** For the unit check, e.g. "dwellings per year"; percentages and indices are dimensionless. */
  unit?: string;
  format: "number" | "percent" | "years" | "currency";
  /** Shown as a slider in the viewer. */
  range?: { min: number; max: number; step: number };
  /** A delay time. The links it delays are found from the equations that mention it. */
  delay?: { kind: string; shape: string };
  /** Where the value comes from. The structure test counts parameters with neither this nor `estimated`. */
  source?: DataSource | string;
  /** How the value was estimated from data, when it was. */
  estimated?: { from: SeriesId[]; years: [number, number]; method: string; range?: { min: number; max: number } };
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
