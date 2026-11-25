// The agent's tools, as plain data: descriptions and input schemas, which the
// agent reads before it loads anything. Import-free, like everything
// src/index.js imports (it is evaluated in a worker and structuredClone'd).
// The executors are in src/agent-tools.js; src/agent-tools.test.js checks
// that every input they read is declared here, and that the lists copied
// here (units, materials, the most modes) are the ones the model uses.

const URL_OF = (what) => ({ type: "string", description: `automerge: URL of ${what}.` });
const STUDY = URL_OF("the FEA study (fea_study makes one)");

const UNITS = {
  force: ["N", "kN", "MN", "lbf", "kgf"],
  pressure: ["Pa", "kPa", "MPa", "GPa", "bar", "psi", "ksi"],
  density: ["kg/m³", "g/cm³", "lb/in³"],
  length: ["m", "cm", "mm", "µm", "in", "ft"],
  acceleration: ["m/s²", "g"],
};
const QUANTITY = (dimension, example, what) => ({
  description: `${what}: a value with its unit, as text such as "${example}" or as { "value": ${parseFloat(example)}, "unit": "${example.replace(/^[\d.]+\s*/, "")}" }. Units: ${UNITS[dimension].join(", ")}. A bare number is refused: it has no unit.`,
  anyOf: [
    { type: "string" },
    { type: "object", required: ["value", "unit"], properties: { value: { type: "number" }, unit: { type: "string", enum: UNITS[dimension] } } },
  ],
});
const FACES = {
  type: "array",
  items: { type: "integer", minimum: 0 },
  description: "Face numbers of the study's part, exactly as fea_study lists them (each with what it is: flat or round, its size, which way it faces, where it is).",
};
const VECTOR = { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 };
const DIRECTION = {
  description: 'Which way it pushes, in the part\'s frame, where y is up: three numbers, not all zero (any length; [0, -1, 0] is down, [1, 0, 0] along +x), or "into" / "away" for straight into or out of its faces (faces that face one way).',
  anyOf: [VECTOR, { type: "string", enum: ["into", "away"] }],
};
const GRAVITY_DIRECTION = { ...VECTOR, description: "Which way gravity pulls, in the part's frame, where y is up: [0, -1, 0] is down (the default)." };
const ONE_OR_MORE = (item, what) => ({ description: `${what}: one, or a list of them.`, anyOf: [item, { type: "array", items: item }] });
const ID = { type: "string", description: "Its id, as fea_study lists it in [brackets]." };
const IDS = (what) => ({ description: `The id of ${what} to remove (fea_study lists them in [brackets]), or a list of ids.`, anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] });

const MATERIAL_IDS = ["steel", "stainless-316", "aluminium-6061", "aluminium-5083", "titanium", "bronze", "pla", "petg", "abs", "nylon", "fir", "plywood"];
const MAX_MODES = 40;

const FORCE_FIELDS = {
  magnitude: QUANTITY("force", "250 N", "A force's total, spread evenly over its faces; not negative (turn its direction instead)"),
  direction: DIRECTION,
};
const PRESSURE_FIELD = { pressure: QUANTITY("pressure", "2 MPa", "A pressure, pushing square onto its faces everywhere (negative pulls)") };
const GRAVITY_FIELDS = { acceleration: QUANTITY("acceleration", "1 g", "Gravity's acceleration (default 1 g); not negative") };

const ADD_SUPPORT = {
  type: "object",
  required: ["faces"],
  properties: {
    kind: { type: "string", enum: ["fixed", "slide"], description: "fixed (the default): held in every direction, as if welded to something that can't move. slide: can't move into or off its faces but slides along them; flat faces only; also a mirror plane of a symmetric part." },
    name: { type: "string" },
    faces: FACES,
  },
};
const ADD_LOAD = {
  type: "object",
  required: ["kind"],
  description: 'force: { kind, faces, magnitude, direction }. pressure: { kind, faces, pressure }. gravity: { kind, acceleration?, direction? } (the part\'s own weight; default 1 g down). Each may have a name.',
  properties: {
    kind: { type: "string", enum: ["force", "pressure", "gravity"] },
    name: { type: "string" },
    faces: FACES,
    ...FORCE_FIELDS,
    ...PRESSURE_FIELD,
    ...GRAVITY_FIELDS,
  },
};
const UPDATE_SUPPORT = {
  type: "object",
  required: ["id"],
  properties: { id: ID, name: { type: "string" }, kind: ADD_SUPPORT.properties.kind, faces: { ...FACES, description: `${FACES.description} Replaces its faces.` } },
};
const UPDATE_LOAD = {
  type: "object",
  required: ["id"],
  description: "Any of the load's own fields (a force's magnitude and direction, a pressure's pressure, gravity's acceleration and direction), its name, its faces. Its kind stays: remove it and add another to change that.",
  properties: { id: ID, name: { type: "string" }, faces: { ...FACES, description: `${FACES.description} Replaces its faces.` }, ...FORCE_FIELDS, ...PRESSURE_FIELD, ...GRAVITY_FIELDS },
};

