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
): AutomergeUrl {
  const handle = repo.create<WorkflowArtifactDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'workflow-artifact' };
    d.name = name;
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
  // AMU rota — 3 staff per shift (2 RN + 1 HCA), NIC on nights.
  // Days off respected: james_okafor OFF tue, fiona_grant OFF wed,
  // priya_sharma OFF wed, emily_davies OFF mon, ben_walker OFF tue,
  // grace_hall OFF mon, luke_evans OFF wed, olivia_barnes OFF tue.
  const amuFacts: StoredFact[] = [
    f('ward_roster', 'amu'),
    f('rostered_hours', 'amu', 216),
    f('employee_rostered_hours', 'james_okafor', 24),
    f('employee_rostered_hours', 'fiona_grant', 24),
    f('employee_rostered_hours', 'priya_sharma', 24),
    f('employee_rostered_hours', 'emily_davies', 24),
    f('employee_rostered_hours', 'nia_ford', 24),
    f('employee_rostered_hours', 'ben_walker', 12),
    f('employee_rostered_hours', 'grace_hall', 12),
    f('employee_rostered_hours', 'luke_evans', 24),
    f('employee_rostered_hours', 'mike_thompson', 36),
    f('employee_rostered_hours', 'olivia_barnes', 12),

    // Monday (emily_davies OFF, grace_hall OFF)
    f('shift', 'amu_mon_day'),
    f('ward', 'amu_mon_day', 'amu'),
    f('shift_day', 'amu_mon_day', 'monday'),
    f('shift_hours', 'amu_mon_day', 12),
    f('assignment_slot', 'amu_mon_day', 1, 'priya_sharma'),
    f('assignment_slot', 'amu_mon_day', 2, 'nia_ford'),
    f('assignment_slot', 'amu_mon_day', 3, 'luke_evans'),
    f('patients', 'amu_mon_day', 18),
    f('has_hca', 'amu_mon_day'),

    f('shift', 'amu_mon_night'),
    f('night_shift', 'amu_mon_night'),
    f('ward', 'amu_mon_night', 'amu'),
    f('shift_day', 'amu_mon_night', 'monday'),
    f('shift_hours', 'amu_mon_night', 12),
    f('assignment_slot', 'amu_mon_night', 1, 'james_okafor'),
    f('assignment_slot', 'amu_mon_night', 2, 'fiona_grant'),
    f('assignment_slot', 'amu_mon_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_mon_night', 'james_okafor'),
    f('patients', 'amu_mon_night', 16),
    f('has_hca', 'amu_mon_night'),

    // Tuesday (james_okafor OFF, ben_walker OFF, olivia_barnes OFF)
    f('shift', 'amu_tue_day'),
    f('ward', 'amu_tue_day', 'amu'),
    f('shift_day', 'amu_tue_day', 'tuesday'),
    f('shift_hours', 'amu_tue_day', 12),
    f('assignment_slot', 'amu_tue_day', 1, 'emily_davies'),
    f('assignment_slot', 'amu_tue_day', 2, 'grace_hall'),
    f('assignment_slot', 'amu_tue_day', 3, 'luke_evans'),
    f('patients', 'amu_tue_day', 20),
    f('has_hca', 'amu_tue_day'),

    f('shift', 'amu_tue_night'),
    f('night_shift', 'amu_tue_night'),
    f('ward', 'amu_tue_night', 'amu'),
    f('shift_day', 'amu_tue_night', 'tuesday'),
    f('shift_hours', 'amu_tue_night', 12),
    f('assignment_slot', 'amu_tue_night', 1, 'fiona_grant'),
    f('assignment_slot', 'amu_tue_night', 2, 'priya_sharma'),
    f('assignment_slot', 'amu_tue_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_tue_night', 'fiona_grant'),
    f('patients', 'amu_tue_night', 17),
    f('has_hca', 'amu_tue_night'),

    // Wednesday (fiona_grant OFF, priya_sharma OFF, luke_evans OFF)
    f('shift', 'amu_wed_day'),
    f('ward', 'amu_wed_day', 'amu'),
    f('shift_day', 'amu_wed_day', 'wednesday'),
    f('shift_hours', 'amu_wed_day', 12),
    f('assignment_slot', 'amu_wed_day', 1, 'ben_walker'),
    f('assignment_slot', 'amu_wed_day', 2, 'grace_hall'),
    f('assignment_slot', 'amu_wed_day', 3, 'olivia_barnes'),
    f('patients', 'amu_wed_day', 19),
    f('has_hca', 'amu_wed_day'),

    f('shift', 'amu_wed_night'),
    f('night_shift', 'amu_wed_night'),
    f('ward', 'amu_wed_night', 'amu'),
    f('shift_day', 'amu_wed_night', 'wednesday'),
    f('shift_hours', 'amu_wed_night', 12),
    f('assignment_slot', 'amu_wed_night', 1, 'james_okafor'),
    f('assignment_slot', 'amu_wed_night', 2, 'emily_davies'),
    f('assignment_slot', 'amu_wed_night', 3, 'mike_thompson'),
    f('in_charge', 'amu_wed_night', 'james_okafor'),
    f('patients', 'amu_wed_night', 16),
    f('has_hca', 'amu_wed_night'),
  ];

  const amuDraftText = `% AMU rota solution
ward_roster(amu).
rostered_hours(amu, 216).
employee_rostered_hours(james_okafor, 24).
employee_rostered_hours(fiona_grant, 24).
employee_rostered_hours(priya_sharma, 24).
employee_rostered_hours(emily_davies, 24).
employee_rostered_hours(nia_ford, 24).
employee_rostered_hours(ben_walker, 12).
employee_rostered_hours(grace_hall, 12).
employee_rostered_hours(luke_evans, 24).
employee_rostered_hours(mike_thompson, 36).
employee_rostered_hours(olivia_barnes, 12).

shift(amu_mon_day). ward(amu_mon_day, amu). shift_day(amu_mon_day, monday). shift_hours(amu_mon_day, 12). patients(amu_mon_day, 18). has_hca(amu_mon_day).
assignment_slot(amu_mon_day, 1, priya_sharma).
assignment_slot(amu_mon_day, 2, nia_ford).
assignment_slot(amu_mon_day, 3, luke_evans).

shift(amu_mon_night). night_shift(amu_mon_night). ward(amu_mon_night, amu). shift_day(amu_mon_night, monday). shift_hours(amu_mon_night, 12). patients(amu_mon_night, 16). has_hca(amu_mon_night).
assignment_slot(amu_mon_night, 1, james_okafor).
assignment_slot(amu_mon_night, 2, fiona_grant).
assignment_slot(amu_mon_night, 3, mike_thompson).
in_charge(amu_mon_night, james_okafor).

shift(amu_tue_day). ward(amu_tue_day, amu). shift_day(amu_tue_day, tuesday). shift_hours(amu_tue_day, 12). patients(amu_tue_day, 20). has_hca(amu_tue_day).
assignment_slot(amu_tue_day, 1, emily_davies).
assignment_slot(amu_tue_day, 2, grace_hall).
assignment_slot(amu_tue_day, 3, luke_evans).

shift(amu_tue_night). night_shift(amu_tue_night). ward(amu_tue_night, amu). shift_day(amu_tue_night, tuesday). shift_hours(amu_tue_night, 12). patients(amu_tue_night, 17). has_hca(amu_tue_night).
assignment_slot(amu_tue_night, 1, fiona_grant).
assignment_slot(amu_tue_night, 2, priya_sharma).
assignment_slot(amu_tue_night, 3, mike_thompson).
in_charge(amu_tue_night, fiona_grant).

shift(amu_wed_day). ward(amu_wed_day, amu). shift_day(amu_wed_day, wednesday). shift_hours(amu_wed_day, 12). patients(amu_wed_day, 19). has_hca(amu_wed_day).
assignment_slot(amu_wed_day, 1, ben_walker).
assignment_slot(amu_wed_day, 2, grace_hall).
assignment_slot(amu_wed_day, 3, olivia_barnes).

shift(amu_wed_night). night_shift(amu_wed_night). ward(amu_wed_night, amu). shift_day(amu_wed_night, wednesday). shift_hours(amu_wed_night, 12). patients(amu_wed_night, 16). has_hca(amu_wed_night).
assignment_slot(amu_wed_night, 1, james_okafor).
assignment_slot(amu_wed_night, 2, emily_davies).
assignment_slot(amu_wed_night, 3, mike_thompson).
in_charge(amu_wed_night, james_okafor).`;

  const amuRotaUrl = createSolutionArtifactDoc(repo, 'AMU Rota', amuFacts);

  // Ward 6 rota — 4 staff per shift (3 RN + 1 HCA).
  // Days off respected: rachel_green OFF wed, sam_patel OFF mon,
  // tom_williams OFF wed, aisha_begum OFF tue, jade_turner OFF mon,
  // chris_adams OFF tue, dan_murphy OFF wed, kevin_wright OFF mon.
  const ward6Facts: StoredFact[] = [
    f('ward_roster', 'ward_6'),
    f('rostered_hours', 'ward_6', 288),
    f('employee_rostered_hours', 'rachel_green', 24),
    f('employee_rostered_hours', 'sam_patel', 24),
    f('employee_rostered_hours', 'tom_williams', 24),
    f('employee_rostered_hours', 'aisha_begum', 24),
    f('employee_rostered_hours', 'helen_morris', 36),
    f('employee_rostered_hours', 'noor_khan', 36),
    f('employee_rostered_hours', 'jade_turner', 24),
    f('employee_rostered_hours', 'chris_adams', 24),
    f('employee_rostered_hours', 'dan_murphy', 24),
    f('employee_rostered_hours', 'lisa_brown', 36),
    f('employee_rostered_hours', 'kevin_wright', 12),

    // Monday (sam_patel OFF, jade_turner OFF, kevin_wright OFF)
    f('shift', 'w6_mon_day'),
    f('ward', 'w6_mon_day', 'ward_6'),
    f('shift_day', 'w6_mon_day', 'monday'),
    f('shift_hours', 'w6_mon_day', 12),
    f('assignment_slot', 'w6_mon_day', 1, 'rachel_green'),
    f('assignment_slot', 'w6_mon_day', 2, 'tom_williams'),
    f('assignment_slot', 'w6_mon_day', 3, 'aisha_begum'),
    f('assignment_slot', 'w6_mon_day', 4, 'dan_murphy'),
    f('patients', 'w6_mon_day', 22),
    f('has_hca', 'w6_mon_day'),

    f('shift', 'w6_mon_night'),
    f('night_shift', 'w6_mon_night'),
    f('ward', 'w6_mon_night', 'ward_6'),
    f('shift_day', 'w6_mon_night', 'monday'),
    f('shift_hours', 'w6_mon_night', 12),
    f('assignment_slot', 'w6_mon_night', 1, 'helen_morris'),
    f('assignment_slot', 'w6_mon_night', 2, 'noor_khan'),
    f('assignment_slot', 'w6_mon_night', 3, 'chris_adams'),
    f('assignment_slot', 'w6_mon_night', 4, 'lisa_brown'),
    f('patients', 'w6_mon_night', 20),
    f('has_hca', 'w6_mon_night'),

    // Tuesday (aisha_begum OFF, chris_adams OFF)
    f('shift', 'w6_tue_day'),
    f('ward', 'w6_tue_day', 'ward_6'),
    f('shift_day', 'w6_tue_day', 'tuesday'),
    f('shift_hours', 'w6_tue_day', 12),
    f('assignment_slot', 'w6_tue_day', 1, 'sam_patel'),
    f('assignment_slot', 'w6_tue_day', 2, 'tom_williams'),
    f('assignment_slot', 'w6_tue_day', 3, 'jade_turner'),
    f('assignment_slot', 'w6_tue_day', 4, 'dan_murphy'),
    f('patients', 'w6_tue_day', 24),
    f('has_hca', 'w6_tue_day'),

    f('shift', 'w6_tue_night'),
    f('night_shift', 'w6_tue_night'),
    f('ward', 'w6_tue_night', 'ward_6'),
    f('shift_day', 'w6_tue_night', 'tuesday'),
    f('shift_hours', 'w6_tue_night', 12),
    f('assignment_slot', 'w6_tue_night', 1, 'rachel_green'),
    f('assignment_slot', 'w6_tue_night', 2, 'helen_morris'),
    f('assignment_slot', 'w6_tue_night', 3, 'noor_khan'),
    f('assignment_slot', 'w6_tue_night', 4, 'lisa_brown'),
    f('patients', 'w6_tue_night', 20),
    f('has_hca', 'w6_tue_night'),

    // Wednesday (rachel_green OFF, tom_williams OFF, dan_murphy OFF)
    f('shift', 'w6_wed_day'),
    f('ward', 'w6_wed_day', 'ward_6'),
    f('shift_day', 'w6_wed_day', 'wednesday'),
    f('shift_hours', 'w6_wed_day', 12),
    f('assignment_slot', 'w6_wed_day', 1, 'aisha_begum'),
    f('assignment_slot', 'w6_wed_day', 2, 'jade_turner'),
    f('assignment_slot', 'w6_wed_day', 3, 'chris_adams'),
    f('assignment_slot', 'w6_wed_day', 4, 'kevin_wright'),
    f('patients', 'w6_wed_day', 22),
    f('has_hca', 'w6_wed_day'),

    f('shift', 'w6_wed_night'),
    f('night_shift', 'w6_wed_night'),
    f('ward', 'w6_wed_night', 'ward_6'),
    f('shift_day', 'w6_wed_night', 'wednesday'),
    f('shift_hours', 'w6_wed_night', 12),
    f('assignment_slot', 'w6_wed_night', 1, 'sam_patel'),
    f('assignment_slot', 'w6_wed_night', 2, 'helen_morris'),
    f('assignment_slot', 'w6_wed_night', 3, 'noor_khan'),
    f('assignment_slot', 'w6_wed_night', 4, 'lisa_brown'),
    f('patients', 'w6_wed_night', 18),
    f('has_hca', 'w6_wed_night'),
  ];

  const ward6DraftText = `% Ward 6 rota solution
ward_roster(ward_6).
rostered_hours(ward_6, 288).
employee_rostered_hours(rachel_green, 24).
employee_rostered_hours(sam_patel, 24).
employee_rostered_hours(tom_williams, 24).
employee_rostered_hours(aisha_begum, 24).
employee_rostered_hours(helen_morris, 36).
employee_rostered_hours(noor_khan, 36).
employee_rostered_hours(jade_turner, 24).
employee_rostered_hours(chris_adams, 24).
employee_rostered_hours(dan_murphy, 24).
employee_rostered_hours(lisa_brown, 36).
employee_rostered_hours(kevin_wright, 12).

shift(w6_mon_day). ward(w6_mon_day, ward_6). shift_day(w6_mon_day, monday). shift_hours(w6_mon_day, 12). patients(w6_mon_day, 22). has_hca(w6_mon_day).
assignment_slot(w6_mon_day, 1, rachel_green).
assignment_slot(w6_mon_day, 2, tom_williams).
assignment_slot(w6_mon_day, 3, aisha_begum).
assignment_slot(w6_mon_day, 4, dan_murphy).

shift(w6_mon_night). night_shift(w6_mon_night). ward(w6_mon_night, ward_6). shift_day(w6_mon_night, monday). shift_hours(w6_mon_night, 12). patients(w6_mon_night, 20). has_hca(w6_mon_night).
assignment_slot(w6_mon_night, 1, helen_morris).
assignment_slot(w6_mon_night, 2, noor_khan).
assignment_slot(w6_mon_night, 3, chris_adams).
assignment_slot(w6_mon_night, 4, lisa_brown).

shift(w6_tue_day). ward(w6_tue_day, ward_6). shift_day(w6_tue_day, tuesday). shift_hours(w6_tue_day, 12). patients(w6_tue_day, 24). has_hca(w6_tue_day).
assignment_slot(w6_tue_day, 1, sam_patel).
assignment_slot(w6_tue_day, 2, tom_williams).
assignment_slot(w6_tue_day, 3, jade_turner).
assignment_slot(w6_tue_day, 4, dan_murphy).

shift(w6_tue_night). night_shift(w6_tue_night). ward(w6_tue_night, ward_6). shift_day(w6_tue_night, tuesday). shift_hours(w6_tue_night, 12). patients(w6_tue_night, 20). has_hca(w6_tue_night).
assignment_slot(w6_tue_night, 1, rachel_green).
assignment_slot(w6_tue_night, 2, helen_morris).
assignment_slot(w6_tue_night, 3, noor_khan).
assignment_slot(w6_tue_night, 4, lisa_brown).

shift(w6_wed_day). ward(w6_wed_day, ward_6). shift_day(w6_wed_day, wednesday). shift_hours(w6_wed_day, 12). patients(w6_wed_day, 22). has_hca(w6_wed_day).
assignment_slot(w6_wed_day, 1, aisha_begum).
assignment_slot(w6_wed_day, 2, jade_turner).
assignment_slot(w6_wed_day, 3, chris_adams).
assignment_slot(w6_wed_day, 4, kevin_wright).

shift(w6_wed_night). night_shift(w6_wed_night). ward(w6_wed_night, ward_6). shift_day(w6_wed_night, wednesday). shift_hours(w6_wed_night, 12). patients(w6_wed_night, 18). has_hca(w6_wed_night).
assignment_slot(w6_wed_night, 1, sam_patel).
assignment_slot(w6_wed_night, 2, helen_morris).
assignment_slot(w6_wed_night, 3, noor_khan).
assignment_slot(w6_wed_night, 4, lisa_brown).`;

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
