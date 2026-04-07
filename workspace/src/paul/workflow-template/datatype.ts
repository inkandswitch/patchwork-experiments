import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc, SpecDoc, Spec } from '../../workflow/types';
import type { ElicitationDoc } from '../../types';

export type { WorkflowDoc } from '../../workflow/types';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type StoredAtom = { pred: string; args: string[] };
type StoredConstraint = { body: StoredAtom[]; comment?: string };

type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  title?: string;
  facts: unknown[];
  rules: unknown[];
  constraints: StoredConstraint[];
  derivedFacts?: unknown[];
  draftText?: string;
  mapStyle: { lines: Record<string, unknown>; properties: Record<string, unknown> };
};

type InitialToken = {
  placeId: string;
  state: Record<string, unknown>;
};

type PetriNetPlanDoc = {
  '@patchwork': { type: 'petrinet-plan' };
  initialTokens: InitialToken[];
  systemPromptUrls?: { optimizer?: string; evaluator?: string };
};

type MarkdownDoc = {
  '@patchwork': { type: 'markdown' };
  content: string;
};

export const PaulWorkflowTemplateDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const folderHandle = repo.create<FolderDoc>();
    folderHandle.change((d) => {
      d['@patchwork'] = { type: 'folder' };
      d.title = 'Reference Docs';
      d.docs = [];
    });

    const elicitationHandle = repo.create<ElicitationDoc>();
    elicitationHandle.change((d) => {
      d['@patchwork'] = { type: 'elicitation' };
      d.prompt = '';
      d.referenceDocsFolderUrl = folderHandle.url;
    });

    const { specDocUrl, leafSpecUrls } = createDefaultSpec(repo);

    doc.specElicitationDocUrl = elicitationHandle.url;
    doc.specDocUrl = specDocUrl;
    doc.planDocUrl = createPetriNetDoc(repo, leafSpecUrls);
    doc.toolIds = {
      spec: 'paul-spec-viewer',
    };
  },
  getTitle() {
    return 'Paul Workflow Template';
  },
  setTitle() {},
};

function createPetriNetDoc(repo: Repo, leafSpecUrls: AutomergeUrl[]): AutomergeUrl {
  const handle = repo.create<PetriNetPlanDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'petrinet-plan' };
    d.initialTokens = [
      ...leafSpecUrls.map((specUrl) => ({
        placeId: 'candidates',
        state: {
          type: 'candidate',
          documentUrl: '',
          specUrl,
          prompt: 'Generate a solution that satisfies this specification.',
        },
      })),
      {
        placeId: 'optimizer_idle',
        state: {
          type: 'optimizer',
          documentUrl: '',
          prompt: 'Optimize the candidate solution.',
        },
      },
      {
        placeId: 'evaluator_idle',
        state: {
          type: 'evaluator',
          documentUrl: '',
          prompt: 'Evaluate whether the candidate solution satisfies all constraints in the specification.',
        },
      },
    ];
    d.systemPromptUrls = {
      optimizer: createMarkdownDoc(repo, WORKFLOW_OPTIMIZER_SYSTEM_PROMPT),
      evaluator: createMarkdownDoc(repo, WORKFLOW_EVALUATOR_SYSTEM_PROMPT),
    };
  });
  return handle.url;
}

function createMarkdownDoc(repo: Repo, content: string): string {
  const h = repo.create<MarkdownDoc>();
  h.change((d) => {
    d['@patchwork'] = { type: 'markdown' };
    d.content = content;
  });
  return h.url as string;
}

