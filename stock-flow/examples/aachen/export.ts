/**
 * Converts the Aachen housing app (system-thinking/aachen-housing-loops) into this example: equations as
 * expressions, parameters, scenarios with their input curves, data and loop annotations. Also writes runs of the
 * app's own simulate() for the engine tests, and copies the notebooks.
 *
 *   pnpm export:aachen <aachen-housing-loops directory> [output directory, default examples/aachen]
 */
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [appArgument, outputArgument] = process.argv.slice(2);
if (!appArgument) throw new Error("Pass the aachen-housing-loops directory");
const app = path.resolve(appArgument);
const output = path.resolve(outputArgument ?? import.meta.dirname);

const load = (file: string) => import(pathToFileURL(path.join(app, "src", file)).href);
const [{ MODEL_VARIABLES }, { allSeries }, { CONSTANTS, DELAY_ROWS, EQUATION_GROUPS }, { LINKS, LOOPS, NODES }, M, scenarioModule] =
  await Promise.all([load("catalogue.ts"), load("data/series.ts"), load("equations.ts"), load("loops.ts"), load("model.ts"), load("scenarios.ts")]);
const { allScenarios, scenarioSettings, withKnob, findKnob } = scenarioModule;

function main(): void {
  mkdirSync(path.join(output, "notebooks"), { recursive: true });
  writeFileSync(path.join(output, "model.json"), JSON.stringify(model(), null, 1));
  writeFileSync(path.join(output, "expected.json"), JSON.stringify(expectedRuns()));
  const notebooks = path.join(app, "src", "notebooks");
  for (const file of readdirSync(notebooks)) copyFileSync(path.join(notebooks, file), path.join(output, "notebooks", file));
  console.log(`Wrote ${output}`);
}

function model() {
  return {
    "@patchwork": { type: "stock-flow-model" },
    title: "Aachen housing",
    description:
      "Why rents in Aachen rose: students and other households competing for flats that take years to build, on land the city designates slowly. Model years run from 2000 to 2040; rents are in 2000 prices.",
    simulation: { startYear: M.START_YEAR, years: M.SIMULATION_YEARS, dt: M.DEFAULT_DT, recordInterval: M.RECORD_INTERVAL },
    variables: variables(),
    parameters: parameters(),
    data: data(),
    scenarios: scenarios(),
    annotations: { loops: loops(), links: links() },
  };
}

type Definition =
  | { kind: "stock"; initial: string; inflows: string[]; outflows: string[] }
  | { kind: "flow" | "auxiliary"; equation: string }
  | { kind: "input"; base: string; input: string };

