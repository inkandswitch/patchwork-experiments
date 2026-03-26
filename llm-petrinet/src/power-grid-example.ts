import type { DatatypeImplementation, ToolRender } from '@inkandswitch/patchwork-plugins';
import type { Repo, DocHandle } from '@automerge/automerge-repo';
import type { LLMPetriNetDoc } from './types';

// ─── Optimizer prompts ───────────────────────────────────────────────────────

const CONCENTRATED_PROMPT = `Concentrated generation strategy. Only generator-type nodes should produce power. Set generates to 0 for all non-generator nodes. Calculate the minimum generation at generator nodes that satisfies node flow balance everywhere: at each node, inflow + generation = outflow + consumption.`;

const DISTRIBUTED_PROMPT = `Distributed generation strategy. Spread generation across all nodes proportional to their local demand (consumption + outflow - inflow). The goal is to minimize the maximum flow on any single edge, reducing transmission losses. Every node may generate.`;

const MINIMUM_PROMPT = `Minimum total generation strategy. Find the mathematically minimal total generation across all nodes that satisfies every constraint: node flow balance (inflow + generation = outflow + consumption at each node) and edge capacity limits (flow <= capacity on every edge). Use exact arithmetic — do not over-generate.`;

// ─── Evaluator prompt ────────────────────────────────────────────────────────

const EVALUATOR_PROMPT = `Select the best power grid generation configuration. Rank by:
1. Zero constraint violations (use checkConflicts to verify)
2. Minimum total generation (most efficient)
3. Node balance correctness: at every node, inflow + generation must equal outflow + consumption exactly`;

// ─── Custom system prompt templates ──────────────────────────────────────────

const OPTIMIZER_SYSTEM_PROMPT = `You are a power grid engineer optimizing generation values for a Datalog power grid model.

Your optimization strategy: $PROMPT

The document at $DOC_URL is a Datalog database stored as an Automerge document. Its structure:
- doc.facts: array of { pred: string, args: (string|number)[] }
- Key predicates: node(name, type), edge(from, to, capacity_mw), generates(node, mw), consumes(node, mw), flow(from, to, mw)
- doc.rules and doc.constraints define derived predicates and integrity checks

The key constraint is node flow balance: at every node, inflow + generation = outflow + consumption. Flows on each edge must not exceed the edge capacity.

You must update ONLY the generates(node, mw) facts. Do not change flows, consumption, edges, rules, or constraints.

Step 1 — Read the current power grid state:
<script data-description="Read datalog facts">
const handle = await repo.find("$DOC_URL")
const doc = await handle.doc()
const facts = doc.facts
const nodes = facts.filter(f => f.pred === "node")
const generates = facts.filter(f => f.pred === "generates")
const consumes = facts.filter(f => f.pred === "consumes")
const flows = facts.filter(f => f.pred === "flow")
const edges = facts.filter(f => f.pred === "edge")
return JSON.stringify({ nodes, generates, consumes, flows, edges }, null, 2)
</script>

Step 2 — Calculate optimal generation values using your strategy, then update the generates facts. Modify only the args[1] value (the MW number) on existing generates facts:
<script data-description="Update generation values">
const handle = await repo.find("$DOC_URL")
handle.change(d => {
  for (const fact of d.facts) {
    if (fact.pred === "generates") {
      // Set fact.args[1] to your calculated value for this node (fact.args[0])
      // Example: if (fact.args[0] === "north") fact.args[1] = 400
    }
  }
})
return "Generation values updated"
</script>

Write your calculated values into the script above. Do not explain — just compute and write.`;