export const AGENT_TOOLS = [
  {
    type: "agent:tool",
    id: "fea_study",
    name: "FEA study",
    where: "host",
    risk: "edit",
    description:
      "Finite element analysis (CalculiX) of one solid part: how much it bends and how hard it is stressed under the loads you put on it, or how it vibrates. Make a study, or link or re-read its part, choose its server, and report it. With no `study`, makes one (filed in `folder` if given). `part` links the solid to analyse: an OpenSCAD or CAD model, a GLB or STL file document, or an object's render from a scene; null unlinks it. `reread` reads the linked model again after it changed (supports and loads move onto the faces that are still alike; the report says which lost faces). `server` is an FEA daemon's inbox (null: none). Every call reports the study: the part (its size x × y × z in the part's frame, where y is up; volume; mass in the current material; whether it is a closed solid, and if not why; whether the model changed since it was read), its FACES, each with its number and what it is (\"face 3: flat, 40 mm × 5 mm, facing −x; area …; centre (x, y, z)\"), the material, the supports and loads with their ids, the mesh and about how many nodes it will be, the server and whether its daemon is running, and what still blocks a run. Face numbers are what fea_setup takes; they hold until the part is read again. A part with more than 60 faces lists its largest 60: `faces: \"all\"` lists every one, `facing` lists only those facing one way. With only `study`, it just reports.",
    input_schema: {
      type: "object",
      properties: {
        study: STUDY,
        folder: URL_OF("a folder to file a new study in"),
        title: { type: "string", description: "The study's name." },
        part: { type: ["string", "null"], description: "automerge: URL of the solid to analyse (an OpenSCAD or CAD model, a GLB or STL file, a scene render), or null to unlink it." },
        reread: { type: "boolean", description: "Read the linked model again (after it changed): its faces are split afresh and numbered again." },
        server: { type: ["string", "null"], description: "automerge: URL of an FEA daemon's inbox (the daemon prints it when it starts), or null for none." },
        select_run: { type: ["string", "null"], description: "automerge: URL of one of the study's runs: the one the study shows and a scene draws (null: none chosen). A new run is chosen when it is asked for." },
        forget_runs: { type: "array", items: { type: "string" }, description: "automerge: URLs of runs to take off the study's list (the run documents stay)." },
        faces: { type: "string", enum: ["largest", "all"], description: 'Which faces the report lists: "largest" (the default: the 60 largest by area, when there are more), or "all".' },
        facing: { type: "string", enum: ["+x", "-x", "+y", "-y", "+z", "-z", "curved"], description: "List only the faces facing this way (within 10°; y is up), or only the curved ones." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).studyTool;
    },
  },
  {
    type: "agent:tool",
    id: "fea_setup",
    name: "Set up an FEA study",
    where: "worker",
    risk: "edit",
    description:
      `Change an FEA study's setup: the analysis, the material, the mesh, and how the part is held (supports) and loaded (loads), all on face numbers from fea_study's report. A quantity is a value with its unit: "250 N" or { "value": 250, "unit": "N" }; a bare number is refused. Directions are in the part's frame, where y is up. Fields left out keep their values. One call may make several changes; they are applied in this order: analysis, modes, material, mesh, remove_support, remove_load, update_support, update_load, add_support, add_load. Every change is checked first and written together, as one change: if any is refused, nothing is written and the refusal says what is allowed. Out-of-range or unknown values are refused, never clamped. Reports the study as fea_study does (without the face list), with the ids of what it added.`,
    input_schema: {
      type: "object",
      required: ["study"],
      properties: {
        study: STUDY,
        analysis: { type: "string", enum: ["static", "modal"], description: "static: stress and deflection under the loads. modal: the ways it vibrates on its own, and their frequencies (loads are not used)." },
        modes: { type: "integer", minimum: 1, maximum: MAX_MODES, description: `How many ways of vibrating a modal analysis finds: 1 to ${MAX_MODES}.` },
        material: {
          description: `A material from the list by its id (${MATERIAL_IDS.join(", ")}), or { id?, name?, E?, nu?, density?, yield? }: start from a listed one (id) and/or set its numbers. E (Young's modulus) and yield are pressures with their units ("70 GPa", "250 MPa"; yield null for none), density with its unit ("2700 kg/m³"), nu (Poisson's ratio) a plain number between −1 and 0.5. A changed number makes it its own material, named "… (edited)" unless a name is given.`,
          anyOf: [
            { type: "string", enum: MATERIAL_IDS },
            {
              type: "object",
              properties: {
                id: { type: "string", enum: MATERIAL_IDS },
                name: { type: "string" },
                E: QUANTITY("pressure", "70 GPa", "Young's modulus"),
                nu: { type: "number", description: "Poisson's ratio: 0.3 for most metals." },
                density: QUANTITY("density", "2700 kg/m³", "Density"),
                yield: { ...QUANTITY("pressure", "250 MPa", "Yield strength, or null for none (then no safety factor is given)"), anyOf: [...QUANTITY("pressure", "250 MPa", "").anyOf, { type: "null" }] },
              },
            },
          ],
        },
        mesh: {
          type: "object",
          description: "The mesh: `size` coarse, medium or fine (the element size follows the part), or a length with its unit (\"2 mm\"); `order` 2 (ten-node elements: accurate, what stress should be read from) or 1 (four-node: stiff and rough, a quick look only).",
          properties: {
            size: { anyOf: [{ type: "string" }, QUANTITY("length", "2 mm", "").anyOf[1]], description: `"coarse", "medium", "fine", or a length with its unit (units: ${UNITS.length.join(", ")}).` },
            order: { type: "integer", enum: [1, 2] },
          },
        },
        add_support: ONE_OR_MORE(ADD_SUPPORT, "Hold the part on faces"),
        update_support: ONE_OR_MORE(UPDATE_SUPPORT, "Change a support by its id: its name, kind or faces"),
        remove_support: IDS("a support"),
        add_load: ONE_OR_MORE(ADD_LOAD, "Load the part"),
        update_load: ONE_OR_MORE(UPDATE_LOAD, "Change a load by its id"),
        remove_load: IDS("a load"),
      },
    },
    async load() {
      return (await import("./agent-tools.js")).setupTool;
    },
  },
  {
    type: "agent:tool",
    id: "fea_run",
    name: "Run an FEA study",
    where: "worker",
    risk: "edit",
    description:
      "Run the study as it is set up, on its server: a new run document freezes the setup and the part as they are now and goes in the server's queue. Refused, with what is missing, when something blocks it (fea_study lists what does) or the server's daemon isn't running. Returns the run's URL, about how big its mesh will be, and exactly what to watch to wait for it: its [\"status\"] field, with doc_watch, until it is done, failed or cancelled. Then fea_results.",
    input_schema: {
      type: "object",
      required: ["study"],
      properties: { study: STUDY },
    },
    async load() {
      return (await import("./agent-tools.js")).runTool;
    },
  },
  {
    type: "agent:tool",
    id: "fea_results",
    name: "FEA results",
    where: "worker",
    risk: "read",
    description:
      "What FEA runs found: one table (status, highest stress, safety factor against yield, largest movement, first mode's frequency, nodes), then for each run its URL, what it was asked (analysis, material, supports, loads, mesh), and for a finished run every figure (stress and where, movement and where, each support's force, the loads as applied, the checks that forces balance and energy agrees, mass, the mesh) and the notes a person sees beside them; a line for each run that failed (at which stage, and why), was cancelled, or hasn't finished. Lengths, stresses and forces carry their units. At most 40 runs.",
    input_schema: {
      type: "object",
      properties: {
        runs: { type: "array", items: { type: "string" }, description: "automerge: URLs of runs (fea_run returns them)." },
        study: { type: "string", description: "automerge: URL of a study: all its runs, oldest first (the latest 40)." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).resultsTool;
    },
  },
  {
    type: "agent:tool",
    id: "fea_stop",
    name: "Stop FEA runs",
    where: "worker",
    risk: "edit",
    description: "Cancel runs that haven't finished: the server stops them and keeps nothing. The run's status says when it has (cancelled). A run that has already finished, failed or been cancelled is left as it is.",
    input_schema: {
      type: "object",
      required: ["runs"],
      properties: {
        runs: { type: "array", items: { type: "string" }, description: "automerge: URLs of the runs to cancel." },
      },
    },
    async load() {
      return (await import("./agent-tools.js")).stopTool;
    },
  },
];