/** The equations of model.ts evaluate() and advance(), in the same order of operations. */
const DEFINITIONS: Record<string, Definition> = {
  students: { kind: "stock", initial: "baseStudents", inflows: ["intake"], outflows: ["graduation"] },
  shareOutside: { kind: "stock", initial: "baseShareOutside", inflows: ["shareChange"], outflows: [] },
  permitted: { kind: "stock", initial: "initialStarts * (construction / 2)", inflows: ["starts"], outflows: ["buildingBegins"] },
  underConstruction: {
    kind: "stock",
    initial: "initialStarts * (construction / 2)",
    inflows: ["buildingBegins"],
    outflows: ["completions"],
  },
  flats: { kind: "stock", initial: "baseFlats", inflows: ["completions"], outflows: ["demolition"] },
  buildableLand: { kind: "stock", initial: "baseLand", inflows: ["landDesignated"], outflows: ["starts"] },
  rent: { kind: "stock", initial: "baseRent", inflows: ["rentChange"], outflows: [] },
  perceivedPressure: { kind: "stock", initial: "0", inflows: ["pressureChange"], outflows: [] },
  perceivedWanted: { kind: "stock", initial: "baseDemand - initialTrend * forecast", inflows: ["demandGrowth"], outflows: [] },

  intake: { kind: "input", base: "baseIntake", input: "intake" },
  population: { kind: "input", base: "basePopulation", input: "population" },
  householdSize: { kind: "input", base: "baseHouseholdSize", input: "householdSize" },
  landDesignated: { kind: "input", base: "normalStarts", input: "landDesignated" },

  graduation: { kind: "flow", equation: "students / study" },
  starts: { kind: "flow", equation: "min(desiredStarts, maxStarts)" },
  buildingBegins: { kind: "flow", equation: "permitted / (construction / 2)" },
  completions: { kind: "flow", equation: "underConstruction / (construction / 2)" },
  demolition: { kind: "flow", equation: "flats / flatLifetime" },
  rentChange: { kind: "flow", equation: "rent * max(0, rentGrowth) + (rent - rentFloor) * min(0, rentGrowth)" },
  shareChange: { kind: "flow", equation: "(indicatedShareOutside - shareOutside) / moving" },
  pressureChange: { kind: "flow", equation: "(pressure - perceivedPressure) / recognition" },
  demandGrowth: { kind: "flow", equation: "(wanted - perceivedWanted) / forecast" },

  otherHouseholds: { kind: "auxiliary", equation: "population / householdSize" },
  otherDemand: { kind: "auxiliary", equation: "otherHouseholds * (rent / baseRent) ^ -householdRentElasticity" },
  studentsInTown: { kind: "auxiliary", equation: "students * (1 - shareOutside)" },
  studentsWithParents: { kind: "auxiliary", equation: "studentsInTown * shareWithParents" },
  studentsInHalls: { kind: "auxiliary", equation: "min(studentsInTown - studentsWithParents, hallPlaces)" },
  studentsInMarket: { kind: "auxiliary", equation: "studentsInTown - studentsWithParents - studentsInHalls" },
  studentDemand: { kind: "auxiliary", equation: "studentsInMarket / studentsPerFlat" },
  wanted: { kind: "auxiliary", equation: "otherHouseholds + studentDemand" },
  demand: { kind: "auxiliary", equation: "otherDemand + studentDemand" },
  occupied: { kind: "auxiliary", equation: "min(demand, flats * (1 - minVacancy))" },
  unhoused: { kind: "auxiliary", equation: "demand - occupied" },
  vacancy: { kind: "auxiliary", equation: "(flats - occupied) / flats" },
  notionalVacancy: { kind: "auxiliary", equation: "(flats - demand) / flats" },
  pressure: { kind: "auxiliary", equation: "(normalVacancy - notionalVacancy) / normalVacancy" },
  rentGrowth: { kind: "auxiliary", equation: "clamp(rentSensitivity * pressure, maxRentFall, maxRentRise)" },
  landPrice: { kind: "auxiliary", equation: "max(1, baseLand / buildableLand) ^ landPriceElasticity" },
  buildingCost: { kind: "auxiliary", equation: "1 - landCostShare + landCostShare * landPrice" },
  profitability: { kind: "auxiliary", equation: "rent / baseRent / buildingCost" },
  pipelineEffect: { kind: "auxiliary", equation: "(normalPipeline / (permitted + underConstruction)) ^ pipelineResponse" },
  growthStarts: { kind: "auxiliary", equation: "growthResponse * max(0, demandGrowth) / (1 - normalVacancy)" },
  marketStarts: { kind: "auxiliary", equation: "(normalStarts * pipelineEffect + growthStarts) * profitability ^ startsElasticity" },
  subsidisedStarts: { kind: "auxiliary", equation: "policyResponse * typicalStarts * max(0, perceivedPressure)" },
  desiredStarts: { kind: "auxiliary", equation: "marketStarts + subsidisedStarts" },
  maxStarts: { kind: "auxiliary", equation: "buildableLand / landUseTime" },
  indicatedShareOutside: {
    kind: "auxiliary",
    equation: "min(maxShareOutside, baseShareOutside * (rent / baseRent) ^ spilloverElasticity)",
  },
};

/** The diagram's nodes; "Vacancy" there is the vacancy that drives rent and pressure. */
const KEY = new Set<string>([...NODES.map((node) => (node.id === "vacancy" ? "notionalVacancy" : node.id))]);

const LABELS: Record<string, string> = {
  notionalVacancy: "Vacancy if all housed",
  rentGrowth: "Rent growth",
  vacancy: "Vacancy",
};

