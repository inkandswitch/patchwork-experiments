import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { SpecDoc, Spec, VerificationContextDoc } from '../../workflow/types';

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

function createVerificationContext(
  repo: Repo,
  verificationUrl: AutomergeUrl,
  artifactUrls: AutomergeUrl[],
): AutomergeUrl {
  const handle = repo.create<VerificationContextDoc & { '@patchwork': { type: string } }>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'verification-context' };
    d.verificationUrl = verificationUrl;
    d.artifactUrls = artifactUrls;
  });
  return handle.url;
}

export function createDefaultSpec(
  repo: Repo,
): {
  specDocUrl: AutomergeUrl;
  subSpecUrls: AutomergeUrl[];
  verificationDatalogUrls: AutomergeUrl[];
  verificationContextUrls: AutomergeUrl[];
} {
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

  // Wrap each verification datalog doc in a VerificationContextDoc (empty artifactUrls for spec)
  const budgetRulesVcUrl = createVerificationContext(repo, budgetRulesUrl, []);
  const generalDeptRulesVcUrl = createVerificationContext(repo, generalDeptRulesUrl, []);
  const deptARulesVcUrl = createVerificationContext(repo, deptARulesUrl, []);
  const deptBRulesVcUrl = createVerificationContext(repo, deptBRulesUrl, []);

  const deptASpecHandle = repo.create<SpecDoc>();
  deptASpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Department A Schedule',
      verificationUrls: [generalDeptRulesVcUrl, deptARulesVcUrl],
    };
  });

  const deptBSpecHandle = repo.create<SpecDoc>();
  deptBSpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Department B Schedule',
      verificationUrls: [generalDeptRulesVcUrl, deptBRulesVcUrl],
    };
  });

  const spec: Spec = {
    goal: 'Hospital Schedule',
    verificationUrls: [budgetRulesVcUrl],
    subSpecUrls: [deptASpecHandle.url, deptBSpecHandle.url],
  };

  const specHandle = repo.create<SpecDoc>();
  specHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = spec;
  });

  return {
    specDocUrl: specHandle.url,
    subSpecUrls: [deptASpecHandle.url, deptBSpecHandle.url],
    verificationDatalogUrls: [budgetRulesUrl, generalDeptRulesUrl, deptARulesUrl, deptBRulesUrl],
    verificationContextUrls: [budgetRulesVcUrl, generalDeptRulesVcUrl, deptARulesVcUrl, deptBRulesVcUrl],
  };
}
