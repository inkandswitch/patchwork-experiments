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
const VARIANT = { type: "string", description: "A variant's name, as assumptions_read lists them. Omit for the base register." }

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
      "Keep every number a task's models compute with — cell data, material properties, loads, limits, design choices and model outputs — in one assumptions register, each with its source or marked as an estimate, and have notebooks, CAD, CFD and safety cases read from it and write results back. Read before any engineering or design task whose artifacts share quantities, and before planning one as a workflow.",
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
      "Make an assumptions register for a task and file it in the task's folder. The register holds every number the task's models share, each with where it came from; the folder is where assumptions_where looks for uses. Read the 'assumptions-register' skill first.",
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
      "Read a register's entries: each id, value and unit, kind (fact, decision, requirement, result) and status (verified, cited, estimated, chosen, derived), its source and quote, what a result was computed from, and whether it is STALE because an input changed. Also lists the variants.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        ids: { type: "array", items: { type: "string" }, description: "Only these entry ids." },
        prefix: { type: "string", description: "Only ids starting with this, e.g. 'cell_'." },
        variant: VARIANT,
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
      "Add or change entries in an assumptions register, many per call. Status is decided by the tool: a `quote` from a kept document (`source` an automerge: URL) is looked up there and the entry is 'verified' — a quote that is not in the source is refused; a source without a checkable quote is 'cited'; no source is 'estimated' (or 'chosen' for a decision). A model output is a result: give `inputs`, the ids it was computed from, and the tool records their current values so the result shows as stale when one changes. Fields left out of an existing entry keep their values.",
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
              id: { type: "string", description: "Identifier with at least one underscore, grouped by its first segment: cell_capacity_Ah, barrier_k_W_mK. Not ending in _min/_max." },
              value: {
                description: "A number; a range {min, max, nominal?} (or the text '0.4..1.4 (0.9)'); or text such as a part number.",
              },
              unit: { type: "string", description: "Unit, e.g. 'L/Ah', 'W/m·K', 'kg'." },
              label: { type: "string", description: "A few words for a person." },
              kind: { type: "string", enum: ["fact", "decision", "requirement", "result"], description: "fact (about the world), decision (a choice the design makes), requirement (a limit to meet), result (computed by a model; needs `inputs`). Default: result if `inputs` is given, else fact." },
              source: { type: "string", description: "automerge: URL of the kept document it came from, or a web URL." },
              quote: { type: "string", description: "Verbatim words from the source that give the value — a dozen words, as written there." },
              note: { type: "string", description: "Anything a reader needs: method, caveats, why this estimate." },
              inputs: { type: "array", items: { type: "string" }, description: "For a result: the entry ids it was computed from. Their values now are recorded." },
              by: {
                type: "object",
                description: "For a result: the model that produced it.",
                properties: {
                  name: { type: "string", description: "The model's name, e.g. 'Electrical & thermal notebook'." },
                  url: { type: "string", description: "automerge: URL of the model document." },
                },
              },
            },
          },
        },
        remove: { type: "array", items: { type: "string" }, description: "Entry ids to delete (from the variant, if one is given)." },
        variant: { type: "string", description: "Write into this variant instead of the base; it is made if it does not exist." },
        variantNote: { type: "string", description: "What the variant represents, e.g. 'cold day: -10 °C ambient'. Used when the variant is made or to update it." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).set
    },
  },
  {
    type: "agent:tool",
    id: "assumptions_where",
    name: "Where assumptions are used",
    where: "worker",
    risk: "read",
    description:
      "Search the register's task folder for every use of every entry id — notebooks, OpenSCAD, code files, markdown, datagrids — and report entries nothing uses, constants written straight into model code instead of read from the register, and register names assigned a number that disagrees with the register. Run it before finishing a task that has a register.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        id: { type: "string", description: "Only this entry, with all its uses." },
        folder: { type: "string", description: "Search this folder instead of the register's own scope." },
        variant: VARIANT,
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
      "Write the register as a file models read: JSON, Python or OpenSCAD, one `id = value` per entry (a range adds id_min and id_max; the bare id is its nominal, if it has one). The file says it is generated; an export of the same name in the folder is updated rather than duplicated. Export again after any change to the register.",
    input_schema: {
      type: "object",
      required: ["register"],
      properties: {
        register: REGISTER,
        format: { type: "string", enum: ["json", "python", "scad"], description: "Default json." },
        variant: VARIANT,
        folder: { type: "string", description: "Folder to put it in. Default: the register's scope folder." },
        into: { type: "string", description: "automerge: URL of an earlier export to overwrite." },
        name: { type: "string", description: "File name. Default: the register's title, the variant, and the format's extension." },
      },
    },
    async load() {
      return (await import("./src/agent-tools.js")).exportTool
    },
  },
]