function variables() {
  const nodeLabels = new Map<string, string>(NODES.map((node) => [node.id, node.label]));
  const catalogue = new Map(MODEL_VARIABLES.map((item) => [item.key as string, item]));
  const equations = new Map(EQUATION_GROUPS.flatMap((group) => group.equations).map((item) => [item.id as string, item]));
  return Object.fromEntries(
    Object.entries(DEFINITIONS).map(([id, definition]) => {
      const listed = catalogue.get(id);
      const equation = equations.get(id);
      const label =
        LABELS[id] ?? (KEY.has(id) ? nodeLabels.get(id) : undefined) ?? listed?.label ?? nodeLabels.get(id) ?? equation?.name ?? id;
      const description = equation && equation.name !== label ? equation.name : undefined;
      const unit = listed?.unit ?? equation?.unit ?? (id === "rentGrowth" ? "share per year" : "");
      const kind =
        definition.kind === "input"
          ? { kind: "input", base: definition.base, range: [M.INPUTS[definition.input].min, M.INPUTS[definition.input].max] }
          : definition;
      return [
        id,
        {
          label,
          unit,
          ...(description ? { description } : {}),
          ...(listed?.scale ? { scale: listed.scale } : {}),
          ...(KEY.has(id) ? { key: true } : {}),
          ...kind,
        },
      ];
    }),
  );
}

type ParameterRow = [id: string, constant: string, group: string, format: string, value: number | string, meaning?: string];

