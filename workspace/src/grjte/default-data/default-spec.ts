import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { SpecDoc, Spec, VerificationContextDoc } from '../../workflow/types';

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

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

function createConstraintDoc(
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

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

function createDataDoc(repo: Repo, title: string, draftText: string, facts: StoredFact[]): AutomergeUrl {
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

function createFolder(repo: Repo, title: string, docs: { type: string; name: string; url: AutomergeUrl }[]): AutomergeUrl {
  const handle = repo.create<FolderDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = title;
    d.docs = docs;
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
  const trustRotaRulesUrl = createConstraintDoc(
    repo,
    'Trust Rota Rules',
    `% St Mary's Hospital NHS Trust — Trust-wide Rota Rules

% Staff establishment
staff(sarah_chen, amu, 7).
staff(james_okafor, amu, 6).
staff(priya_sharma, amu, 5).
staff(emily_davies, amu, 5).
staff(mike_thompson, amu, 3).
staff(rachel_green, ward_6, 6).
staff(tom_williams, ward_6, 5).
staff(aisha_begum, ward_6, 5).
staff(dan_murphy, ward_6, 3).
staff(lisa_brown, ward_6, 2).

% Weekly hours budget
budget(480).

% Total rostered hours must not exceed trust budget
:- sum(H, rostered_hours(_, H), Total), budget(B), gt(Total, B).

% Must have exactly 2 ward rosters
:- sum(_, ward_roster(_), Count), neq(Count, 2).`,
    [
      {
        body: [
          { pred: 'sum', args: ['H', 'rostered_hours(_, H)', 'Total'] },
          { pred: 'budget', args: ['B'] },
          { pred: 'gt', args: ['Total', 'B'] },
        ],
        comment: 'Total rostered hours must not exceed trust budget',
      },
      {
        body: [
          { pred: 'sum', args: ['_', 'ward_roster(_)', 'Count'] },
          { pred: 'neq', args: ['Count', '2'] },
        ],
        comment: 'Must have exactly 2 ward rosters',
      },
    ],
  );

  const generalWardRulesUrl = createConstraintDoc(
    repo,
    'General Ward Rules',
    `% General Ward Rules (all wards)

% Minimum registered nurses (Band 5+) per shift
min_rn_coverage(2).

% Working Time Directive: max weekly hours
max_weekly_hours(48).

% Each shift must have minimum 2 registered nurses
:- shift(S), sum(_, assigned(S, E), registered_nurse(E)), Count, lt(Count, 2).

% No employee may work more than 48 hours per week (Working Time Directive)
:- employee(E), sum(H, assigned(_, E, H), Total), max_weekly_hours(M), gt(Total, M).

% Minimum 11 hours rest between shifts
:- assigned(S1, E, _), assigned(S2, E, _), neq(S1, S2), shift_end(S1, End1), shift_start(S2, Start2), diff(Start2, End1, Gap), lt(Gap, 11).`,
    [
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'sum', args: ['_', 'assigned(S, E)', 'registered_nurse(E)'] },
          { pred: 'lt', args: ['Count', '2'] },
        ],
        comment: 'Each shift must have minimum 2 registered nurses (Band 5+)',
      },
      {
        body: [
          { pred: 'employee', args: ['E'] },
          { pred: 'sum', args: ['H', 'assigned(_, E, H)', 'Total'] },
          { pred: 'max_weekly_hours', args: ['M'] },
          { pred: 'gt', args: ['Total', 'M'] },
        ],
        comment: 'No employee may work more than 48 hours/week (Working Time Directive)',
      },
    ],
  );

  const amuRulesUrl = createConstraintDoc(
    repo,
    'AMU Rules',
    `% AMU-specific Rules

% AMU staff
staff_in_ward(sarah_chen, amu).
staff_in_ward(james_okafor, amu).
staff_in_ward(priya_sharma, amu).
staff_in_ward(emily_davies, amu).
staff_in_ward(mike_thompson, amu).

% Band 6+ staff (can be nurse in charge)
band_6_plus(sarah_chen).
band_6_plus(james_okafor).

% Acute assessment competency
competency(sarah_chen, acute_assessment).
competency(james_okafor, acute_assessment).
competency(priya_sharma, acute_assessment).
competency(emily_davies, acute_assessment).

% Night shifts require a Band 6+ nurse in charge
:- night_shift(S), ward(S, amu), sum(_, assigned(S, E), band_6_plus(E)), Count, lt(Count, 1).

% All AMU nursing staff must hold acute assessment competency
:- assigned(S, E, _), ward(S, amu), registered_nurse(E), not(competency(E, acute_assessment)).`,
    [
      {
        body: [
          { pred: 'night_shift', args: ['S'] },
          { pred: 'ward', args: ['S', 'amu'] },
          { pred: 'sum', args: ['_', 'assigned(S, E)', 'band_6_plus(E)'] },
          { pred: 'lt', args: ['Count', '1'] },
        ],
        comment: 'Night shifts require a Band 6+ nurse in charge',
      },
      {
        body: [
          { pred: 'assigned', args: ['S', 'E', '_'] },
          { pred: 'ward', args: ['S', 'amu'] },
          { pred: 'registered_nurse', args: ['E'] },
          { pred: 'not', args: ['competency(E, acute_assessment)'] },
        ],
        comment: 'All AMU nursing staff must hold acute assessment competency',
      },
    ],
  );

  const ward6RulesUrl = createConstraintDoc(
    repo,
    'Ward 6 Rules',
    `% Ward 6 (General Medicine) Rules

% Ward 6 staff
staff_in_ward(rachel_green, ward_6).
staff_in_ward(tom_williams, ward_6).
staff_in_ward(aisha_begum, ward_6).
staff_in_ward(dan_murphy, ward_6).
staff_in_ward(lisa_brown, ward_6).

% NICE red flag: max RN-to-patient ratio
max_rn_patient_ratio(8).

% Maximum 1:8 RN-to-patient ratio (NICE safe staffing red flag)
:- shift(S), ward(S, ward_6), patients(S, P), sum(_, assigned(S, E), registered_nurse(E)), Staff, div(P, Staff, Ratio), max_rn_patient_ratio(M), gt(Ratio, M).

% Each shift must have at least one HCA (Band 2-3)
:- shift(S), ward(S, ward_6), sum(_, assigned(S, E), hca(E)), Count, lt(Count, 1).`,
    [
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'ward', args: ['S', 'ward_6'] },
          { pred: 'patients', args: ['S', 'P'] },
          { pred: 'sum', args: ['_', 'assigned(S, E)', 'registered_nurse(E)'] },
          { pred: 'div', args: ['P', 'Staff', 'Ratio'] },
          { pred: 'max_rn_patient_ratio', args: ['M'] },
          { pred: 'gt', args: ['Ratio', 'M'] },
        ],
        comment: 'Maximum 1:8 RN-to-patient ratio (NICE safe staffing red flag)',
      },
      {
        body: [
          { pred: 'shift', args: ['S'] },
          { pred: 'ward', args: ['S', 'ward_6'] },
          { pred: 'sum', args: ['_', 'assigned(S, E)', 'hca(E)'] },
          { pred: 'lt', args: ['Count', '1'] },
        ],
        comment: 'Each shift must have at least one HCA (Band 2-3)',
      },
    ],
  );

  // --- Data docs (formalized input data for spec) ---

  const allStaffDataUrl = createDataDoc(
    repo,
    'Staff Roster',
    `% St Mary's Hospital NHS Trust — Staff Roster
staff(sarah_chen, amu, 7).
staff(james_okafor, amu, 6).
staff(priya_sharma, amu, 5).
staff(emily_davies, amu, 5).
staff(mike_thompson, amu, 3).
staff(rachel_green, ward_6, 6).
staff(tom_williams, ward_6, 5).
staff(aisha_begum, ward_6, 5).
staff(dan_murphy, ward_6, 3).
staff(lisa_brown, ward_6, 2).

registered_nurse(sarah_chen). registered_nurse(james_okafor).
registered_nurse(priya_sharma). registered_nurse(emily_davies).
registered_nurse(rachel_green). registered_nurse(tom_williams).
registered_nurse(aisha_begum).

hca(mike_thompson). hca(dan_murphy). hca(lisa_brown).
supernumerary(sarah_chen).`,
    [
      f('staff', 'sarah_chen', 'amu', 7), f('staff', 'james_okafor', 'amu', 6),
      f('staff', 'priya_sharma', 'amu', 5), f('staff', 'emily_davies', 'amu', 5),
      f('staff', 'mike_thompson', 'amu', 3),
      f('staff', 'rachel_green', 'ward_6', 6), f('staff', 'tom_williams', 'ward_6', 5),
      f('staff', 'aisha_begum', 'ward_6', 5), f('staff', 'dan_murphy', 'ward_6', 3),
      f('staff', 'lisa_brown', 'ward_6', 2),
      f('registered_nurse', 'sarah_chen'), f('registered_nurse', 'james_okafor'),
      f('registered_nurse', 'priya_sharma'), f('registered_nurse', 'emily_davies'),
      f('registered_nurse', 'rachel_green'), f('registered_nurse', 'tom_williams'),
      f('registered_nurse', 'aisha_begum'),
      f('hca', 'mike_thompson'), f('hca', 'dan_murphy'), f('hca', 'lisa_brown'),
      f('supernumerary', 'sarah_chen'),
    ],
  );

  const wardInfoDataUrl = createDataDoc(
    repo,
    'Ward Information',
    `% Ward Information
ward(amu, 20).
ward(ward_6, 28).
ward_type(amu, acute_medical).
ward_type(ward_6, general_medicine).`,
    [
      f('ward', 'amu', 20), f('ward', 'ward_6', 28),
      f('ward_type', 'amu', 'acute_medical'), f('ward_type', 'ward_6', 'general_medicine'),
    ],
  );

  const shiftDefsDataUrl = createDataDoc(
    repo,
    'Shift Definitions',
    `% Shift Definitions
shift_type(long_day, 0730, 2000, 12).
shift_type(long_night, 1930, 0800, 12).
rota_week(week_1).`,
    [
      f('shift_type', 'long_day', '0730', '2000', 12),
      f('shift_type', 'long_night', '1930', '0800', 12),
      f('rota_week', 'week_1'),
    ],
  );

  const amuStaffDataUrl = createDataDoc(
    repo,
    'AMU Staff',
    `% AMU Staff
staff_in_ward(sarah_chen, amu). staff_in_ward(james_okafor, amu).
staff_in_ward(priya_sharma, amu). staff_in_ward(emily_davies, amu).
staff_in_ward(mike_thompson, amu).
band_6_plus(sarah_chen). band_6_plus(james_okafor).
competency(sarah_chen, acute_assessment). competency(james_okafor, acute_assessment).
competency(priya_sharma, acute_assessment). competency(emily_davies, acute_assessment).`,
    [
      f('staff_in_ward', 'sarah_chen', 'amu'), f('staff_in_ward', 'james_okafor', 'amu'),
      f('staff_in_ward', 'priya_sharma', 'amu'), f('staff_in_ward', 'emily_davies', 'amu'),
      f('staff_in_ward', 'mike_thompson', 'amu'),
      f('band_6_plus', 'sarah_chen'), f('band_6_plus', 'james_okafor'),
      f('competency', 'sarah_chen', 'acute_assessment'), f('competency', 'james_okafor', 'acute_assessment'),
      f('competency', 'priya_sharma', 'acute_assessment'), f('competency', 'emily_davies', 'acute_assessment'),
    ],
  );

  const ward6StaffDataUrl = createDataDoc(
    repo,
    'Ward 6 Staff',
    `% Ward 6 Staff
staff_in_ward(rachel_green, ward_6). staff_in_ward(tom_williams, ward_6).
staff_in_ward(aisha_begum, ward_6). staff_in_ward(dan_murphy, ward_6).
staff_in_ward(lisa_brown, ward_6).`,
    [
      f('staff_in_ward', 'rachel_green', 'ward_6'), f('staff_in_ward', 'tom_williams', 'ward_6'),
      f('staff_in_ward', 'aisha_begum', 'ward_6'), f('staff_in_ward', 'dan_murphy', 'ward_6'),
      f('staff_in_ward', 'lisa_brown', 'ward_6'),
    ],
  );

  // --- Data folders ---

  const rootDataFolderUrl = createFolder(repo, 'Hospital Data', [
    { type: 'datalog', name: 'Staff Roster', url: allStaffDataUrl },
    { type: 'datalog', name: 'Ward Information', url: wardInfoDataUrl },
    { type: 'datalog', name: 'Shift Definitions', url: shiftDefsDataUrl },
  ]);

  const amuDataFolderUrl = createFolder(repo, 'AMU Data', [
    { type: 'datalog', name: 'AMU Staff', url: amuStaffDataUrl },
  ]);

  const ward6DataFolderUrl = createFolder(repo, 'Ward 6 Data', [
    { type: 'datalog', name: 'Ward 6 Staff', url: ward6StaffDataUrl },
  ]);

  // Wrap each verification datalog doc in a VerificationContextDoc (empty artifactUrls for spec)
  const trustRotaRulesVcUrl = createVerificationContext(repo, trustRotaRulesUrl, []);
  const generalWardRulesVcUrl = createVerificationContext(repo, generalWardRulesUrl, []);
  const amuRulesVcUrl = createVerificationContext(repo, amuRulesUrl, []);
  const ward6RulesVcUrl = createVerificationContext(repo, ward6RulesUrl, []);

  const amuSpecHandle = repo.create<SpecDoc>();
  amuSpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'AMU Rota',
      dataFolderUrl: amuDataFolderUrl,
      verificationUrls: [generalWardRulesVcUrl, amuRulesVcUrl],
    };
  });

  const ward6SpecHandle = repo.create<SpecDoc>();
  ward6SpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Ward 6 Rota',
      dataFolderUrl: ward6DataFolderUrl,
      verificationUrls: [generalWardRulesVcUrl, ward6RulesVcUrl],
    };
  });

  const spec: Spec = {
    goal: 'Hospital Rota',
    dataFolderUrl: rootDataFolderUrl,
    verificationUrls: [trustRotaRulesVcUrl],
    subSpecUrls: [amuSpecHandle.url, ward6SpecHandle.url],
  };

  const specHandle = repo.create<SpecDoc>();
  specHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = spec;
  });

  return {
    specDocUrl: specHandle.url,
    subSpecUrls: [amuSpecHandle.url, ward6SpecHandle.url],
    verificationDatalogUrls: [trustRotaRulesUrl, generalWardRulesUrl, amuRulesUrl, ward6RulesUrl],
    verificationContextUrls: [trustRotaRulesVcUrl, generalWardRulesVcUrl, amuRulesVcUrl, ward6RulesVcUrl],
  };
}
