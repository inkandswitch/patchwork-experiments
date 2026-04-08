import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { VerificationContextDoc } from '../../workflow/types';
import type { TaskListExecutionDoc } from '../execution/types';

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
  taskUrls: AutomergeUrl[],
  verificationDatalogUrls: AutomergeUrl[],
): { executionDocUrl: AutomergeUrl; artifactDocUrls: AutomergeUrl[] } {
  // AMU rota facts (Mon-Wed, long day + long night shifts, 12h each)
  const amuFacts: StoredFact[] = [
    f('ward_roster', 'amu'),
    f('rostered_hours', 'amu', 432),

    f('employee', 'james_okafor'),
    f('employee', 'priya_sharma'),
    f('employee', 'emily_davies'),
    f('employee', 'mike_thompson'),
    f('registered_nurse', 'james_okafor'),
    f('registered_nurse', 'priya_sharma'),
    f('registered_nurse', 'emily_davies'),
    f('hca', 'mike_thompson'),
    f('band_6_plus', 'james_okafor'),
    f('competency', 'james_okafor', 'acute_assessment'),
    f('competency', 'priya_sharma', 'acute_assessment'),
    f('competency', 'emily_davies', 'acute_assessment'),

    // Monday day
    f('shift', 'amu_mon_day'),
    f('ward', 'amu_mon_day', 'amu'),
    f('assigned', 'amu_mon_day', 'james_okafor', 12),
    f('assigned', 'amu_mon_day', 'priya_sharma', 12),
    f('assigned', 'amu_mon_day', 'mike_thompson', 12),

    // Monday night
    f('shift', 'amu_mon_night'),
    f('night_shift', 'amu_mon_night'),
    f('ward', 'amu_mon_night', 'amu'),
    f('assigned', 'amu_mon_night', 'james_okafor', 12),
    f('assigned', 'amu_mon_night', 'emily_davies', 12),
    f('in_charge', 'amu_mon_night', 'james_okafor'),

    // Tuesday day
    f('shift', 'amu_tue_day'),
    f('ward', 'amu_tue_day', 'amu'),
    f('assigned', 'amu_tue_day', 'priya_sharma', 12),
    f('assigned', 'amu_tue_day', 'emily_davies', 12),
    f('assigned', 'amu_tue_day', 'mike_thompson', 12),

    // Tuesday night
    f('shift', 'amu_tue_night'),
    f('night_shift', 'amu_tue_night'),
    f('ward', 'amu_tue_night', 'amu'),
    f('assigned', 'amu_tue_night', 'james_okafor', 12),
    f('assigned', 'amu_tue_night', 'priya_sharma', 12),
    f('in_charge', 'amu_tue_night', 'james_okafor'),

    // Wednesday day
    f('shift', 'amu_wed_day'),
    f('ward', 'amu_wed_day', 'amu'),
    f('assigned', 'amu_wed_day', 'james_okafor', 12),
    f('assigned', 'amu_wed_day', 'emily_davies', 12),
    f('assigned', 'amu_wed_day', 'mike_thompson', 12),

    // Wednesday night
    f('shift', 'amu_wed_night'),
    f('night_shift', 'amu_wed_night'),
    f('ward', 'amu_wed_night', 'amu'),
    f('assigned', 'amu_wed_night', 'james_okafor', 12),
    f('assigned', 'amu_wed_night', 'priya_sharma', 12),
    f('in_charge', 'amu_wed_night', 'james_okafor'),
  ];

  const amuDraftText = `% AMU Rota Solution
ward_roster(amu).
rostered_hours(amu, 432).

employee(james_okafor). employee(priya_sharma).
employee(emily_davies). employee(mike_thompson).
registered_nurse(james_okafor). registered_nurse(priya_sharma).
registered_nurse(emily_davies). hca(mike_thompson).
band_6_plus(james_okafor).
competency(james_okafor, acute_assessment).
competency(priya_sharma, acute_assessment).
competency(emily_davies, acute_assessment).

% Monday
shift(amu_mon_day). ward(amu_mon_day, amu).
assigned(amu_mon_day, james_okafor, 12). assigned(amu_mon_day, priya_sharma, 12).
assigned(amu_mon_day, mike_thompson, 12).

night_shift(amu_mon_night). shift(amu_mon_night). ward(amu_mon_night, amu).
assigned(amu_mon_night, james_okafor, 12). assigned(amu_mon_night, emily_davies, 12).
in_charge(amu_mon_night, james_okafor).

% Tuesday
shift(amu_tue_day). ward(amu_tue_day, amu).
assigned(amu_tue_day, priya_sharma, 12). assigned(amu_tue_day, emily_davies, 12).
assigned(amu_tue_day, mike_thompson, 12).

night_shift(amu_tue_night). shift(amu_tue_night). ward(amu_tue_night, amu).
assigned(amu_tue_night, james_okafor, 12). assigned(amu_tue_night, priya_sharma, 12).
in_charge(amu_tue_night, james_okafor).

% Wednesday
shift(amu_wed_day). ward(amu_wed_day, amu).
assigned(amu_wed_day, james_okafor, 12). assigned(amu_wed_day, emily_davies, 12).
assigned(amu_wed_day, mike_thompson, 12).

night_shift(amu_wed_night). shift(amu_wed_night). ward(amu_wed_night, amu).
assigned(amu_wed_night, james_okafor, 12). assigned(amu_wed_night, priya_sharma, 12).
in_charge(amu_wed_night, james_okafor).`;

  const amuRotaUrl = createDatalogDoc(repo, 'AMU Rota', amuDraftText, amuFacts);

  // Ward 6 rota facts (Mon-Wed, long day + long night shifts, 12h each)
  const ward6Facts: StoredFact[] = [
    f('ward_roster', 'ward_6'),
    f('rostered_hours', 'ward_6', 504),

    f('employee', 'rachel_green'),
    f('employee', 'tom_williams'),
    f('employee', 'aisha_begum'),
    f('employee', 'dan_murphy'),
    f('employee', 'lisa_brown'),
    f('registered_nurse', 'rachel_green'),
    f('registered_nurse', 'tom_williams'),
    f('registered_nurse', 'aisha_begum'),
    f('hca', 'dan_murphy'),
    f('hca', 'lisa_brown'),

    // Monday day
    f('shift', 'w6_mon_day'),
    f('ward', 'w6_mon_day', 'ward_6'),
    f('assigned', 'w6_mon_day', 'rachel_green', 12),
    f('assigned', 'w6_mon_day', 'tom_williams', 12),
    f('assigned', 'w6_mon_day', 'aisha_begum', 12),
    f('assigned', 'w6_mon_day', 'dan_murphy', 12),
    f('assigned', 'w6_mon_day', 'lisa_brown', 12),
    f('patients', 'w6_mon_day', 22),
    f('has_hca', 'w6_mon_day'),

    // Monday night
    f('shift', 'w6_mon_night'),
    f('night_shift', 'w6_mon_night'),
    f('ward', 'w6_mon_night', 'ward_6'),
    f('assigned', 'w6_mon_night', 'rachel_green', 12),
    f('assigned', 'w6_mon_night', 'tom_williams', 12),
    f('assigned', 'w6_mon_night', 'dan_murphy', 12),
    f('patients', 'w6_mon_night', 20),
    f('has_hca', 'w6_mon_night'),

    // Tuesday day
    f('shift', 'w6_tue_day'),
    f('ward', 'w6_tue_day', 'ward_6'),
    f('assigned', 'w6_tue_day', 'tom_williams', 12),
    f('assigned', 'w6_tue_day', 'aisha_begum', 12),
    f('assigned', 'w6_tue_day', 'rachel_green', 12),
    f('assigned', 'w6_tue_day', 'lisa_brown', 12),
    f('patients', 'w6_tue_day', 24),
    f('has_hca', 'w6_tue_day'),

    // Tuesday night
    f('shift', 'w6_tue_night'),
    f('night_shift', 'w6_tue_night'),
    f('ward', 'w6_tue_night', 'ward_6'),
    f('assigned', 'w6_tue_night', 'aisha_begum', 12),
    f('assigned', 'w6_tue_night', 'tom_williams', 12),
    f('assigned', 'w6_tue_night', 'dan_murphy', 12),
    f('patients', 'w6_tue_night', 20),
    f('has_hca', 'w6_tue_night'),

    // Wednesday day
    f('shift', 'w6_wed_day'),
    f('ward', 'w6_wed_day', 'ward_6'),
    f('assigned', 'w6_wed_day', 'rachel_green', 12),
    f('assigned', 'w6_wed_day', 'aisha_begum', 12),
    f('assigned', 'w6_wed_day', 'dan_murphy', 12),
    f('assigned', 'w6_wed_day', 'lisa_brown', 12),
    f('patients', 'w6_wed_day', 22),
    f('has_hca', 'w6_wed_day'),

    // Wednesday night
    f('shift', 'w6_wed_night'),
    f('night_shift', 'w6_wed_night'),
    f('ward', 'w6_wed_night', 'ward_6'),
    f('assigned', 'w6_wed_night', 'tom_williams', 12),
    f('assigned', 'w6_wed_night', 'aisha_begum', 12),
    f('assigned', 'w6_wed_night', 'dan_murphy', 12),
    f('patients', 'w6_wed_night', 18),
    f('has_hca', 'w6_wed_night'),
  ];

  const ward6DraftText = `% Ward 6 Rota Solution
ward_roster(ward_6).
rostered_hours(ward_6, 504).

employee(rachel_green). employee(tom_williams). employee(aisha_begum).
employee(dan_murphy). employee(lisa_brown).
registered_nurse(rachel_green). registered_nurse(tom_williams).
registered_nurse(aisha_begum).
hca(dan_murphy). hca(lisa_brown).

% Monday
shift(w6_mon_day). ward(w6_mon_day, ward_6). patients(w6_mon_day, 22).
assigned(w6_mon_day, rachel_green, 12). assigned(w6_mon_day, tom_williams, 12).
assigned(w6_mon_day, aisha_begum, 12). assigned(w6_mon_day, dan_murphy, 12).
assigned(w6_mon_day, lisa_brown, 12). has_hca(w6_mon_day).

night_shift(w6_mon_night). shift(w6_mon_night). ward(w6_mon_night, ward_6). patients(w6_mon_night, 20).
assigned(w6_mon_night, rachel_green, 12). assigned(w6_mon_night, tom_williams, 12).
assigned(w6_mon_night, dan_murphy, 12). has_hca(w6_mon_night).

% Tuesday
shift(w6_tue_day). ward(w6_tue_day, ward_6). patients(w6_tue_day, 24).
assigned(w6_tue_day, tom_williams, 12). assigned(w6_tue_day, aisha_begum, 12).
assigned(w6_tue_day, rachel_green, 12). assigned(w6_tue_day, lisa_brown, 12).
has_hca(w6_tue_day).

night_shift(w6_tue_night). shift(w6_tue_night). ward(w6_tue_night, ward_6). patients(w6_tue_night, 20).
assigned(w6_tue_night, aisha_begum, 12). assigned(w6_tue_night, tom_williams, 12).
assigned(w6_tue_night, dan_murphy, 12). has_hca(w6_tue_night).

% Wednesday
shift(w6_wed_day). ward(w6_wed_day, ward_6). patients(w6_wed_day, 22).
assigned(w6_wed_day, rachel_green, 12). assigned(w6_wed_day, aisha_begum, 12).
assigned(w6_wed_day, dan_murphy, 12). assigned(w6_wed_day, lisa_brown, 12).
has_hca(w6_wed_day).

night_shift(w6_wed_night). shift(w6_wed_night). ward(w6_wed_night, ward_6). patients(w6_wed_night, 18).
assigned(w6_wed_night, tom_williams, 12). assigned(w6_wed_night, aisha_begum, 12).
assigned(w6_wed_night, dan_murphy, 12). has_hca(w6_wed_night).`;

  const ward6RotaUrl = createDatalogDoc(repo, 'Ward 6 Rota', ward6DraftText, ward6Facts);

  const artifactDocUrls = [amuRotaUrl, ward6RotaUrl];

  // Create artifacts folder
  const artifactsFolderHandle = repo.create<FolderDoc>();
  artifactsFolderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'Rota Artifacts';
    d.docs = [
      { type: 'datalog', name: 'AMU Rota', url: amuRotaUrl },
      { type: 'datalog', name: 'Ward 6 Rota', url: ward6RotaUrl },
    ];
  });

  // Create verification contexts linking verifications to artifacts
  const verificationSpecs = [
    {
      verificationUrl: verificationDatalogUrls[0],
      scope: 'system' as const,
      requiredArtifactUrls: artifactDocUrls,
      title: 'Trust-wide rota checks',
      description:
        'Ensure the combined hospital rota stays within the trust-wide hours budget and includes exactly two ward rosters.',
    },
    {
      verificationUrl: verificationDatalogUrls[1],
      scope: 'artifacts' as const,
      requiredArtifactUrls: artifactDocUrls,
      title: 'General ward staffing checks',
      description:
        'Ensure each generated ward rota satisfies the general staffing rules that apply across wards.',
    },
    {
      verificationUrl: verificationDatalogUrls[2],
      scope: 'artifacts' as const,
      requiredArtifactUrls: [amuRotaUrl],
      title: 'AMU-specific checks',
      description:
        'Ensure the AMU rota satisfies the required senior night coverage and acute assessment competency rules.',
    },
    {
      verificationUrl: verificationDatalogUrls[3],
      scope: 'artifacts' as const,
      requiredArtifactUrls: [ward6RotaUrl],
      title: 'Ward 6-specific checks',
      description:
        'Ensure the Ward 6 rota satisfies RN-to-patient ratio and HCA coverage requirements.',
    },
  ];

  const verificationContextUrls: AutomergeUrl[] = verificationSpecs.map((spec) => {
    const handle = repo.create<VerificationContextDoc & { '@patchwork': { type: string } }>();
    handle.change((d) => {
      d['@patchwork'] = { type: 'verification-context' };
      d.verificationUrl = spec.verificationUrl;
      d.artifactUrls = artifactDocUrls;
      d.scope = spec.scope;
      d.requiredArtifactUrls = spec.requiredArtifactUrls;
      d.title = spec.title;
      d.description = spec.description;
      d.viewMode = 'validation';
    });
    return handle.url;
  });

  // Create execution doc
  const executionHandle = repo.create<TaskListExecutionDoc & { '@patchwork': { type: string } }>();
  executionHandle.change((d) => {
    d['@patchwork'] = { type: 'execution' };
    d.specDocUrl = specDocUrl;
    d.planDocUrl = planDocUrl;
    d.status = 'in-progress';
    d.taskUrls = taskUrls;
    d.artifactsFolderUrl = artifactsFolderHandle.url;
    d.verificationContextUrls = verificationContextUrls;
  });

  return { executionDocUrl: executionHandle.url, artifactDocUrls };
}