function parameters() {
  const p = M.DEFAULT_PARAMETERS;
  const rows: ParameterRow[] = [
    ["baseStudents", "BASE_STUDENTS", "Students", "number", M.BASE_STUDENTS],
    ["baseIntake", "BASE_INTAKE", "Students", "number", "baseStudents / study"],
    ["studentsPerFlat", "STUDENTS_PER_FLAT", "Students", "number", p.studentsPerFlat],
    ["shareWithParents", "SHARE_WITH_PARENTS", "Students", "percent", p.shareWithParents],
    ["hallPlaces", "HALL_PLACES", "Students", "number", p.hallPlaces],
    ["baseStudentsInTown", "", "Students", "number", "baseStudents * (1 - baseShareOutside)", "Students living in Aachen at the start"],
    [
      "baseStudentDemand",
      "BASE_STUDENT_DEMAND",
      "Students",
      "number",
      "(baseStudentsInTown - baseStudentsInTown * shareWithParents - min(baseStudentsInTown - baseStudentsInTown * shareWithParents, hallPlaces)) / studentsPerFlat",
    ],
    ["basePopulation", "BASE_POPULATION", "Households", "number", M.BASE_POPULATION],
    ["baseHouseholdSize", "BASE_HOUSEHOLD_SIZE", "Households", "number", M.BASE_HOUSEHOLD_SIZE],
    ["baseOtherHouseholds", "OTHER_HOUSEHOLDS", "Households", "number", "basePopulation / baseHouseholdSize"],
    ["normalVacancy", "NORMAL_VACANCY", "Households", "percent", M.NORMAL_VACANCY],
    ["minVacancy", "MIN_VACANCY", "Households", "percent", p.minVacancy],
    ["baseDemand", "BASE_DEMAND", "Households", "number", "baseOtherHouseholds + baseStudentDemand"],
    ["baseShareOutside", "BASE_SHARE_OUTSIDE", "B2 Priced out", "percent", M.BASE_SHARE_OUTSIDE],
    ["maxShareOutside", "MAX_SHARE_OUTSIDE", "B2 Priced out", "percent", p.maxShareOutside],
    ["spilloverElasticity", "SPILLOVER_ELASTICITY", "B2 Priced out", "number", p.spilloverElasticity],
    ["householdRentElasticity", "HOUSEHOLD_RENT_ELASTICITY", "B2 Priced out", "number", p.householdRentElasticity],
    ["baseFlats", "BASE_FLATS", "B1 Construction", "number", "baseDemand / (1 - normalVacancy)"],
    ["normalStarts", "NORMAL_STARTS", "B1 Construction", "number", "baseFlats / flatLifetime"],
    ["startsElasticity", "STARTS_ELASTICITY", "B1 Construction", "number", p.startsElasticity],
    ["growthResponse", "GROWTH_RESPONSE", "B1 Construction", "number", p.growthResponse],
    ["normalPipeline", "NORMAL_PIPELINE", "B5 Pipeline", "number", "normalStarts * construction"],
    [
      "pipelineResponse",
      "",
      "B5 Pipeline",
      "number",
      M.DEFAULT_LOOP_STRENGTH.pipeline,
      "How strongly developers hold back when the pipeline is fuller than normal. 0, the default, means they ignore it: B5 is off in the model as drawn; 1 switches it on.",
    ],
    ["baseRent", "BASE_RENT", "Rent", "currency", M.BASE_RENT],
    ["rentSensitivity", "RENT_SENSITIVITY", "Rent", "number", p.rentSensitivity],
    ["maxRentFall", "MAX_RENT_FALL", "Rent", "percent", p.maxRentFall],
    ["maxRentRise", "MAX_RENT_RISE", "Rent", "percent", p.maxRentRise],
    ["rentFloor", "RENT_FLOOR", "Rent", "currency", p.rentFloor],
    ["landYears", "LAND_YEARS", "B3 Land", "years", p.landYears],
    ["baseLand", "BASE_LAND", "B3 Land", "number", "landYears * normalStarts"],
    ["landUseTime", "LAND_USE_TIME", "B3 Land", "years", p.landUseTime],
    ["landCostShare", "LAND_COST_SHARE", "B3 Land", "percent", p.landCostShare],
    ["landPriceElasticity", "LAND_PRICE_ELASTICITY", "B3 Land", "number", p.landPriceElasticity],
    ["policyResponse", "POLICY_RESPONSE", "B4 Policy", "number", p.policyResponse],
    ["typicalStarts", "TYPICAL_STARTS", "B4 Policy", "number", M.TYPICAL_STARTS],
    [
      "initialTrend",
      "",
      "Start",
      "number",
      "max(0, inputAt(population, 1) / inputAt(householdSize, 1) - inputAt(population, 0) / inputAt(householdSize, 0))",
      "Yearly growth in non-student households the inputs start with. Builders already see it, and the flats they started for it in the years before are in the pipeline.",
    ],
    ["initialStarts", "", "Start", "number", "normalStarts + initialTrend / (1 - normalVacancy)", "Starts per year in the years before the run"],
  ];
  const meanings = new Map(CONSTANTS.map((constant) => [constant.id, constant.meaning]));
  const result: Record<string, unknown> = {};
  for (const [id, constant, group, format, value, meaning] of rows) {
    result[id] = {
      label: constant || id,
      group,
      meaning: meaning ?? meanings.get(constant) ?? "",
      format,
      ...(typeof value === "number" ? { value } : { derived: value }),
    };
  }
  for (const [id, delay] of Object.entries(M.DELAYS)) {
    const row = DELAY_ROWS.find((candidate) => candidate.id === id)!;
    result[id] = {
      label: delay.code,
      group: "Delays",
      meaning: delay.label,
      format: "years",
      value: delay.value,
      range: { min: delay.min, max: delay.max, step: delay.step },
      delay: { kind: row.kind, shape: row.shape },
    };
  }
  return result;
}

function data() {
  return Object.fromEntries(
    allSeries().map((series) => [
      series.id,
      {
        label: series.label,
        unit: series.unit,
        variable: series.node === "vacancy" ? "vacancy" : series.node,
        points: series.points,
        source: series.source,
        notes: series.notes,
        ...(series.pointSources ? { pointSources: series.pointSources } : {}),
        ...(series.subgroup ? { subgroup: series.subgroup } : {}),
      },
    ]),
  );
}

const REAL_SERIES = [
  "firstYear.cityDefinition",
  "cityFirstYear",
  "students.cityDefinition",
  "cityStudents",
  "population",
  "cityPopulation",
  "households",
  "completions",
];

const REAL_METHOD =
  "Made by realInputs() in aachen-housing-loops/src/inputs.ts. Intake: the yearly arrivals that make the model's student stock follow the recorded student count (IT.NRW, continued by the city's figures), then the stock the medium first-year forecast builds. Population: the city's register from 2011, extended backwards by IT.NRW's growth rates, minus the 66% of students registered as residents, then the medium forecast. Household size: non-student population over households net of student households, with the register's trend before 2011 and IT.NRW's forecast after. Land: as many flats a year as were completed on average since 2000. Each curve is divided by its 2000 value.";

