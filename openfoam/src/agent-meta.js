// The agent's tools, as plain data: descriptions and input schemas, which the
// agent reads before it loads anything. Import-free, like everything
// src/index.js imports (it is evaluated in a worker and structuredClone'd).
// The executors are in src/agent-tools.js; src/agent-tools.test.js checks
// that every input they read is declared here.

const URL_OF = (what) => ({ type: "string", description: `automerge: URL of ${what}.` });
const SPEED = {
  description: 'A speed with its unit: text such as "8 kn" or "4.1 m/s", or { "value": 8, "unit": "kn" } (unit "kn" or "m/s"). A bare number is refused: it has no unit.',
  anyOf: [
    { type: "string" },
    { type: "object", required: ["value", "unit"], properties: { value: { type: "number" }, unit: { type: "string", enum: ["kn", "m/s"] } } },
  ],
};
const MASS = {
  description: 'A mass with its unit: text such as "11984 kg" or "11.98 t", or { "value": 11984, "unit": "kg" } (unit "kg" or "t").',
  anyOf: [
    { type: "string" },
    { type: "object", required: ["value", "unit"], properties: { value: { type: "number" }, unit: { type: "string", enum: ["kg", "t"] } } },
  ],
};
const CASE = URL_OF("the OpenFOAM case (openfoam_case makes one)");