const EVALUATOR_SYSTEM_PROMPT = `You are a power grid analyst choosing the best generation configuration from several candidates.

Criteria: $PROMPT

Step 1 — Resolve the datalog skill URL for constraint checking:
<script data-description="Resolve datalog skill URL">
const DATALOG_SKILL_URL = getSkillURL("datalog")
return DATALOG_SKILL_URL
</script>

Step 2 — Read all candidate solutions and check each for constraint violations:
<script data-description="Read and verify all solutions">
const { checkConflicts } = await import(DATALOG_SKILL_URL)
const urls = $SOLUTION_URLS
const results = await Promise.all(urls.map(async url => {
  const handle = await repo.find(url)
  const doc = await handle.doc()
  const violations = await checkConflicts(repo, url)
  const generates = doc.facts.filter(f => f.pred === "generates")
  const totalGen = generates.reduce((sum, f) => sum + Number(f.args[1]), 0)
  return {
    url,
    violations: violations.length,
    totalGen,
    generates: generates.map(f => f.args[0] + ": " + f.args[1] + " MW").join(", ")
  }
}))
return JSON.stringify(results, null, 2)
</script>

Step 3 — Pick the best solution. Prefer solutions with zero violations. Among those, pick the one with minimum total generation.
Respond with ONLY the URL of the winning solution — a single line, nothing else.`;

// ─── Power grid facts (generates zeroed out — the optimization target) ───────

type Fact = { pred: string; args: (string | number)[]; comment?: string };
type Atom = { pred: string; args: string[] };
type Rule = { head: Atom; body: Atom[]; comment?: string };
type Constraint = { body: Atom[]; comment?: string };

const POWER_GRID_FACTS: Fact[] = [
  // 7 nodes
  { pred: 'node', args: ['north', 'generator'], comment: 'wind farm' },
  { pred: 'node', args: ['northeast', 'generator'], comment: 'solar farm' },
  { pred: 'node', args: ['central', 'substation'] },
  { pred: 'node', args: ['west', 'generator'], comment: 'gas turbine' },
  { pred: 'node', args: ['east', 'substation'] },
  { pred: 'node', args: ['south', 'load'], comment: 'industrial district' },
  { pred: 'node', args: ['southeast', 'load'], comment: 'residential area' },

  // 9 transmission lines
  { pred: 'edge', args: ['north', 'central', 600], comment: 'transmission line capacity (MW)' },
  { pred: 'edge', args: ['northeast', 'central', 400] },
  { pred: 'edge', args: ['northeast', 'east', 300] },
  { pred: 'edge', args: ['west', 'central', 500] },
  { pred: 'edge', args: ['central', 'east', 450] },
  { pred: 'edge', args: ['central', 'south', 700] },
  { pred: 'edge', args: ['east', 'south', 350] },
  { pred: 'edge', args: ['east', 'southeast', 400] },
  { pred: 'edge', args: ['south', 'southeast', 250] },

  // generation — all zeroed, to be optimized
  { pred: 'generates', args: ['north', 0], comment: 'generation to be optimized' },
  { pred: 'generates', args: ['northeast', 0] },
  { pred: 'generates', args: ['central', 0] },
  { pred: 'generates', args: ['west', 0] },
  { pred: 'generates', args: ['east', 0] },
  { pred: 'generates', args: ['south', 0] },
  { pred: 'generates', args: ['southeast', 0] },

  // consumption
  { pred: 'consumes', args: ['north', 0] },
  { pred: 'consumes', args: ['northeast', 0] },
  { pred: 'consumes', args: ['central', 120] },
  { pred: 'consumes', args: ['west', 0] },
  { pred: 'consumes', args: ['east', 200] },
  { pred: 'consumes', args: ['south', 500] },
  { pred: 'consumes', args: ['southeast', 350] },

  // proposed flows
  { pred: 'flow', args: ['north', 'central', 450] },
  { pred: 'flow', args: ['northeast', 'central', 200] },
  { pred: 'flow', args: ['northeast', 'east', 150] },
  { pred: 'flow', args: ['west', 'central', 300] },
  { pred: 'flow', args: ['central', 'east', 250] },
  { pred: 'flow', args: ['central', 'south', 500] },
  { pred: 'flow', args: ['east', 'south', 100] },
  { pred: 'flow', args: ['east', 'southeast', 200] },
  { pred: 'flow', args: ['south', 'southeast', 100] },

  // geographic positions (Berlin area)
  { pred: 'geopos', args: ['north', 52.58, 13.35] },
  { pred: 'geopos', args: ['northeast', 52.57, 13.47] },
  { pred: 'geopos', args: ['central', 52.52, 13.40] },
  { pred: 'geopos', args: ['west', 52.52, 13.28] },
  { pred: 'geopos', args: ['east', 52.52, 13.52] },
  { pred: 'geopos', args: ['south', 52.46, 13.40] },
  { pred: 'geopos', args: ['southeast', 52.45, 13.52] },
];