const VARIANTS: Record<string, string> = {
  "no-student-growth": "As the real data, with intake held at its start value.",
  "no-population-growth": "As the real data, with non-student population held at its 2000 value.",
  "no-smaller-households": "As the real data, with household size held at its 2000 value.",
  "no-surge": "As the real data, with first-year numbers held at their 2010 level from 2011, so every later cohort is smaller by the difference.",
  "forecast-low": "As the real data, with the forecasts' low variants after 2025.",
  "forecast-high": "As the real data, with the forecasts' high variants after 2025.",
};

function scenarios() {
  return Object.fromEntries(
    allScenarios().map((scenario, order) => {
      const { inputs, delays, parameters, dt, loopStrength } = scenario.changes;
      if (loopStrength && Object.keys(loopStrength).length) throw new Error(`${scenario.id} changes loop strengths`);
      const changes = {
        ...(parameters || delays ? { parameters: { ...parameters, ...delays } } : {}),
        ...(inputs ? { inputs } : {}),
        ...(dt !== undefined ? { dt } : {}),
      };
      const real = scenario.id === "real" || scenario.id in VARIANTS;
      return [
        scenario.id,
        {
          label: scenario.label,
          question: scenario.question,
          ...(scenario.expectation ? { expectation: scenario.expectation } : {}),
          ...(scenario.base ? { base: scenario.base } : {}),
          changes,
          ...(real ? { derivedFrom: { series: REAL_SERIES, method: [VARIANTS[scenario.id], REAL_METHOD].filter(Boolean).join(" ") } } : {}),
          order,
        },
      ];
    }),
  );
}

const CUTS: Record<string, string[]> = {
  supply: ["rent→profitability"],
  spillover: ["rent→otherDemand", "rent→indicatedShareOutside"],
  land: ["buildableLand→landPrice"],
  policy: ["perceivedPressure→subsidisedStarts"],
  pipeline: ["permitted→pipelineEffect", "underConstruction→pipelineEffect"],
};

function loops() {
  return Object.fromEntries(LOOPS.map((loop) => [loop.id, { label: loop.label, name: loop.name, story: loop.story, cut: CUTS[loop.id] }]));
}

/** Subsidised flats need land like any other, so their link goes into starts, not straight into planning. */
const RENAMED: Record<string, string> = { vacancy: "notionalVacancy" };
const RELINKED: Record<string, string> = { "subsidisedStarts→permitted": "subsidisedStarts→starts" };

function links() {
  return Object.fromEntries(
    LINKS.map((link) => {
      const key = `${RENAMED[link.from] ?? link.from}→${RENAMED[link.to] ?? link.to}`;
      return [RELINKED[key] ?? key, link.explanation];
    }),
  );
}

const EXPECTED_REFERENCES = [
  ...allScenarios().map((scenario) => scenario.id),
  "real without spillover",
  "real without supply and policy",
  "no-new-land without land",
  "student-flood without spillover",
];

const EXPECTED_SWEEPS: [string, string, number][] = [
  ["real", "growthResponse", 0],
  ["real", "householdRentElasticity", 0.4],
  ["real", "pipeline", 1],
];

const EXPECTED_VARIABLES: string[] = [
  "rent",
  "flats",
  "students",
  "starts",
  "completions",
  "shareOutside",
  "perceivedPressure",
  "buildableLand",
  "vacancy",
  "demand",
  "permitted",
  "subsidisedStarts",
  "perceivedWanted",
];

/** Yearly values from the original simulate(); a sweep over "pipeline" is the old loop strength. */
function expectedRuns() {
  const record = (settings: unknown) => {
    const run = M.simulate(settings).filter((point) => Number.isInteger(point.year));
    return Object.fromEntries(EXPECTED_VARIABLES.map((key) => [key, run.map((point) => point[key])]));
  };
  return {
    runs: EXPECTED_REFERENCES.map((reference) => ({ reference, values: record(scenarioSettings(reference)) })),
    sweeps: EXPECTED_SWEEPS.map(([reference, knob, value]) => ({
      reference,
      knob,
      value,
      values: record(withKnob(scenarioSettings(reference), findKnob(knob), value)),
    })),
  };
}

main();
