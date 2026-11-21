/**
 * The `assumptions-register` skill: when to keep a register and how to work
 * from it. A module, not a .md file, because this package has no build to
 * import text with. The agent lists the skill by its plugin description
 * (index.js) and reads this body on demand.
 */

export const documentation = `# Working from an assumptions register

A task whose artifacts compute with numbers — a sizing notebook, a CAD model, a
CFD case, a safety case, a costed BOM — keeps every number they share in one
**assumptions register** (datatype \`assumptions\`). Each entry says where it came
from: a verified quote, a citation, an estimate, a design choice, or the model
that produced it. The register is where a person corrects a value or tries an
alternative, and where they find every place a value is used.

Use one when two or more artifacts depend on the same quantities, or when the
person will need to check or vary the numbers. A one-off calculation does not
need one.

## Why it exists

In past runs a safety evaluation estimated vent gas from a literature L/Ah
figure, an H₂ fraction "from memory" and a guessed compartment volume, while the
design itself had no barrier between cells — and nothing tied the three
together. A report and its notebook disagreed on a short-circuit voltage. A
"single source of truth" JSON carried values with no source. Each number that
lives in only one artifact goes stale or wrong without anyone seeing.

## How to work

1. **Make the register first**, in the task folder:
   \`assumptions_create { folder, title }\`. Plan around it: research steps find
   values, and the step that writes the register records them with their quotes.
2. **Every world fact, design decision and requirement is an entry**
   (\`assumptions_set\`, many entries per call). Ids are identifiers grouped by
   their first segment — \`cell_capacity_Ah\`, \`cell_vent_gas_L_per_Ah\`,
   \`barrier_k_W_mK\`, \`hull_displacement_kg\`. Put the unit in the id when it
   helps a reader of the model code.
   - A value from a kept document: give \`source\` (its automerge: URL) and a
     verbatim \`quote\`. The tool checks the quote and marks it **verified**; it
     refuses one that is not there.
   - A web page you did not keep: \`source\` only → **cited**.
   - No source: say so → **estimated** (fact) or **chosen** (decision). Use a
     range \`{min, max, nominal}\` when the honest answer is a range — the
     literature gives 0.4–1.4 L/Ah; do not pick a point and hide the spread.
3. **Models read the register, never retype it.** \`assumptions_export\` writes a
   JSON, Python or OpenSCAD file of \`id = value\` lines into the folder; the
   notebook and the CAD model read those names. A range exports as \`id_min\`,
   \`id_max\` and, if it has a nominal, \`id\`. Export again after any change.
4. **Model outputs go back as results**: \`assumptions_set\` with
   \`inputs: [ids it was computed from]\` and \`by: {name, url}\` of the model.
   The tool records the inputs' values at that moment, so when an input
   changes the result shows as **stale**. Other models read results like any
   other entry — that is how one model's output becomes another's constraint.
5. **Prose cites ids.** A report states the value and the id
   ("vent gas 112–392 L per cell, \`cell_vent_gas_L\`"), so where-used finds it.
6. **Before finishing, check**: \`assumptions_where { register }\` lists where
   each entry is used, entries nothing uses, **constants written straight into
   model code** (each one is a number the register should hold — move it there),
   and register names assigned a number that has drifted. \`assumptions_read\`
   shows stale results. Leave neither behind, or say why.

## Chains and loops

Follow a quantity from its physical cause to every place it matters. For a
thermal-runaway safety case: cell chemistry and capacity → vent gas volume and
composition (entries), the barrier in the *design* (a decision entry the CAD
also reads) → propagation (a result) → gas released in the worst credible event
(a result) → with the compartment volume *measured from the CAD* (a result) →
ventilation rate and duct size (results the CAD reads back).

Coupled models form loops: hull CFD → required thrust → propulsion over a design
day → battery energy → battery mass → displacement → CFD again; bulkheads →
battery bay → battery geometry → cooling. Run the loop until the results stop
changing (no stale results, values within a stated tolerance), and record the
tolerance as an entry. An expensive model (a free-surface CFD run) is run at a
few points and interpolated inside the loop; record the points it covers, and
run it again when the loop leaves them.

## Variants

A variant overrides some entries: "cold day", "2 mm aerogel", "gas at the high
end". Set with \`variant\` (and \`variantNote\` the first time), export with
\`variant\`, and record results under the variant they were computed in. Results
in a variant depend on that variant's inputs.
`

export default { documentation }