export const AGENT_TOOLS = [
  {
    type: "agent:tool",
    id: "openfoam_case",
    name: "OpenFOAM case",
    where: "host",
    risk: "edit",
    description:
      "Make an OpenFOAM resistance case for a hull, or change what it analyses, and report it. With no `case`, makes one (filed in `folder` if given). `hull` links the model (a 3D file such as a Rhino .3dm or GLB, or any hull document); `parts` chooses which of its named parts (Rhino layers) are the hull; `bow` says which way the model's bow points; `server` is the task queue its runs are asked of (an OpenFOAM host prints one). Every call reports the case: each part's extent in the model's frame and whether it is a closed shell, the hull as floated (displacement, draft, waterline, wetted area) and how sinkage is measured, the setup, what a run will cost, the server, and whether it's ready to run. With only `case`, it just reports.",
    input_schema: {
      type: "object",
      properties: {
        case: CASE,
        folder: URL_OF("a folder to file a new case in"),
        title: { type: "string", description: "The case's name." },
        hull: URL_OF("the model to analyse: a 3D file or a hull document"),
        parts: {
          description: 'The model\'s parts that make the hull, by name exactly as this tool lists them (e.g. ["Hull Bottom", "Topsides"]), or "default" for every part that meets the water.',
          anyOf: [{ type: "array", items: { type: "string" } }, { type: "string", enum: ["default"] }],
        },
        bow: { type: "string", enum: ["+x", "-x"], description: "Which way the model's bow points; the analysis turns it to +x." },
        server: URL_OF("the task queue that runs go to (the OpenFOAM host prints it when it starts)"),
        reread: { type: "boolean", description: "Read the hull again from the original model, not the copy kept with the case (after the model changed)." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).caseTool;
    },
  },
  {
    type: "agent:tool",
    id: "openfoam_setup",
    name: "Set up an OpenFOAM run",
    where: "host",
    risk: "edit",
    description:
      "Set up the case's next run: the analysis, the speed (always with its unit), how the hull floats, the water, the mesh and solver. Fields left out keep their values. `float` solves the sinkage that floats the hull at a mass, at the trim and heel this same call ends with (set them here, or they stay as they are): change trim or heel later and float again. Sinkage is where the hull floats, measured at the middle of its length, not a change from the last value. Out-of-range or unknown values are refused, never clamped. Reports the case as openfoam_case does.",
    input_schema: {
      type: "object",
      required: ["case"],
      properties: {
        case: CASE,
        analysis: { type: "string", enum: ["double-body", "free-surface"], description: "double-body: no waves, viscous and form drag, about a minute. free-surface: waves and their drag, tens of minutes. A new analysis takes its own default iterations." },
        speed: SPEED,
        attitude: {
          type: "object",
          description: "How the hull floats, any of: sinkage (m the hull is lowered from as drawn, at mid-length; negative raises it), trim (°, bow down positive), heel (°, starboard down positive).",
          properties: { sinkage: { type: "number" }, trim: { type: "number" }, heel: { type: "number" } },
        },
        float: {
          type: "object",
          description: "Solve the sinkage instead of giving it: `mass` floats the hull at that mass; `keep_displacement: true` keeps the upright displacement when heeled. Not with attitude.sinkage.",
          properties: { mass: MASS, keep_displacement: { type: "boolean" } },
        },
        water: { type: "string", enum: ["salt", "fresh"], description: "Seawater (35 g/kg) or fresh." },
        temperature: { type: "number", description: "Water temperature, °C, 0–30." },
        mesh: { type: "string", enum: ["coarse", "medium", "fine"], description: "Mesh preset. A new mesh takes its default iterations unless the count was chosen." },
        iterations: { type: "number", description: "Solver iterations, 50–20000 (a ceiling when stopping once settled)." },
        stop: { type: "string", enum: ["settled", "iterations"], description: "settled: stop once the resistance holds within 1%; iterations: run them all." },
        domain: { type: "string", enum: ["auto", "half", "full"], description: "auto: a half model when the hull is symmetric (never when heeled)." },
        cores: { type: "number", description: "Cores a run, 0 for the machine's choice." },
        keep_volume: { type: "boolean", description: "Keep every cell's flow after the run (about 200 bytes a cell)." },
        start_from: { type: ["string", "null"], description: "automerge: URL of a finished run whose solution starts the next one (on the machine that ran it), or null to start from rest." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).setupTool;
    },
  },
  {
    type: "agent:tool",
    id: "openfoam_run",
    name: "Run OpenFOAM",
    where: "host",
    risk: "edit",
    description:
      "Ask the case's server for a run at the setup's speed, or a sweep: one run per speed in `speeds`, everything else as set up. Each run document freezes the setup and the hull as floated now. Returns the run documents and exactly what to watch to wait for them: the run's [\"status\"] field, with doc_watch, until it is done, failed or cancelled. Then openfoam_results.",
    input_schema: {
      type: "object",
      required: ["case"],
      properties: {
        case: CASE,
        speeds: { type: "array", items: SPEED, description: 'A sweep: one run per speed, each with its unit, e.g. ["7 kn", "8 kn", "9 kn"]. Leave out for one run at the setup\'s speed.' },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).runTool;
    },
  },
  {
    type: "agent:tool",
    id: "openfoam_results",
    name: "OpenFOAM results",
    where: "worker",
    risk: "read",
    description:
      "One table of runs to quote: status (with progress while solving), speed, analysis, mesh, attitude, total resistance R_T with its scatter, its pressure and viscous parts, the vertical force F_z against the weight the hull floats at (and their ratio, for a free surface), convergence, cells, iterations and time; then why any run failed. At most 40 runs.",
    input_schema: {
      type: "object",
      properties: {
        runs: { type: "array", items: { type: "string" }, description: "automerge: URLs of runs (openfoam_run returns them)." },
        case: { type: "string", description: "automerge: URL of a case: all its runs, oldest first (the latest 40)." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).resultsTool;
    },
  },
  {
    type: "agent:tool",
    id: "openfoam_stop",
    name: "Stop OpenFOAM runs",
    where: "worker",
    risk: "edit",
    description: "Stop runs: `keep: true` finishes now (the solver writes what it has and its results are read, only while solving); `keep: false` cancels (nothing is kept). The run's status says when it has stopped; a run cancelled before it started keeps the status \"queued\", and openfoam_results shows it cancelled.",
    input_schema: {
      type: "object",
      required: ["runs", "keep"],
      properties: {
        runs: { type: "array", items: { type: "string" }, description: "automerge: URLs of the runs to stop." },
        keep: { type: "boolean", description: "true: finish now and keep the results; false: cancel." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).stopTool;
    },
  },
];