const POWER_GRID_RULES: Rule[] = [
  { head: { pred: 'inflow', args: ['N', 'Total'] }, body: [{ pred: 'sum', args: ['F', 'flow(_, N, F)', 'Total'] }], comment: 'inflow aggregate' },
  { head: { pred: 'outflow', args: ['N', 'Total'] }, body: [{ pred: 'sum', args: ['F', 'flow(N, _, F)', 'Total'] }], comment: 'outflow aggregate' },

  { head: { pred: 'reachable', args: ['X', 'Y'] }, body: [{ pred: 'edge', args: ['X', 'Y', '_'] }] },
  { head: { pred: 'reachable', args: ['X', 'Z'] }, body: [{ pred: 'reachable', args: ['X', 'Y'] }, { pred: 'edge', args: ['Y', 'Z', '_'] }] },

  { head: { pred: 'within_capacity', args: ['X', 'Y'] }, body: [{ pred: 'edge', args: ['X', 'Y', 'C'] }, { pred: 'flow', args: ['X', 'Y', 'F'] }, { pred: 'lte', args: ['F', 'C'] }], comment: 'capacity check' },
  { head: { pred: 'overloaded', args: ['X', 'Y'] }, body: [{ pred: 'edge', args: ['X', 'Y', 'C'] }, { pred: 'flow', args: ['X', 'Y', 'F'] }, { pred: 'gt', args: ['F', 'C'] }] },

  { head: { pred: 'utilization', args: ['X', 'Y', 'Pct'] }, body: [{ pred: 'edge', args: ['X', 'Y', 'C'] }, { pred: 'flow', args: ['X', 'Y', 'F'] }, { pred: 'div', args: ['F', 'C', 'Pct'] }] },
  { head: { pred: 'underutilized', args: ['X', 'Y'] }, body: [{ pred: 'utilization', args: ['X', 'Y', 'Pct'] }, { pred: 'lt', args: ['Pct', '0.5'] }] },

  {
    head: { pred: 'node_balanced', args: ['N'] },
    body: [
      { pred: 'generates', args: ['N', 'G'] }, { pred: 'consumes', args: ['N', 'C'] },
      { pred: 'sum', args: ['F', 'flow(_, N, F)', 'In'] }, { pred: 'sum', args: ['F', 'flow(N, _, F)', 'Out'] },
      { pred: 'add', args: ['In', 'G', 'Supply'] }, { pred: 'add', args: ['Out', 'C', 'Demand'] },
      { pred: 'gte', args: ['Supply', 'Demand'] },
    ],
    comment: 'node conservation',
  },

  {
    head: { pred: 'grid_balanced', args: [] },
    body: [
      { pred: 'sum', args: ['G', 'generates(_, G)', 'TotalGen'] },
      { pred: 'sum', args: ['C', 'consumes(_, C)', 'TotalCon'] },
      { pred: 'gte', args: ['TotalGen', 'TotalCon'] },
    ],
    comment: 'global balance',
  },

  {
    head: { pred: 'net_balance', args: ['N', 'B'] },
    body: [{ pred: 'generates', args: ['N', 'G'] }, { pred: 'consumes', args: ['N', 'C'] }, { pred: 'sub', args: ['G', 'C', 'B'] }],
  },

  {
    head: { pred: 'node_flow_balance', args: ['N', 'Net'] },
    body: [
      { pred: 'generates', args: ['N', 'G'] }, { pred: 'consumes', args: ['N', 'C'] },
      { pred: 'sum', args: ['F', 'flow(_, N, F)', 'In'] }, { pred: 'sum', args: ['F', 'flow(N, _, F)', 'Out'] },
      { pred: 'add', args: ['In', 'G', 'Supply'] }, { pred: 'add', args: ['Out', 'C', 'Demand'] },
      { pred: 'sub', args: ['Supply', 'Demand', 'Net'] },
    ],
    comment: 'node flow conservation (inflow + gen - outflow - consumption)',
  },
];