const WORKFLOW_OPTIMIZER_SYSTEM_PROMPT = `You are an optimization agent improving a solution document.

Your optimization strategy: $PROMPT

The specification is at $SPEC_URL. It is a Patchwork SpecDoc with:
- spec.goal: a description of what needs to be achieved
- spec.verificationUrls: array of Automerge URLs pointing to datalog docs with integrity constraints
  Each datalog doc has: title, draftText (human-readable rules), constraints (machine-checkable)

The document at $DOC_URL is a markdown document. Its structure:
- doc.content: string containing the solution text

Step 1 — Read the specification to understand the goal and constraints:
<script data-description="Read spec and verification rules">
const specHandle = await repo.find("$SPEC_URL")
const specDoc = await specHandle.doc()
const goal = specDoc.spec?.goal ?? ""
const verificationUrls = specDoc.spec?.verificationUrls ?? []
const verifications = await Promise.all(verificationUrls.map(async url => {
  const h = await repo.find(url)
  const d = await h.doc()
  return { url, title: d.title, draftText: d.draftText }
}))
return JSON.stringify({ goal, verifications }, null, 2)
</script>

Step 2 — Read the current solution document:
<script data-description="Read current solution">
const handle = await repo.find("$DOC_URL")
const doc = await handle.doc()
return doc.content
</script>

Step 3 — Write your improved solution to the document:
<script data-description="Write improved solution">
const { updateText } = await import("@automerge/automerge-repo")
const handle = await repo.find("$DOC_URL")
handle.change(d => updateText(d, ["content"], "your improved content here"))
return "Solution updated"
</script>

Apply your strategy. Ensure the solution satisfies the specification constraints. Do not explain — just compute and write.`;

const WORKFLOW_EVALUATOR_SYSTEM_PROMPT = `You are an evaluation agent choosing the best solution from several candidates.

Criteria: $PROMPT

Step 1 — Read all solution documents:
<script data-description="Read all candidate solutions">
const urls = $SOLUTION_URLS
const reads = await Promise.all(urls.map(url =>
  repo.find(url).then(h => h.doc()).then(d => ({ url, content: d?.content ?? "" }))
))
return reads.map(r => \`--- \${r.url} ---\\n\${r.content}\`).join("\\n\\n")
</script>

Step 2 — Pick the best version based on the criteria above.
Respond with ONLY the URL of the winning solution — a single line, nothing else.`;

function createDatalogDoc(
  repo: Repo,
  title: string,
  draftText: string,
  constraints: StoredConstraint[],
): AutomergeUrl {
  const handle = repo.create<DatalogDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = title;
    d.facts = [];
    d.rules = [];
    d.constraints = constraints;
    d.draftText = draftText;
    d.mapStyle = { lines: {}, properties: {} };
  });
  return handle.url;
}

