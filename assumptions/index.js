/**
 * Plugin registration — metadata only.
 *
 * Patchwork evaluates this module in a Web Worker with no importmap and
 * structured-clones every entry to the main thread, so nothing here may be a
 * function except `load()`, and this file imports nothing: each
 * implementation is behind a dynamic import inside its own `load()`.
 *
 * The `agent:tool` entries carry their description and schema as plain JSON,
 * because the agent reads them before it loads anything. index.test.js checks
 * that every input src/agent-tools.js reads is declared here.
 */

const REGISTER = { type: "string", description: "automerge: URL of the assumptions register (from assumptions_create, or the task folder)." }
const VALUE = {
  description: "A figure: a number, text such as '5.42 ± 0.3', '≤ 0.25', '≥ 6000', '0.4–1.4 (0.9)' or '3.2 typ', or { nominal?, tol?, min?, max?, exact? }. A missing side is unbounded. Text that isn't a figure (a part number) stays text.",
}

const CLAIM = {
  type: "object",
  required: ["stated"],
  properties: {
    key: { type: "string", description: "To keep a claim already on the entry unchanged, give just its key (c1, c2…) from assumptions_read." },
    source: { type: "string", description: "automerge: URL of the kept source (from source_read or the research ledger), or a web URL. A kept source's quote is checked." },
    quote: { type: "string", description: "Verbatim words from the source that give the figure — a dozen words, as written there, qualifier and all ('≤0.25 mΩ')." },
    stated: { ...VALUE, description: "The figure as the quote gives it, in the source's own unit: every number here must be in the quote. A bare number against a quoted '≤' or '±' is stored with the quote's qualifier." },
    statedUnit: { type: "string", description: "The source's unit, when it differs from the entry's (then give `factor`)." },
    factor: { type: "number", description: "Multiplies the stated figure into the entry's unit (1000 for kA → A). Default 1." },
    subject: { type: "string", description: "What the figure is about: product and edition ('EVE LF280K, Version B (2023)')." },
    conditions: { type: "string", description: "Conditions the figure holds under ('@0.5C/0.5C, 25 °C, 300 kgf clamp')." },
    sourceKind: { type: "string", enum: ["datasheet", "standard", "test-report", "paper", "measurement", "definition", "standard-summary", "retailer", "article", "calculation", "other"], description: "What kind of source. Primary kinds (datasheet, standard, test-report, paper, measurement, definition) with a verified quote support a value; the rest are weak on their own. A definition is exact." },
    origin: { type: "string", description: "Who the figure originally comes from (the manufacturer, the standards body). Two claims of the same origin — two datasheet editions, a shop copying a datasheet — count once toward corroboration." },
  },
}

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "assumptions",
    name: "Assumptions",
    icon: "ListChecks",
    async load() {
      return (await import("./src/datatype.js")).AssumptionsDatatype
    },
  },
  {
    type: "patchwork:tool",
    id: "assumptions",
    name: "Assumptions",
    icon: "ListChecks",
    supportedDatatypes: ["assumptions"],
    async load() {
      const { AssumptionsView } = await import("./src/view.js")
      return (handle, element) => AssumptionsView(handle, element)
    },
  },
  {
    type: "patchwork:skill",
    id: "assumptions-register",
    name: "Assumptions register",
    description:
      "Keep every number a task's models compute with — cell data, material properties, loads, limits, design choices and model outputs — in one assumptions register: each value either a claim on a quoted source, an estimate with its reasoning, an unknown, a choice, or computed by a formula or a model, with requirements checked over the values' bounds. Read before any engineering or design task whose artifacts share quantities, and before planning one as a workflow.",
    async load() {
      return (await import("./src/skill.js")).default
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_create",
    name: "Make an assumptions register",
    where: "worker",
    risk: "edit",
    description:
      "Make an assumptions register for a task and file it in the task's folder. The register holds every number the task's models share, each with where it came from; the folder is where assumptions_check and assumptions_where look for uses. Read the 'assumptions-register' skill first.",
    input_schema: {
      type: "object",
      required: ["folder"],
      properties: {
        folder: { type: "string", description: "automerge: URL of the task folder whose documents will use these entries." },
        title: { type: "string", description: "What to call it, e.g. 'Battery assumptions'." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).create
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_read",
    name: "Read an assumptions register",
    where: "worker",
    risk: "read",
    description:
      "Read a register. Always starts with a one-line summary, then people's judgements to answer, then problems with a fix for each. With no filter it lists one line per group; with `prefix` or `ids` it gives each entry's figure line — value with its qualifier and bounds, kind and support (corroborated, supported, weak, none; chosen for decisions), evidence, uses — and its cite string, the exact text to paste into prose. With `detail` it adds sources and quotes, the calculation, its inputs and outputs, uses and judgements. With `structure` it gives the register's structure: the map of groups, one group's entries, or one entry's inputs and outputs.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        ids: { type: "array", items: { type: "string" }, description: "Only these entry ids." },
        prefix: { type: "string", description: "Only ids starting with this, e.g. 'cell_'." },
        detail: { type: "boolean", description: "With `ids`: the full basis (claims, quotes and how they were read; the formula with values in), its inputs and outputs, its uses and judgements." },
        page: { type: "number", description: "Which page of 40 entries, from 1." },
        structure: { type: "string", description: "The register's structure instead of its entries, as the Structure lens draws it. \"all\": the map of groups (an id's first word) in flow order, what each reads and how many links, and the stale paths. A group's name (\"pack\"): its entries, given and computed, what each reads and what reads it. An entry's id: its inputs and outputs." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).read
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_set",
    name: "Set assumptions",
    where: "worker",
    risk: "edit",
    description:
      "Add or change entries, many per call. Each entry has exactly one basis: `claims` (what sources say, each with a verbatim `quote` — checked against a kept source — and the figure as `stated` there; several disagreeing claims need a `pick` with a reason), `estimate` (value + reasoning), `unknown` (a named gap, maybe a range), `choice` (a decision, with alternatives), `formula` (arithmetic over other entries; the register computes it), `model` (an external model's output, its `inputs` recorded so it goes stale when they move) or `check` (a requirement, decided over the inputs' bounds). There is no free-standing value. Support is computed from the evidence, never set. Also answers people's judgements. Fields left out keep their values.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        entries: {
          type: "array",
          description: "The entries to write.",
          items: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", description: "Identifier with at least one underscore, grouped by its first segment, unit last: cell_capacity_Ah, barrier_k_W_mK. Not ending in _min/_max." },
              kind: { type: "string", enum: ["fact", "decision", "requirement", "result"], description: "fact (about the world), decision (a choice the design makes), requirement (a limit, or a check), result (computed). Default from the basis." },
              label: { type: "string", description: "A few words for a person." },
              unit: { type: "string", description: "The entry's unit, e.g. 'L/Ah', 'mΩ', 'kg'." },
              note: { type: "string", description: "Anything a reader needs that isn't a source or a reason elsewhere." },
              claims: { type: "array", items: CLAIM, description: "Basis: what sources say. Replaces the agent's claims; a person's claim must be kept by listing { key } or dropped with a `why`." },
              pick: {
                type: "object",
                description: "Which claim gives the value when there are several: rule 'one' with `claim` (key, or place in `claims` from 0), or 'lowest', 'highest', 'envelope'. Needs a `reason` when the claims disagree; claims not picked stay as evidence considered.",
                properties: {
                  rule: { type: "string", enum: ["one", "lowest", "highest", "envelope"], description: "How the value comes from the claims." },
                  claim: { description: "For rule 'one': the claim's key (c1) or its place in `claims`, counting from 0." },
                  reason: { type: "string", description: "Why this one: the newer edition, the manufacturer over a shop, the worst case…" },
                },
              },
              estimate: {
                type: "object",
                description: "Basis: an engineering estimate. Give bounds when you can: an estimate without them has an unstated spread, and every check over it depends.",
                properties: { value: VALUE, reasoning: { type: "string", description: "How the number was arrived at." } },
              },
              unknown: {
                description: "Basis: a value nobody has yet. `true`, or { range?, settle? }. It computes like any value — results over it show it — and it is the task's to-do list.",
                properties: { range: VALUE, settle: { type: "string", description: "The test or source that would settle it." } },
              },
              choice: {
                type: "object",
                description: "Basis: a decision the design makes. Exact by definition.",
                properties: {
                  value: VALUE,
                  rationale: { type: "string", description: "Why this choice." },
                  alternatives: { type: "array", description: "What else was considered: [{ value, note }].", items: { type: "object", properties: { value: VALUE, note: { type: "string", description: "Why not this one." } } } },
                },
              },
              formula: { type: "string", description: "Basis: arithmetic over other entries — + − × ÷ ^, min, max, sqrt, abs, pow, numbers — e.g. 'pack_V_max / pack_R_min_mOhm'. The register computes it over nominals and bounds and stores the result with its inputs. No cycles." },
              model: {
                type: "object",
                description: "Basis: an external model's output (a notebook, a CFD case). The register records the inputs' values now and marks the result stale when one moves beyond `tolerance`.",
                properties: {
                  url: { type: "string", description: "automerge: URL of the model document; pinned to its heads now." },
                  name: { type: "string", description: "The model's name." },
                  inputs: { type: "array", items: { type: "string" }, description: "The entry ids it read." },
                  tolerance: { type: "number", description: "Relative tolerance for staleness: 0.02 = an input may move 2% before the result is stale. Default 0." },
                },
              },
              value: { ...VALUE, description: "For a `model` result: its output. For a decision, shorthand for `choice.value`. Nothing else has a free-standing value." },
              check: { type: "string", description: "Basis: a requirement the register checks, e.g. 'pack_Isc_kA <= fuse_I_break_kA'. Holds, fails or depends over the inputs' bounds." },
              appliesIf: { type: "string", description: "For a check: when it applies, e.g. 'pack_cca_A > 800 and boat_len_m >= 8'. n/a when false." },
              about: { type: "string", description: "The decision this entry's figures must be about (e.g. bms_part): each used claim's `subject` must name the decision's value." },
              use: { type: "string", enum: ["model", "reference", "unused"], description: "What it's for: computed with (default), context for prose (default for limits), or kept unused on purpose (with `useNote`)." },
              useNote: { type: "string", description: "Why it's kept unused: an alternative, a cross-check…" },
            },
          },
        },
        remove: { type: "array", items: { type: "string" }, description: "Entry ids to delete." },
        answers: {
          type: "array",
          description: "Answer people's judgements (assumptions_read lists them first): [{ id, judgement, says }], after changing the value, or saying why it stands.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "The entry." },
              judgement: { type: "string", description: "The judgement's key (j1…)." },
              says: { type: "string", description: "What you did, or why the value stands." },
            },
          },
        },
        why: { type: "string", description: "Why this change: written as the change's message in the register's history. Needed to drop or override a person's claim or judgement." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).set
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_check",
    name: "Check an assumptions register",
    where: "worker",
    risk: "edit",
    description:
      "The before-you-finish call. Scans the task folder (rereading only documents that changed), saves the scan in the register, and returns everything to act on in order: judgements to answer, problems (failing checks, conflicts, subject mismatches, stale model results, prose that disagrees with the register, entries used against their intent), where effort pays (the leaf that would settle each requirement that depends), unknowns, constants written into model code, drifted copies. Weak support and unknowns are reported, not blockers. Ends with a link to the register pinned as checked.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        folder: { type: "string", description: "Scan this folder instead of the register's own scope." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).check
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_where",
    name: "Where assumptions are used",
    where: "worker",
    risk: "edit",
    description:
      "Where entries are used: with `id`, every use of that entry — in the register (formulas, checks, model inputs) and in the folder's documents, as model code or prose, with line excerpts. Without, the use flags, prose disagreements, constants in model code and drifted copies. Rescans changed documents and saves the scan.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        id: { type: "string", description: "Only this entry, with all its uses." },
        folder: { type: "string", description: "Search this folder instead of the register's own scope." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).where
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_export",
    name: "Export assumptions for models",
    where: "worker",
    risk: "edit",
    description:
      "Write the register as a file models read: JSON, Python or OpenSCAD, one `id = value` per entry at full precision. The bare id is the nominal, written only when there is one; bounds are id_min and id_max, written only when stated. Unknowns are listed in a comment. An export of the same name in the folder is updated rather than duplicated. Export again after any change to the register.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        format: { type: "string", enum: ["json", "python", "scad"], description: "Default json." },
        folder: { type: "string", description: "Folder to put it in. Default: the register's scope folder." },
        into: { type: "string", description: "automerge: URL of an earlier export to overwrite." },
        name: { type: "string", description: "File name. Default: the register's title and the format's extension." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).exportTool
    },
  },
]