const POWER_GRID_CONSTRAINTS: Constraint[] = [
  { body: [{ pred: 'overloaded', args: ['X', 'Y'] }], comment: 'transmission lines must never exceed rated capacity' },
  { body: [{ pred: 'node_flow_balance', args: ['N', 'Net'] }, { pred: 'neq', args: ['Net', '0'] }], comment: 'node conservation: inflow + generation = outflow + consumption' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function createMarkdownDoc(repo: Repo, content: string): string {
  const h = repo.create<Record<string, unknown>>();
  h.change((d: Record<string, unknown>) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return h.url as string;
}

function createDatalogDoc(repo: Repo, facts: Fact[], rules: Rule[], constraints: Constraint[]): string {
  const h = repo.create<Record<string, unknown>>();
  h.change((d: Record<string, unknown>) => {
    d['@patchwork'] = { type: 'datalog' };
    d.facts = facts.map((f) => ({ ...f }));
    d.rules = rules.map((r) => ({
      head: { pred: r.head.pred, args: [...r.head.args] },
      body: r.body.map((a) => ({ pred: a.pred, args: [...a.args] })),
      ...(r.comment !== undefined ? { comment: r.comment } : {}),
    }));
    d.constraints = constraints.map((c) => ({
      body: c.body.map((a) => ({ pred: a.pred, args: [...a.args] })),
      ...(c.comment !== undefined ? { comment: c.comment } : {}),
    }));
    d.mapStyle = { lines: {}, properties: {} };
  });
  return h.url as string;
}

// ─── Template datatype ───────────────────────────────────────────────────────

export const LLMPetriNetPowerGridExampleDatatype: DatatypeImplementation<LLMPetriNetDoc> = {
  init(doc, repo) {
    doc.tokens = {
      problems: [
        { id: makeId(), state: { type: 'problem', documentUrl: createDatalogDoc(repo, POWER_GRID_FACTS, POWER_GRID_RULES, POWER_GRID_CONSTRAINTS) } },
      ],
      optimizer_idle: [
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, CONCENTRATED_PROMPT) } },
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, DISTRIBUTED_PROMPT) } },
        { id: makeId(), state: { type: 'optimizer', documentUrl: createMarkdownDoc(repo, MINIMUM_PROMPT) } },
      ],
      optimizer_running: [],
      solutions: [],
      evaluator_idle: [
        { id: makeId(), state: { type: 'evaluator', documentUrl: createMarkdownDoc(repo, EVALUATOR_PROMPT) } },
      ],
      evaluator_running: [],
    };

    doc.systemPromptUrls = {
      optimizer: createMarkdownDoc(repo, OPTIMIZER_SYSTEM_PROMPT),
      evaluator: createMarkdownDoc(repo, EVALUATOR_SYSTEM_PROMPT),
    };
  },

  getTitle() {
    return 'LLM Petri Net — Power Grid';
  },
};

// ─── Rewrite tool ────────────────────────────────────────────────────────────

export const LLMPetriNetPowerGridExampleTool: ToolRender = (handle, _element) => {
  (handle as DocHandle<LLMPetriNetDoc>).change((d) => {
    d['@patchwork'] = { type: 'llm-petrinet' };
  });
  return () => {};
};
