import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { ExecutionDoc, VerificationContextDoc } from '../../workflow/types';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

type StoredAtom = { pred: string; args: string[] };
type StoredConstraint = { body: StoredAtom[]; comment?: string };
type StoredFact = { pred: string; args: (string | number)[]; comment?: string };

type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  title?: string;
  facts: StoredFact[];
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
  facts: StoredFact[],
): AutomergeUrl {
  const handle = repo.create<DatalogDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = title;
    d.facts = facts;
    d.rules = [];
    d.constraints = [];
    d.draftText = draftText;
    d.mapStyle = { lines: {}, properties: {} };
  });
  return handle.url;
}

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

export function createDefaultExecution(
  repo: Repo,
  specDocUrl: AutomergeUrl,
  planDocUrl: AutomergeUrl,
  verificationDatalogUrls: AutomergeUrl[],
): { executionDocUrl: AutomergeUrl; artifactDocUrls: AutomergeUrl[] } {
  // Department A schedule facts
  const deptAFacts: StoredFact[] = [
    f('department_schedule', 'dept_a'),
    f('scheduled_hours', 'dept_a', 480),

    // Monday
    f('shift', 'a_mon_day'),
    f('department', 'a_mon_day', 'a'),
    f('assigned', 'a_mon_day', 'alice', 8),
    f('assigned', 'a_mon_day', 'bob', 8),
    f('employee', 'alice'),
    f('employee', 'bob'),
    f('employee', 'eve'),

    f('night_shift', 'a_mon_night'),
    f('shift', 'a_mon_night'),
    f('department', 'a_mon_night', 'a'),
    f('assigned', 'a_mon_night', 'alice', 8),
    f('assigned', 'a_mon_night', 'eve', 8),
    f('senior', 'alice'),
    f('senior', 'eve'),

    f('equipment_shift', 'a_mon_equip'),
    f('shift', 'a_mon_equip'),
    f('department', 'a_mon_equip', 'a'),
    f('assigned', 'a_mon_equip', 'alice', 4),
    f('assigned', 'a_mon_equip', 'eve', 4),
    f('certified', 'alice', 'equipment_a'),
    f('certified', 'eve', 'equipment_a'),

    // Tuesday
    f('shift', 'a_tue_day'),
    f('department', 'a_tue_day', 'a'),
    f('assigned', 'a_tue_day', 'eve', 8),
    f('assigned', 'a_tue_day', 'bob', 8),

    f('night_shift', 'a_tue_night'),
    f('shift', 'a_tue_night'),
    f('department', 'a_tue_night', 'a'),
    f('assigned', 'a_tue_night', 'eve', 8),
    f('assigned', 'a_tue_night', 'alice', 8),

    // Wednesday
    f('shift', 'a_wed_day'),
    f('department', 'a_wed_day', 'a'),
    f('assigned', 'a_wed_day', 'alice', 8),
    f('assigned', 'a_wed_day', 'bob', 8),

    f('night_shift', 'a_wed_night'),
    f('shift', 'a_wed_night'),
    f('department', 'a_wed_night', 'a'),
    f('assigned', 'a_wed_night', 'alice', 4),
    f('assigned', 'a_wed_night', 'eve', 4),
  ];

  const deptADraftText = `% Department A Schedule Solution
department_schedule(dept_a).
scheduled_hours(dept_a, 480).

% Monday
shift(a_mon_day). department(a_mon_day, a).
assigned(a_mon_day, alice, 8). assigned(a_mon_day, bob, 8).

night_shift(a_mon_night). shift(a_mon_night). department(a_mon_night, a).
assigned(a_mon_night, alice, 8). assigned(a_mon_night, eve, 8).

equipment_shift(a_mon_equip). shift(a_mon_equip). department(a_mon_equip, a).
assigned(a_mon_equip, alice, 4). assigned(a_mon_equip, eve, 4).

% Tuesday
shift(a_tue_day). department(a_tue_day, a).
assigned(a_tue_day, eve, 8). assigned(a_tue_day, bob, 8).

night_shift(a_tue_night). shift(a_tue_night). department(a_tue_night, a).
assigned(a_tue_night, eve, 8). assigned(a_tue_night, alice, 8).

% Wednesday
shift(a_wed_day). department(a_wed_day, a).
assigned(a_wed_day, alice, 8). assigned(a_wed_day, bob, 8).

night_shift(a_wed_night). shift(a_wed_night). department(a_wed_night, a).
assigned(a_wed_night, alice, 4). assigned(a_wed_night, eve, 4).

employee(alice). employee(bob). employee(eve).
senior(alice). senior(eve).
certified(alice, equipment_a). certified(eve, equipment_a).`;

  const deptAScheduleUrl = createDatalogDoc(repo, 'Department A Schedule', deptADraftText, deptAFacts);

  // Department B schedule facts
  const deptBFacts: StoredFact[] = [
    f('department_schedule', 'dept_b'),
    f('scheduled_hours', 'dept_b', 480),

    f('employee', 'carol'),
    f('employee', 'dave'),
    f('employee', 'frank'),

    // Monday
    f('shift', 'b_mon_day'),
    f('department', 'b_mon_day', 'b'),
    f('assigned', 'b_mon_day', 'carol', 8),
    f('assigned', 'b_mon_day', 'dave', 8),
    f('patients', 'b_mon_day', 8),
    f('has_oncall', 'b_mon_day'),

    f('shift', 'b_mon_eve'),
    f('department', 'b_mon_eve', 'b'),
    f('assigned', 'b_mon_eve', 'frank', 8),
    f('assigned', 'b_mon_eve', 'dave', 8),
    f('patients', 'b_mon_eve', 6),
    f('has_oncall', 'b_mon_eve'),

    // Tuesday
    f('shift', 'b_tue_day'),
    f('department', 'b_tue_day', 'b'),
    f('assigned', 'b_tue_day', 'carol', 8),
    f('assigned', 'b_tue_day', 'frank', 8),
    f('patients', 'b_tue_day', 10),
    f('has_oncall', 'b_tue_day'),

    f('shift', 'b_tue_eve'),
    f('department', 'b_tue_eve', 'b'),
    f('assigned', 'b_tue_eve', 'dave', 8),
    f('assigned', 'b_tue_eve', 'carol', 8),
    f('patients', 'b_tue_eve', 6),
    f('has_oncall', 'b_tue_eve'),

    // Wednesday
    f('shift', 'b_wed_day'),
    f('department', 'b_wed_day', 'b'),
    f('assigned', 'b_wed_day', 'carol', 8),
    f('assigned', 'b_wed_day', 'dave', 8),
    f('patients', 'b_wed_day', 8),
    f('has_oncall', 'b_wed_day'),

    f('shift', 'b_wed_eve'),
    f('department', 'b_wed_eve', 'b'),
    f('assigned', 'b_wed_eve', 'frank', 8),
    f('assigned', 'b_wed_eve', 'dave', 4),
    f('patients', 'b_wed_eve', 6),
    f('has_oncall', 'b_wed_eve'),
  ];

  const deptBDraftText = `% Department B Schedule Solution
department_schedule(dept_b).
scheduled_hours(dept_b, 480).

employee(carol). employee(dave). employee(frank).

% Monday
shift(b_mon_day). department(b_mon_day, b). patients(b_mon_day, 8).
assigned(b_mon_day, carol, 8). assigned(b_mon_day, dave, 8). has_oncall(b_mon_day).

shift(b_mon_eve). department(b_mon_eve, b). patients(b_mon_eve, 6).
assigned(b_mon_eve, frank, 8). assigned(b_mon_eve, dave, 8). has_oncall(b_mon_eve).

% Tuesday
shift(b_tue_day). department(b_tue_day, b). patients(b_tue_day, 10).
assigned(b_tue_day, carol, 8). assigned(b_tue_day, frank, 8). has_oncall(b_tue_day).

shift(b_tue_eve). department(b_tue_eve, b). patients(b_tue_eve, 6).
assigned(b_tue_eve, dave, 8). assigned(b_tue_eve, carol, 8). has_oncall(b_tue_eve).

% Wednesday
shift(b_wed_day). department(b_wed_day, b). patients(b_wed_day, 8).
assigned(b_wed_day, carol, 8). assigned(b_wed_day, dave, 8). has_oncall(b_wed_day).

shift(b_wed_eve). department(b_wed_eve, b). patients(b_wed_eve, 6).
assigned(b_wed_eve, frank, 8). assigned(b_wed_eve, dave, 4). has_oncall(b_wed_eve).`;

  const deptBScheduleUrl = createDatalogDoc(repo, 'Department B Schedule', deptBDraftText, deptBFacts);

  const artifactDocUrls = [deptAScheduleUrl, deptBScheduleUrl];

  // Create artifacts folder
  const artifactsFolderHandle = repo.create<FolderDoc>();
  artifactsFolderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Schedule Artifacts';
    d.docs = [
      { type: 'datalog', name: 'Department A Schedule', url: deptAScheduleUrl },
      { type: 'datalog', name: 'Department B Schedule', url: deptBScheduleUrl },
    ];
  });

  // Create verification contexts linking verifications to artifacts
  const verificationContextUrls: AutomergeUrl[] = verificationDatalogUrls.map((verificationUrl) => {
    const handle = repo.create<VerificationContextDoc & { '@patchwork': { type: string } }>();
    handle.change((d) => {
      d['@patchwork'] = { type: 'verification-context' };
      d.verificationUrl = verificationUrl;
      d.artifactUrls = artifactDocUrls;
    });
    return handle.url;
  });

  // Create execution doc
  const executionHandle = repo.create<ExecutionDoc & { '@patchwork': { type: string } }>();
  executionHandle.change((d) => {
    d['@patchwork'] = { type: 'execution' };
    d.specDocUrl = specDocUrl;
    d.planDocUrl = planDocUrl;
    d.artifactsFolderUrl = artifactsFolderHandle.url;
    d.verificationContextUrls = verificationContextUrls;
  });

  return { executionDocUrl: executionHandle.url, artifactDocUrls };
}
