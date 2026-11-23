/**
 * The `assumptions-register` skill: when to keep a register and how to work
 * from it. A module, not a .md file, because this package has no build to
 * import text with. The agent lists the skill by its plugin description
 * (index.js) and reads this body on demand.
 */

export const documentation = `# Working from an assumptions register

A task whose artifacts compute with numbers — a sizing notebook, a CAD model, a
CFD case, a safety case, a costed BOM — keeps every number they share in one
**assumptions register** (datatype \`assumptions\`). Every value is either a claim
on a quoted source, an estimate with its reasoning, an unknown, a decision, or
computed — by a formula in the register or by a model that records its inputs.
Requirements are checks the register decides over the values' bounds.

Use one when two or more artifacts depend on the same quantities, or when the
person will need to check or vary the numbers. A one-off calculation does not
need one.

## Why it exists

In past runs a safety evaluation estimated vent gas from a literature L/Ah
figure, an H₂ fraction "from memory" and a guessed compartment volume, while the
design itself had no barrier between cells — and nothing tied the three
together. A report and its notebook disagreed on a short-circuit voltage. A
"single source of truth" JSON carried values with no source.

An audit of one report against its sources found twelve discrepancies. Avoid
every one of them:

1. a BMS limit cited from the manual of a different model than the design uses;
2. a figure the report shows as "–" though the source gives it;
3. a trip temperature equal to the cell maximum: no margin;
4. prose saying the converters feed the BMS, contradicting the decision;
5. a figure attributed to the BMS that is really the monitor's;
6. 58.4 V / 6.09 mΩ written as 8.9 kA (it is 9.59), beside an unsourced 54.4 V;
7. "≤ 0.25 mΩ", a maximum, used as the lowest resistance for worst-case fault current;
8. two datasheet editions disagreeing, silently mixed;
9. a current rating taken from a shop's page, not the manufacturer's;
10. a rule that applies only above 800 A CCA, presented unconditionally;
11. ampacity and fastener figures unsourced in the notebook;
12. estimated contact resistances hidden inside a total.

## How to work

1. **Make the register first**, in the task folder:
   \`assumptions_create { folder, title }\`. Plan around it: research steps find
   sources, and the step that writes the register records claims with quotes.
2. **Every world fact, decision and requirement is an entry**
   (\`assumptions_set\`, many per call). Ids are identifiers grouped by their
   first segment, unit last: \`cell_capacity_Ah\`, \`barrier_k_W_mK\`. Each entry
   has exactly one basis; there is no free-standing value.
   - **claims**: what sources say. Each claim has the \`source\` (a kept
     document's automerge: URL, from source_read or the research ledger), a
     verbatim \`quote\`, and the figure as \`stated\` there, in the source's unit.
     Every number you state must be in the quote; the register reads its
     qualifier, so "≤0.25" is stored as an upper bound, never a nominal. Record
     \`subject\` (product and edition), \`conditions\`, \`sourceKind\` and
     \`origin\`. Several claims that disagree need a \`pick\` with a \`reason\`.
   - **estimate**: \`{ value, reasoning }\`. Give bounds — "0.2 (0.1–0.4)" is
     written { nominal: 0.2, min: 0.1, max: 0.4 } — when you can; an estimate
     without them has an unstated spread, and every requirement over it depends.
   - **unknown**: a value nobody has yet, with a range if anyone can give one and
     what would \`settle\` it. It computes like any value: never stop for one.
   - **choice**: a decision, with \`alternatives\` considered.
   - **check**: a requirement, \`a <= b\`, with \`appliesIf\` when it holds only
     sometimes. It holds, fails or depends over the inputs' bounds.
   - \`about\`: an entry whose figures must be about a decision (\`bms_part\`)
     names it, and the register checks each claim's subject against it.
3. **Arithmetic goes in formulas**, not in prose or notebooks:
   \`formula: "pack_V_max / pack_R_min_mOhm"\`. The register computes it over
   nominals and bounds and stores the result with its inputs, so anyone can
   read it without recomputing, and anyone can tell when it's out of date.
4. **Models read the register, never retype it.** \`assumptions_export\` writes a
   JSON, Python or OpenSCAD file of \`id = value\` lines into the folder: the bare
   id is the nominal (only if there is one), bounds are \`id_min\` / \`id_max\`.
   Export again after any change.
5. **Model outputs come back as model results**: \`assumptions_set\` with
   \`model: { url, name, inputs, tolerance, ran }\` and \`value\`, once per run.
   \`ran\` lists every document the run read — the notebook, a CAD file it
   measured, a CFD case — and defaults to \`url\`. The register records the
   inputs as they are now and each document's version; the result is **stale**
   when an input moves beyond the tolerance or the code of a document it read
   changes (comments count). That is how one model's output becomes another's
   constraint, and how coupled loops close. A label or note change is not a
   run: leave \`model\` and \`value\` out. People record runs too, from the panel.
6. **Prose cites by the cite string.** \`assumptions_read\` gives every entry's
   cite string — "≤ 0.25 mΩ (\`cell_R_ac_mOhm\`)". Paste it; the qualifier
   comes with it, and the prose check passes by construction.
   \`assumptions_read\` with \`structure\` shows how the register hangs
   together: "all" for the map of groups, a group's name for its entries, an
   id for its inputs and outputs. Read it before changing a much-read entry;
   a person sees the same map in the Structure lens.
7. **People add evidence and judgement; answer them first.** There is no
   approval. A person may add a claim or a judgement ("this figure is for NMC
   cells"); a judgement that disagrees makes the value conflicting.
   \`assumptions_read\` lists them first; answer each with \`answers\` after
   finding evidence or changing the value, or say why the value stands. When no
   source turns up, record an estimate with bounds and move on.
8. **Before finishing, run \`assumptions_check\`.** It scans the folder, the
   documents model runs read and the kept sources claims quote, and lists
   problems in order — failing checks, conflicts, subject mismatches, quotes no
   longer in a source that changed, stale results, prose that disagrees,
   entries used against their intent — and where effort pays. It is the same
   check a person runs with Check the folder. Resolve every use flag: wire the value into a model, or
   set \`use\` to "reference", or "unused" with a \`useNote\`. Move every constant
   it finds in model code into the register. Weak support and unknowns are
   reported, not blockers: say what they are in the report. Link the register
   pinned at the heads it checked.

## Chains and loops

Follow a quantity from its physical cause to every place it matters. For a
thermal-runaway safety case: cell chemistry and capacity → vent gas volume and
composition (claims), the barrier in the *design* (a choice the CAD also reads)
→ propagation (a model result) → gas released in the worst credible event (a
formula) → with the compartment volume *measured from the CAD* (a model result)
→ ventilation rate and duct size (formulas the CAD reads back) → the
ventilation requirement (a check).

Coupled models form loops: hull CFD → required thrust → propulsion over a design
day → battery energy → battery mass → displacement → CFD again. Formulas can't
form a cycle; loops close through model results. Run the loop until
\`assumptions_check\` reports nothing stale, with each model's \`tolerance\` set.

## What-ifs

A what-if ("a 2 mm barrier", "a cold day") is a Patchwork draft of the task
folder: change the register (and rerun what reads it) in the draft, compare
with the parent, and merge to adopt.
`

export default { documentation }
