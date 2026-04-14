import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { TaskListExecutionDoc } from '../../../../grjte-workflow-tools/src/execution/types';
import {
  buildBaseArtifactDraft,
  type ArtifactFolderEntry,
} from '../../../../grjte-workflow-tools/src/artifact-projection/artifact-projection';
import type { WorkflowArtifactDoc } from '../../workflow/types';
import { normalizeHospitalLegacySolutionFacts } from './default-projection';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: ArtifactFolderEntry[];
};

type StoredFact = { pred: string; args: (string | number)[]; comment?: string };

type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  title?: string;
  facts: StoredFact[];
  rules: unknown[];
  constraints: unknown[];
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

function createSolutionArtifactDoc(
  repo: Repo,
  title: string,
  legacyFacts: StoredFact[],
): AutomergeUrl {
  const normalizedFacts = normalizeHospitalLegacySolutionFacts(legacyFacts);
  return createDatalogDoc(
    repo,
    title,
    buildBaseArtifactDraft(title, normalizedFacts),
    normalizedFacts,
  );
}

function createWorkflowArtifactDoc(
  repo: Repo,
  name: string,
  artifactDocUrl: AutomergeUrl,
  specDocUrl: AutomergeUrl,
  artifactType = 'datalog',
): AutomergeUrl {
  const handle = repo.create<WorkflowArtifactDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'workflow-artifact' };
    d.name = name;
    d.artifactType = artifactType;
    d.artifactDocUrl = artifactDocUrl;
    d.specDocUrl = specDocUrl;
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
  taskUrls: AutomergeUrl[],
  subSpecUrls: AutomergeUrl[],
): { executionDocUrl: AutomergeUrl; artifactDocUrls: AutomergeUrl[] } {
  const amuFacts: StoredFact[] = [
    f('ward_roster', 'amu'),
    f('rostered_hours', 'amu', 216),
    f('employee_rostered_hours', 'james_okafor', 48),
    f('employee_rostered_hours', 'priya_sharma', 36),
    f('employee_rostered_hours', 'emily_davies', 24),
    f('employee_rostered_hours', 'nia_ford', 24),
    f('employee_rostered_hours', 'luke_evans', 36),
    f('employee_rostered_hours', 'mike_thompson', 36),

    f('shift', 'amu_mon_day'),
    f('ward', 'amu_mon_day', 'amu'),
    f('assigned', 'amu_mon_day', 'priya_sharma', 12),
    f('assignment_slot', 'amu_mon_day', 1, 'priya_sharma'),
    f('assigned', 'amu_mon_day', 'emily_davies', 12),
    f('assignment_slot', 'amu_mon_day', 2, 'emily_davies'),
    f('assigned', 'amu_mon_day', 'luke_evans', 12),
    f('assignment_slot', 'amu_mon_day', 3, 'luke_evans'),
    f('patients', 'amu_mon_day', 18),
    f('has_hca', 'amu_mon_day'),

    f('shift', 'amu_mon_night'),
    f('night_shift', 'amu_mon_night'),
    f('ward', 'amu_mon_night', 'amu'),
    f('assigned', 'amu_mon_night', 'james_okafor', 12),
    f('assignment_slot', 'amu_mon_night', 1, 'james_okafor'),
    f('assigned', 'amu_mon_night', 'nia_ford', 12),
    f('assignment_slot', 'amu_mon_night', 2, 'nia_ford'),
    f('assigned', 'amu_mon_night', 'mike_thompson', 12),
    f('assignment_slot', 'amu_mon_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_mon_night', 'james_okafor'),
    f('patients', 'amu_mon_night', 16),
    f('has_hca', 'amu_mon_night'),

    f('shift', 'amu_tue_day'),
    f('ward', 'amu_tue_day', 'amu'),
    f('assigned', 'amu_tue_day', 'james_okafor', 12),
    f('assignment_slot', 'amu_tue_day', 1, 'james_okafor'),
    f('assigned', 'amu_tue_day', 'priya_sharma', 12),
    f('assignment_slot', 'amu_tue_day', 2, 'priya_sharma'),
    f('assigned', 'amu_tue_day', 'luke_evans', 12),
    f('assignment_slot', 'amu_tue_day', 3, 'luke_evans'),
    f('patients', 'amu_tue_day', 20),
    f('has_hca', 'amu_tue_day'),

    f('shift', 'amu_tue_night'),
    f('night_shift', 'amu_tue_night'),
    f('ward', 'amu_tue_night', 'amu'),
    f('assigned', 'amu_tue_night', 'james_okafor', 12),
    f('assignment_slot', 'amu_tue_night', 1, 'james_okafor'),
    f('assigned', 'amu_tue_night', 'emily_davies', 12),
    f('assignment_slot', 'amu_tue_night', 2, 'emily_davies'),
    f('assigned', 'amu_tue_night', 'mike_thompson', 12),
    f('assignment_slot', 'amu_tue_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_tue_night', 'james_okafor'),
    f('patients', 'amu_tue_night', 17),
    f('has_hca', 'amu_tue_night'),

    f('shift', 'amu_wed_day'),
    f('ward', 'amu_wed_day', 'amu'),
    f('assigned', 'amu_wed_day', 'priya_sharma', 12),
    f('assignment_slot', 'amu_wed_day', 1, 'priya_sharma'),
    f('assigned', 'amu_wed_day', 'nia_ford', 12),
    f('assignment_slot', 'amu_wed_day', 2, 'nia_ford'),
    f('assigned', 'amu_wed_day', 'luke_evans', 12),
    f('assignment_slot', 'amu_wed_day', 3, 'luke_evans'),
    f('patients', 'amu_wed_day', 19),
    f('has_hca', 'amu_wed_day'),

    f('shift', 'amu_wed_night'),
    f('night_shift', 'amu_wed_night'),
    f('ward', 'amu_wed_night', 'amu'),
    f('assigned', 'amu_wed_night', 'james_okafor', 12),
    f('assignment_slot', 'amu_wed_night', 1, 'james_okafor'),
    f('assigned', 'amu_wed_night', 'emily_davies', 12),
    f('assignment_slot', 'amu_wed_night', 2, 'emily_davies'),
    f('assigned', 'amu_wed_night', 'mike_thompson', 12),
    f('assignment_slot', 'amu_wed_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_wed_night', 'james_okafor'),
    f('patients', 'amu_wed_night', 16),
    f('has_hca', 'amu_wed_night'),
  ];

  const amuDraftText = `% AMU rota solution
ward_roster(amu).
rostered_hours(amu, 216).
employee_rostered_hours(james_okafor, 48).
employee_rostered_hours(priya_sharma, 36).
employee_rostered_hours(emily_davies, 24).
employee_rostered_hours(nia_ford, 24).
employee_rostered_hours(luke_evans, 36).
employee_rostered_hours(mike_thompson, 36).

shift(amu_mon_day). ward(amu_mon_day, amu). patients(amu_mon_day, 18). has_hca(amu_mon_day).
assigned(amu_mon_day, priya_sharma, 12). assignment_slot(amu_mon_day, 1, priya_sharma).
assigned(amu_mon_day, emily_davies, 12). assignment_slot(amu_mon_day, 2, emily_davies).
assigned(amu_mon_day, luke_evans, 12). assignment_slot(amu_mon_day, 3, luke_evans).

shift(amu_mon_night). night_shift(amu_mon_night). ward(amu_mon_night, amu). patients(amu_mon_night, 16). has_hca(amu_mon_night).
assigned(amu_mon_night, james_okafor, 12). assignment_slot(amu_mon_night, 1, james_okafor).
assigned(amu_mon_night, nia_ford, 12). assignment_slot(amu_mon_night, 2, nia_ford).
assigned(amu_mon_night, mike_thompson, 12). assignment_slot(amu_mon_night, 3, mike_thompson).
in_charge(amu_mon_night, james_okafor).

shift(amu_tue_day). ward(amu_tue_day, amu). patients(amu_tue_day, 20). has_hca(amu_tue_day).
assigned(amu_tue_day, james_okafor, 12). assignment_slot(amu_tue_day, 1, james_okafor).
assigned(amu_tue_day, priya_sharma, 12). assignment_slot(amu_tue_day, 2, priya_sharma).
assigned(amu_tue_day, luke_evans, 12). assignment_slot(amu_tue_day, 3, luke_evans).

shift(amu_tue_night). night_shift(amu_tue_night). ward(amu_tue_night, amu). patients(amu_tue_night, 17). has_hca(amu_tue_night).
assigned(amu_tue_night, james_okafor, 12). assignment_slot(amu_tue_night, 1, james_okafor).
assigned(amu_tue_night, emily_davies, 12). assignment_slot(amu_tue_night, 2, emily_davies).
assigned(amu_tue_night, mike_thompson, 12). assignment_slot(amu_tue_night, 3, mike_thompson).
in_charge(amu_tue_night, james_okafor).

shift(amu_wed_day). ward(amu_wed_day, amu). patients(amu_wed_day, 19). has_hca(amu_wed_day).
assigned(amu_wed_day, priya_sharma, 12). assignment_slot(amu_wed_day, 1, priya_sharma).
assigned(amu_wed_day, nia_ford, 12). assignment_slot(amu_wed_day, 2, nia_ford).
assigned(amu_wed_day, luke_evans, 12). assignment_slot(amu_wed_day, 3, luke_evans).

shift(amu_wed_night). night_shift(amu_wed_night). ward(amu_wed_night, amu). patients(amu_wed_night, 16). has_hca(amu_wed_night).
assigned(amu_wed_night, james_okafor, 12). assignment_slot(amu_wed_night, 1, james_okafor).
assigned(amu_wed_night, emily_davies, 12). assignment_slot(amu_wed_night, 2, emily_davies).
assigned(amu_wed_night, mike_thompson, 12). assignment_slot(amu_wed_night, 3, mike_thompson).
in_charge(amu_wed_night, james_okafor).`;

  const amuRotaUrl = createSolutionArtifactDoc(repo, 'AMU Rota', amuFacts);

  const ward6Facts: StoredFact[] = [
    f('ward_roster', 'ward_6'),
    f('rostered_hours', 'ward_6', 288),
    f('employee_rostered_hours', 'rachel_green', 48),
    f('employee_rostered_hours', 'tom_williams', 48),
    f('employee_rostered_hours', 'aisha_begum', 36),
    f('employee_rostered_hours', 'helen_morris', 48),
    f('employee_rostered_hours', 'noor_khan', 36),
    f('employee_rostered_hours', 'dan_murphy', 36),
    f('employee_rostered_hours', 'lisa_brown', 36),

    f('shift', 'w6_mon_day'),
    f('ward', 'w6_mon_day', 'ward_6'),
    f('assigned', 'w6_mon_day', 'rachel_green', 12),
    f('assignment_slot', 'w6_mon_day', 1, 'rachel_green'),
    f('assigned', 'w6_mon_day', 'tom_williams', 12),
    f('assignment_slot', 'w6_mon_day', 2, 'tom_williams'),
    f('assigned', 'w6_mon_day', 'aisha_begum', 12),
    f('assignment_slot', 'w6_mon_day', 3, 'aisha_begum'),
    f('assigned', 'w6_mon_day', 'dan_murphy', 12),
    f('assignment_slot', 'w6_mon_day', 4, 'dan_murphy'),
    f('patients', 'w6_mon_day', 22),
    f('has_hca', 'w6_mon_day'),

    f('shift', 'w6_mon_night'),
    f('night_shift', 'w6_mon_night'),
    f('ward', 'w6_mon_night', 'ward_6'),
    f('assigned', 'w6_mon_night', 'helen_morris', 12),
    f('assignment_slot', 'w6_mon_night', 1, 'helen_morris'),
    f('assigned', 'w6_mon_night', 'noor_khan', 12),
    f('assignment_slot', 'w6_mon_night', 2, 'noor_khan'),
    f('assigned', 'w6_mon_night', 'rachel_green', 12),
    f('assignment_slot', 'w6_mon_night', 3, 'rachel_green'),
    f('assigned', 'w6_mon_night', 'lisa_brown', 12),
    f('assignment_slot', 'w6_mon_night', 4, 'lisa_brown'),
    f('patients', 'w6_mon_night', 20),
    f('has_hca', 'w6_mon_night'),

    f('shift', 'w6_tue_day'),
    f('ward', 'w6_tue_day', 'ward_6'),
    f('assigned', 'w6_tue_day', 'tom_williams', 12),
    f('assignment_slot', 'w6_tue_day', 1, 'tom_williams'),
    f('assigned', 'w6_tue_day', 'aisha_begum', 12),
    f('assignment_slot', 'w6_tue_day', 2, 'aisha_begum'),
    f('assigned', 'w6_tue_day', 'helen_morris', 12),
    f('assignment_slot', 'w6_tue_day', 3, 'helen_morris'),
    f('assigned', 'w6_tue_day', 'dan_murphy', 12),
    f('assignment_slot', 'w6_tue_day', 4, 'dan_murphy'),
    f('patients', 'w6_tue_day', 24),
    f('has_hca', 'w6_tue_day'),

    f('shift', 'w6_tue_night'),
    f('night_shift', 'w6_tue_night'),
    f('ward', 'w6_tue_night', 'ward_6'),
    f('assigned', 'w6_tue_night', 'noor_khan', 12),
    f('assignment_slot', 'w6_tue_night', 1, 'noor_khan'),
    f('assigned', 'w6_tue_night', 'rachel_green', 12),
    f('assignment_slot', 'w6_tue_night', 2, 'rachel_green'),
    f('assigned', 'w6_tue_night', 'tom_williams', 12),
    f('assignment_slot', 'w6_tue_night', 3, 'tom_williams'),
    f('assigned', 'w6_tue_night', 'lisa_brown', 12),
    f('assignment_slot', 'w6_tue_night', 4, 'lisa_brown'),
    f('patients', 'w6_tue_night', 20),
    f('has_hca', 'w6_tue_night'),

    f('shift', 'w6_wed_day'),
    f('ward', 'w6_wed_day', 'ward_6'),
    f('assigned', 'w6_wed_day', 'aisha_begum', 12),
    f('assignment_slot', 'w6_wed_day', 1, 'aisha_begum'),
    f('assigned', 'w6_wed_day', 'helen_morris', 12),
    f('assignment_slot', 'w6_wed_day', 2, 'helen_morris'),
    f('assigned', 'w6_wed_day', 'noor_khan', 12),
    f('assignment_slot', 'w6_wed_day', 3, 'noor_khan'),
    f('assigned', 'w6_wed_day', 'dan_murphy', 12),
    f('assignment_slot', 'w6_wed_day', 4, 'dan_murphy'),
    f('patients', 'w6_wed_day', 22),
    f('has_hca', 'w6_wed_day'),

    f('shift', 'w6_wed_night'),
    f('night_shift', 'w6_wed_night'),
    f('ward', 'w6_wed_night', 'ward_6'),
    f('assigned', 'w6_wed_night', 'rachel_green', 12),
    f('assignment_slot', 'w6_wed_night', 1, 'rachel_green'),
    f('assigned', 'w6_wed_night', 'tom_williams', 12),
    f('assignment_slot', 'w6_wed_night', 2, 'tom_williams'),
    f('assigned', 'w6_wed_night', 'helen_morris', 12),
    f('assignment_slot', 'w6_wed_night', 3, 'helen_morris'),
    f('assigned', 'w6_wed_night', 'lisa_brown', 12),
    f('assignment_slot', 'w6_wed_night', 4, 'lisa_brown'),
    f('patients', 'w6_wed_night', 18),
    f('has_hca', 'w6_wed_night'),
  ];

  const ward6DraftText = `% Ward 6 rota solution
ward_roster(ward_6).
rostered_hours(ward_6, 288).
employee_rostered_hours(rachel_green, 48).
employee_rostered_hours(tom_williams, 48).
employee_rostered_hours(aisha_begum, 36).
employee_rostered_hours(helen_morris, 48).
employee_rostered_hours(noor_khan, 36).
employee_rostered_hours(dan_murphy, 36).
employee_rostered_hours(lisa_brown, 36).

shift(w6_mon_day). ward(w6_mon_day, ward_6). patients(w6_mon_day, 22). has_hca(w6_mon_day).
assigned(w6_mon_day, rachel_green, 12). assignment_slot(w6_mon_day, 1, rachel_green).
assigned(w6_mon_day, tom_williams, 12). assignment_slot(w6_mon_day, 2, tom_williams).
assigned(w6_mon_day, aisha_begum, 12). assignment_slot(w6_mon_day, 3, aisha_begum).
assigned(w6_mon_day, dan_murphy, 12). assignment_slot(w6_mon_day, 4, dan_murphy).

shift(w6_mon_night). night_shift(w6_mon_night). ward(w6_mon_night, ward_6). patients(w6_mon_night, 20). has_hca(w6_mon_night).
assigned(w6_mon_night, helen_morris, 12). assignment_slot(w6_mon_night, 1, helen_morris).
assigned(w6_mon_night, noor_khan, 12). assignment_slot(w6_mon_night, 2, noor_khan).
assigned(w6_mon_night, rachel_green, 12). assignment_slot(w6_mon_night, 3, rachel_green).
assigned(w6_mon_night, lisa_brown, 12). assignment_slot(w6_mon_night, 4, lisa_brown).

shift(w6_tue_day). ward(w6_tue_day, ward_6). patients(w6_tue_day, 24). has_hca(w6_tue_day).
assigned(w6_tue_day, tom_williams, 12). assignment_slot(w6_tue_day, 1, tom_williams).
assigned(w6_tue_day, aisha_begum, 12). assignment_slot(w6_tue_day, 2, aisha_begum).
assigned(w6_tue_day, helen_morris, 12). assignment_slot(w6_tue_day, 3, helen_morris).
assigned(w6_tue_day, dan_murphy, 12). assignment_slot(w6_tue_day, 4, dan_murphy).

shift(w6_tue_night). night_shift(w6_tue_night). ward(w6_tue_night, ward_6). patients(w6_tue_night, 20). has_hca(w6_tue_night).
assigned(w6_tue_night, noor_khan, 12). assignment_slot(w6_tue_night, 1, noor_khan).
assigned(w6_tue_night, rachel_green, 12). assignment_slot(w6_tue_night, 2, rachel_green).
assigned(w6_tue_night, tom_williams, 12). assignment_slot(w6_tue_night, 3, tom_williams).
assigned(w6_tue_night, lisa_brown, 12). assignment_slot(w6_tue_night, 4, lisa_brown).

shift(w6_wed_day). ward(w6_wed_day, ward_6). patients(w6_wed_day, 22). has_hca(w6_wed_day).
assigned(w6_wed_day, aisha_begum, 12). assignment_slot(w6_wed_day, 1, aisha_begum).
assigned(w6_wed_day, helen_morris, 12). assignment_slot(w6_wed_day, 2, helen_morris).
assigned(w6_wed_day, noor_khan, 12). assignment_slot(w6_wed_day, 3, noor_khan).
assigned(w6_wed_day, dan_murphy, 12). assignment_slot(w6_wed_day, 4, dan_murphy).

shift(w6_wed_night). night_shift(w6_wed_night). ward(w6_wed_night, ward_6). patients(w6_wed_night, 18). has_hca(w6_wed_night).
assigned(w6_wed_night, rachel_green, 12). assignment_slot(w6_wed_night, 1, rachel_green).
assigned(w6_wed_night, tom_williams, 12). assignment_slot(w6_wed_night, 2, tom_williams).
assigned(w6_wed_night, helen_morris, 12). assignment_slot(w6_wed_night, 3, helen_morris).
assigned(w6_wed_night, lisa_brown, 12). assignment_slot(w6_wed_night, 4, lisa_brown).`;

  const ward6RotaUrl = createSolutionArtifactDoc(repo, 'Ward 6 Rota', ward6Facts);
  const amuWorkflowArtifactUrl = createWorkflowArtifactDoc(
    repo,
    'AMU Rota',
    amuRotaUrl,
    subSpecUrls[0],
  );
  const ward6WorkflowArtifactUrl = createWorkflowArtifactDoc(
    repo,
    'Ward 6 Rota',
    ward6RotaUrl,
    subSpecUrls[1],
  );

  const artifactsFolderHandle = repo.create<FolderDoc>();
  artifactsFolderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Rota Artifacts';
    d.docs = [
      {
        type: 'workflow-artifact',
        name: 'AMU Rota',
        url: amuWorkflowArtifactUrl,
      },
      {
        type: 'workflow-artifact',
        name: 'Ward 6 Rota',
        url: ward6WorkflowArtifactUrl,
      },
    ];
  });

  const executionHandle = repo.create<TaskListExecutionDoc & { '@patchwork': { type: string } }>();
  executionHandle.change((d) => {
    d['@patchwork'] = { type: 'execution' };
    d.specDocUrl = specDocUrl;
    d.planDocUrl = planDocUrl;
    d.status = 'in-progress';
    d.taskUrls = taskUrls;
    d.artifactsFolderUrl = artifactsFolderHandle.url;
  });

  return {
    executionDocUrl: executionHandle.url,
    artifactDocUrls: [amuRotaUrl, ward6RotaUrl],
  };
}