function createDefaultSpec(repo: Repo): { specDocUrl: AutomergeUrl; leafSpecUrls: AutomergeUrl[] } {
  const budgetRulesUrl = createDatalogDoc(
    repo,
    'Budget Rules',
    `% Hospital Staff
staff(alice, dept_a, senior).
staff(bob, dept_a, junior).
staff(carol, dept_b, senior).
staff(dave, dept_b, junior).
staff(eve, dept_a, senior).
staff(frank, dept_b, junior).

% Budget
budget(1000).

% Hospital-wide budget constraint: total scheduled hours must not exceed budget
:- sum(H, scheduled_hours(_, H), Total), budget(B), gt(Total, B).

% Must have exactly 2 department schedules
:- sum(_, department_schedule(_), Count), neq(Count, 2).`,
    [
      {
        body: [
          { pred: 'sum', args: ['H', 'scheduled_hours(_, H)', 'Total'] },
          { pred: 'budget', args: ['B'] },
          { pred: 'gt', args: ['Total', 'B'] },
        ],
        comment: 'Hospital-wide budget constraint: total scheduled hours must not exceed budget',
      },
      {
        body: [
          { pred: 'sum', args: ['_', 'department_schedule(_)', 'Count'] },
          { pred: 'neq', args: ['Count', '2'] },
        ],
        comment: 'Must have exactly 2 department schedules',
      },
    ],
  );

  const generalDeptRulesUrl = createDatalogDoc(
    repo,
    'General Department Rules',
    `% Minimum staff coverage per shift
min_coverage(2).

% Maximum weekly hours per employee
max_hours(40).

% General department constraint: each shift must have minimum staff coverage
:- shift(S), sum(_, assigned(S, _), Count), min_coverage(M), lt(Count, M).

% No employee can work more than max hours per week
:- employee(E), sum(H, assigned(_, E, H), Total), max_hours(M), gt(Total, M).`,
    [
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'sum', args: ['_', 'assigned(S, _)', 'Count'] },
          { pred: 'min_coverage', args: ['M'] },
          { pred: 'lt', args: ['Count', 'M'] },
        ],
        comment: 'General department constraint: each shift must have minimum staff coverage',
      },
      {
        body: [
          { pred: 'employee', args: ['E'] },
          { pred: 'sum', args: ['H', 'assigned(_, E, H)', 'Total'] },
          { pred: 'max_hours', args: ['M'] },
          { pred: 'gt', args: ['Total', 'M'] },
        ],
        comment: 'No employee can work more than max hours per week',
      },
    ],
  );

  const deptARulesUrl = createDatalogDoc(
    repo,
    'Department A Rules',
    `% Department A Staff
staff_in_dept(alice, a).
staff_in_dept(bob, a).
staff_in_dept(eve, a).

% Senior staff in Dept A
senior(alice).
senior(eve).

% Equipment certifications
certified(alice, equipment_a).
certified(eve, equipment_a).

% Department A specific: requires senior staff on night shifts
:- night_shift(S), department(S, a), sum(_, assigned(S, E), senior(E)), Count, lt(Count, 1).

% Department A has specialized equipment requiring certified operators
:- equipment_shift(S), department(S, a), assigned(S, E), not(certified(E, equipment_a)).`,
    [
      {
        body: [
          { pred: 'night_shift', args: ['S'] },
          { pred: 'department', args: ['S', 'a'] },
          { pred: 'sum', args: ['_', 'assigned(S, E)', 'senior(E)'] },
          { pred: 'lt', args: ['Count', '1'] },
        ],
        comment: 'Department A specific: requires senior staff on night shifts',
      },
      {
        body: [
          { pred: 'equipment_shift', args: ['S'] },
          { pred: 'department', args: ['S', 'a'] },
          { pred: 'assigned', args: ['S', 'E'] },
          { pred: 'not', args: ['certified(E, equipment_a)'] },
        ],
        comment: 'Department A has specialized equipment requiring certified operators',
      },
    ],
  );

  const deptBRulesUrl = createDatalogDoc(
    repo,
    'Department B Rules',
    `% Department B Staff
staff_in_dept(carol, b).
staff_in_dept(dave, b).
staff_in_dept(frank, b).

% Senior staff in Dept B
senior(carol).

% Max patient-to-staff ratio
max_ratio(5).

% Department B specific: maximum patient-to-staff ratio
:- shift(S), department(S, b), patients(S, P), sum(_, assigned(S, _), Staff), div(P, Staff, Ratio), max_ratio(M), gt(Ratio, M).

% Department B requires on-call availability
:- shift(S), department(S, b), not(has_oncall(S)).`,
    [
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'department', args: ['S', 'b'] },
          { pred: 'patients', args: ['S', 'P'] },
          { pred: 'sum', args: ['_', 'assigned(S, _)', 'Staff'] },
          { pred: 'div', args: ['P', 'Staff', 'Ratio'] },
          { pred: 'max_ratio', args: ['M'] },
          { pred: 'gt', args: ['Ratio', 'M'] },
        ],
        comment: 'Department B specific: maximum patient-to-staff ratio',
      },
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'department', args: ['S', 'b'] },
          { pred: 'not', args: ['has_oncall(S)'] },
        ],
        comment: 'Department B requires on-call availability',
      },
    ],
  );

  const deptASpecHandle = repo.create<SpecDoc>();
  deptASpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Department A Schedule',
      verificationUrls: [generalDeptRulesUrl, deptARulesUrl],
    };
  });

  const deptBSpecHandle = repo.create<SpecDoc>();
  deptBSpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Department B Schedule',
      verificationUrls: [generalDeptRulesUrl, deptBRulesUrl],
    };
  });

  const spec: Spec = {
    goal: 'Hospital Schedule',
    verificationUrls: [budgetRulesUrl],
    subSpecUrls: [deptASpecHandle.url, deptBSpecHandle.url],
  };

  const specHandle = repo.create<SpecDoc>();
  specHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = spec;
  });

  return {
    specDocUrl: specHandle.url,
    leafSpecUrls: [deptASpecHandle.url, deptBSpecHandle.url],
  };
}
