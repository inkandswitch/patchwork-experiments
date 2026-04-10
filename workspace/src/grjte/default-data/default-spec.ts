import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { SpecDoc, Spec } from '../../workflow/types';
import type { VerificationDoc } from '../spec/verification-doc';

type StoredAtom = { pred: string; args: string[] };
type StoredRule = { head: StoredAtom; body: StoredAtom[]; comment?: string };
type StoredConstraint = { body: StoredAtom[]; comment?: string };
type StoredFact = { pred: string; args: (string | number)[]; comment?: string };

type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  title?: string;
  facts: StoredFact[];
  rules: StoredRule[];
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

function createDatalogDoc(
  repo: Repo,
  title: string,
  draftText: string,
  options: {
    facts?: StoredFact[];
    rules?: StoredRule[];
    constraints?: StoredConstraint[];
  },
): AutomergeUrl {
  const handle = repo.create<DatalogDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = title;
    d.facts = options.facts ?? [];
    d.rules = options.rules ?? [];
    d.constraints = options.constraints ?? [];
    d.draftText = draftText;
    d.mapStyle = { lines: {}, properties: {} };
  });
  return handle.url;
}

function createFolder(
  repo: Repo,
  title: string,
  docs: { type: string; name: string; url: AutomergeUrl }[],
): AutomergeUrl {
  const handle = repo.create<FolderDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = title;
    d.docs = docs;
  });
  return handle.url;
}

function createVerificationDoc(
  repo: Repo,
  docUrl: AutomergeUrl,
  options: {
    title: string;
    description: string;
  },
): AutomergeUrl {
  const handle = repo.create<VerificationDoc & { '@patchwork': { type: string } }>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'verification' };
    d.docUrl = docUrl;
    d.script = '';
    d.title = options.title;
    d.description = options.description;
  });
  return handle.url;
}

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

function atom(pred: string, ...args: string[]): StoredAtom {
  return { pred, args };
}

function rule(head: StoredAtom, body: StoredAtom[], comment?: string): StoredRule {
  return { head, body, comment };
}

function constraint(body: StoredAtom[], comment: string): StoredConstraint {
  return { body, comment };
}

export function createDefaultSpec(repo: Repo): {
  specDocUrl: AutomergeUrl;
  subSpecUrls: AutomergeUrl[];
} {
  const trustChecksUrl = createDatalogDoc(
    repo,
    'Trust-wide Rota Checks',
    `% Trust-wide rota checks
:- not(ward_roster(amu)).
:- not(ward_roster(ward_6)).
:- ward_roster(W), neq(W, amu), neq(W, ward_6).
:- rostered_hours(amu, AmuHours), rostered_hours(ward_6, Ward6Hours), add(AmuHours, Ward6Hours, Total), trust_budget_hours(Max), gt(Total, Max).`,
    {
      constraints: [
        constraint([atom('not', 'ward_roster(amu)')], 'AMU roster must be present'),
        constraint([atom('not', 'ward_roster(ward_6)')], 'Ward 6 roster must be present'),
        constraint(
          [atom('ward_roster', 'W'), atom('neq', 'W', 'amu'), atom('neq', 'W', 'ward_6')],
          'Only AMU and Ward 6 rosters are allowed in the default scenario',
        ),
        constraint(
          [
            atom('rostered_hours', 'amu', 'AmuHours'),
            atom('rostered_hours', 'ward_6', 'Ward6Hours'),
            atom('add', 'AmuHours', 'Ward6Hours', 'Total'),
            atom('trust_budget_hours', 'Max'),
            atom('gt', 'Total', 'Max'),
          ],
          'Combined rostered hours must remain within the trust budget',
        ),
      ],
    },
  );

  const generalWardRulesUrl = createDatalogDoc(
    repo,
    'General Ward Rules',
    `% General ward rules
rn_in_slot(S, Slot) :- assignment_slot(S, Slot, E), registered_nurse(E), not(supernumerary(E)).
hca_in_slot(S, Slot) :- assignment_slot(S, Slot, E), hca(E), not(supernumerary(E)).
two_rns_on_shift(S) :- rn_in_slot(S, SlotA), rn_in_slot(S, SlotB), neq(SlotA, SlotB).
three_rns_on_shift(S) :- rn_in_slot(S, SlotA), rn_in_slot(S, SlotB), rn_in_slot(S, SlotC), neq(SlotA, SlotB), neq(SlotA, SlotC), neq(SlotB, SlotC).
hca_on_shift(S) :- hca_in_slot(S, Slot).
band_6_in_charge_on_shift(S) :- in_charge(S, E), assigned(S, E, _), registered_nurse(E), band_6_plus(E).

:- assigned(S, E, _), not(employee(E)).
:- assignment_slot(S, SlotA, E), assignment_slot(S, SlotB, E), neq(SlotA, SlotB).
:- employee_rostered_hours(E, Total), max_weekly_hours_limit(Max), gt(Total, Max).
:- assigned(S, E, _), ward(S, W), home_ward(E, HomeWard), neq(W, HomeWard).
:- assigned(S, E, _), supernumerary(E).
:- shift(S), ward(S, W), requires_two_rns(W), not(two_rns_on_shift(S)).
:- shift(S), ward(S, W), requires_hca(W), not(hca_on_shift(S)).`,
    {
      rules: [
        rule(
          atom('rn_in_slot', 'S', 'Slot'),
          [
            atom('assignment_slot', 'S', 'Slot', 'E'),
            atom('registered_nurse', 'E'),
            atom('not', 'supernumerary(E)'),
          ],
          'Registered nurses only count toward coverage when they are direct-care staff',
        ),
        rule(
          atom('hca_in_slot', 'S', 'Slot'),
          [
            atom('assignment_slot', 'S', 'Slot', 'E'),
            atom('hca', 'E'),
            atom('not', 'supernumerary(E)'),
          ],
          'HCAs only count toward coverage when they are direct-care staff',
        ),
        rule(
          atom('two_rns_on_shift', 'S'),
          [atom('rn_in_slot', 'S', 'SlotA'), atom('rn_in_slot', 'S', 'SlotB'), atom('neq', 'SlotA', 'SlotB')],
          'Two distinct RN slots satisfy the baseline RN coverage rule',
        ),
        rule(
          atom('three_rns_on_shift', 'S'),
          [
            atom('rn_in_slot', 'S', 'SlotA'),
            atom('rn_in_slot', 'S', 'SlotB'),
            atom('rn_in_slot', 'S', 'SlotC'),
            atom('neq', 'SlotA', 'SlotB'),
            atom('neq', 'SlotA', 'SlotC'),
            atom('neq', 'SlotB', 'SlotC'),
          ],
          'Three distinct RN slots satisfy the high-census coverage rule',
        ),
        rule(atom('hca_on_shift', 'S'), [atom('hca_in_slot', 'S', 'Slot')], 'At least one HCA is present on the shift'),
        rule(
          atom('band_6_in_charge_on_shift', 'S'),
          [
            atom('in_charge', 'S', 'E'),
            atom('assigned', 'S', 'E', '_'),
            atom('registered_nurse', 'E'),
            atom('band_6_plus', 'E'),
          ],
          'The named nurse in charge must be rostered on the shift and be Band 6+',
        ),
      ],
      constraints: [
        constraint(
          [atom('assigned', 'S', 'E', '_'), atom('not', 'employee(E)')],
          'Every assignment must reference a known employee',
        ),
        constraint(
          [
            atom('assignment_slot', 'S', 'SlotA', 'E'),
            atom('assignment_slot', 'S', 'SlotB', 'E'),
            atom('neq', 'SlotA', 'SlotB'),
          ],
          'A person may not be assigned to the same shift more than once',
        ),
        constraint(
          [atom('employee_rostered_hours', 'E', 'Total'), atom('max_weekly_hours_limit', 'Max'), atom('gt', 'Total', 'Max')],
          'No employee may exceed the default weekly hours limit',
        ),
        constraint(
          [
            atom('assigned', 'S', 'E', '_'),
            atom('ward', 'S', 'W'),
            atom('home_ward', 'E', 'HomeWard'),
            atom('neq', 'W', 'HomeWard'),
          ],
          'Assignments must stay within each employee’s home ward in the default scenario',
        ),
        constraint(
          [atom('assigned', 'S', 'E', '_'), atom('supernumerary', 'E')],
          'Supernumerary staff must not be assigned into direct-care coverage',
        ),
        constraint(
          [atom('shift', 'S'), atom('ward', 'S', 'W'), atom('requires_two_rns', 'W'), atom('not', 'two_rns_on_shift(S)')],
          'Each shift must have at least two direct-care registered nurses',
        ),
        constraint(
          [atom('shift', 'S'), atom('ward', 'S', 'W'), atom('requires_hca', 'W'), atom('not', 'hca_on_shift(S)')],
          'Each shift must include at least one direct-care HCA',
        ),
      ],
    },
  );

  const amuRulesUrl = createDatalogDoc(
    repo,
    'AMU Rules',
    `% AMU-specific rules
band_6_in_charge_on_shift(S) :- in_charge(S, E), assigned(S, E, _), registered_nurse(E), band_6_plus(E).

:- night_shift(S), ward(S, W), requires_band_6_in_charge(W), not(band_6_in_charge_on_shift(S)).
:- assigned(S, E, _), ward(S, W), registered_nurse(E), required_rn_competency(W, Competency), not(competency(E, Competency)).`,
    {
      rules: [
        rule(
          atom('band_6_in_charge_on_shift', 'S'),
          [
            atom('in_charge', 'S', 'E'),
            atom('assigned', 'S', 'E', '_'),
            atom('registered_nurse', 'E'),
            atom('band_6_plus', 'E'),
          ],
          'The named nurse in charge must be rostered on the shift and be Band 6+',
        ),
      ],
      constraints: [
        constraint(
          [
            atom('night_shift', 'S'),
            atom('ward', 'S', 'W'),
            atom('requires_band_6_in_charge', 'W'),
            atom('not', 'band_6_in_charge_on_shift(S)'),
          ],
          'AMU night shifts must name a Band 6+ registered nurse in charge',
        ),
        constraint(
          [
            atom('assigned', 'S', 'E', '_'),
            atom('ward', 'S', 'W'),
            atom('registered_nurse', 'E'),
            atom('required_rn_competency', 'W', 'Competency'),
            atom('not', 'competency(E, Competency)'),
          ],
          'AMU registered nurses must hold the acute assessment competency',
        ),
      ],
    },
  );

  const ward6RulesUrl = createDatalogDoc(
    repo,
    'Ward 6 Rules',
    `% Ward 6-specific rules
rn_in_slot(S, Slot) :- assignment_slot(S, Slot, E), registered_nurse(E), not(supernumerary(E)).
three_rns_on_shift(S) :- rn_in_slot(S, SlotA), rn_in_slot(S, SlotB), rn_in_slot(S, SlotC), neq(SlotA, SlotB), neq(SlotA, SlotC), neq(SlotB, SlotC).

:- shift(S), ward(S, W), patients(S, Patients), high_census_threshold(W, Threshold), gt(Patients, Threshold), not(three_rns_on_shift(S)).`,
    {
      rules: [
        rule(
          atom('rn_in_slot', 'S', 'Slot'),
          [
            atom('assignment_slot', 'S', 'Slot', 'E'),
            atom('registered_nurse', 'E'),
            atom('not', 'supernumerary(E)'),
          ],
          'Registered nurses only count toward coverage when they are direct-care staff',
        ),
        rule(
          atom('three_rns_on_shift', 'S'),
          [
            atom('rn_in_slot', 'S', 'SlotA'),
            atom('rn_in_slot', 'S', 'SlotB'),
            atom('rn_in_slot', 'S', 'SlotC'),
            atom('neq', 'SlotA', 'SlotB'),
            atom('neq', 'SlotA', 'SlotC'),
            atom('neq', 'SlotB', 'SlotC'),
          ],
          'Three distinct RN slots satisfy the high-census coverage rule',
        ),
      ],
      constraints: [
        constraint(
          [
            atom('shift', 'S'),
            atom('ward', 'S', 'W'),
            atom('patients', 'S', 'Patients'),
            atom('high_census_threshold', 'W', 'Threshold'),
            atom('gt', 'Patients', 'Threshold'),
            atom('not', 'three_rns_on_shift(S)'),
          ],
          'Ward 6 shifts above the high-census threshold must roster three registered nurses',
        ),
      ],
    },
  );

  const staffRosterDataUrl = createDatalogDoc(
    repo,
    'Staff Roster',
    `% Staff roster
employee(sarah_chen). home_ward(sarah_chen, amu). band_6_plus(sarah_chen). registered_nurse(sarah_chen). supernumerary(sarah_chen). competency(sarah_chen, acute_assessment).
employee(james_okafor). home_ward(james_okafor, amu). band_6_plus(james_okafor). registered_nurse(james_okafor). competency(james_okafor, acute_assessment).
employee(priya_sharma). home_ward(priya_sharma, amu). registered_nurse(priya_sharma). competency(priya_sharma, acute_assessment).
employee(emily_davies). home_ward(emily_davies, amu). registered_nurse(emily_davies). competency(emily_davies, acute_assessment).
employee(nia_ford). home_ward(nia_ford, amu). registered_nurse(nia_ford). competency(nia_ford, acute_assessment).
employee(luke_evans). home_ward(luke_evans, amu). hca(luke_evans).
employee(mike_thompson). home_ward(mike_thompson, amu). hca(mike_thompson).

employee(rachel_green). home_ward(rachel_green, ward_6). band_6_plus(rachel_green). registered_nurse(rachel_green).
employee(tom_williams). home_ward(tom_williams, ward_6). registered_nurse(tom_williams).
employee(aisha_begum). home_ward(aisha_begum, ward_6). registered_nurse(aisha_begum).
employee(helen_morris). home_ward(helen_morris, ward_6). registered_nurse(helen_morris).
employee(noor_khan). home_ward(noor_khan, ward_6). registered_nurse(noor_khan).
employee(dan_murphy). home_ward(dan_murphy, ward_6). hca(dan_murphy).
employee(lisa_brown). home_ward(lisa_brown, ward_6). hca(lisa_brown).`,
    {
      facts: [
        f('employee', 'sarah_chen'),
        f('home_ward', 'sarah_chen', 'amu'),
        f('band_6_plus', 'sarah_chen'),
        f('registered_nurse', 'sarah_chen'),
        f('supernumerary', 'sarah_chen'),
        f('competency', 'sarah_chen', 'acute_assessment'),
        f('employee', 'james_okafor'),
        f('home_ward', 'james_okafor', 'amu'),
        f('band_6_plus', 'james_okafor'),
        f('registered_nurse', 'james_okafor'),
        f('competency', 'james_okafor', 'acute_assessment'),
        f('employee', 'priya_sharma'),
        f('home_ward', 'priya_sharma', 'amu'),
        f('registered_nurse', 'priya_sharma'),
        f('competency', 'priya_sharma', 'acute_assessment'),
        f('employee', 'emily_davies'),
        f('home_ward', 'emily_davies', 'amu'),
        f('registered_nurse', 'emily_davies'),
        f('competency', 'emily_davies', 'acute_assessment'),
        f('employee', 'nia_ford'),
        f('home_ward', 'nia_ford', 'amu'),
        f('registered_nurse', 'nia_ford'),
        f('competency', 'nia_ford', 'acute_assessment'),
        f('employee', 'luke_evans'),
        f('home_ward', 'luke_evans', 'amu'),
        f('hca', 'luke_evans'),
        f('employee', 'mike_thompson'),
        f('home_ward', 'mike_thompson', 'amu'),
        f('hca', 'mike_thompson'),
        f('employee', 'rachel_green'),
        f('home_ward', 'rachel_green', 'ward_6'),
        f('band_6_plus', 'rachel_green'),
        f('registered_nurse', 'rachel_green'),
        f('employee', 'tom_williams'),
        f('home_ward', 'tom_williams', 'ward_6'),
        f('registered_nurse', 'tom_williams'),
        f('employee', 'aisha_begum'),
        f('home_ward', 'aisha_begum', 'ward_6'),
        f('registered_nurse', 'aisha_begum'),
        f('employee', 'helen_morris'),
        f('home_ward', 'helen_morris', 'ward_6'),
        f('registered_nurse', 'helen_morris'),
        f('employee', 'noor_khan'),
        f('home_ward', 'noor_khan', 'ward_6'),
        f('registered_nurse', 'noor_khan'),
        f('employee', 'dan_murphy'),
        f('home_ward', 'dan_murphy', 'ward_6'),
        f('hca', 'dan_murphy'),
        f('employee', 'lisa_brown'),
        f('home_ward', 'lisa_brown', 'ward_6'),
        f('hca', 'lisa_brown'),
      ],
    },
  );

  const trustPolicyDataUrl = createDatalogDoc(
    repo,
    'Trust Policy',
    `% Trust policy
trust_budget_hours(504).
max_weekly_hours_limit(48).`,
    {
      facts: [f('trust_budget_hours', 504), f('max_weekly_hours_limit', 48)],
    },
  );

  const shiftDefinitionsDataUrl = createDatalogDoc(
    repo,
    'Shift Definitions',
    `% Shift definitions
shift_length_hours(long_day, 12).
shift_length_hours(long_night, 12).
shift_kind(long_day, day).
shift_kind(long_night, night).`,
    {
      facts: [
        f('shift_length_hours', 'long_day', 12),
        f('shift_length_hours', 'long_night', 12),
        f('shift_kind', 'long_day', 'day'),
        f('shift_kind', 'long_night', 'night'),
      ],
    },
  );

  const amuDataUrl = createDatalogDoc(
    repo,
    'AMU Staffing Assumptions',
    `% AMU staffing assumptions
requires_two_rns(amu).
requires_hca(amu).
requires_band_6_in_charge(amu).
required_rn_competency(amu, acute_assessment).`,
    {
      facts: [
        f('requires_two_rns', 'amu'),
        f('requires_hca', 'amu'),
        f('requires_band_6_in_charge', 'amu'),
        f('required_rn_competency', 'amu', 'acute_assessment'),
      ],
    },
  );

  const ward6DataUrl = createDatalogDoc(
    repo,
    'Ward 6 Staffing Assumptions',
    `% Ward 6 staffing assumptions
requires_two_rns(ward_6).
requires_hca(ward_6).
high_census_threshold(ward_6, 16).`,
    {
      facts: [
        f('requires_two_rns', 'ward_6'),
        f('requires_hca', 'ward_6'),
        f('high_census_threshold', 'ward_6', 16),
      ],
    },
  );

  const rootDataFolderUrl = createFolder(repo, 'Hospital Data', [
    { type: 'datalog', name: 'Staff Roster', url: staffRosterDataUrl },
    { type: 'datalog', name: 'Trust Policy', url: trustPolicyDataUrl },
    { type: 'datalog', name: 'Shift Definitions', url: shiftDefinitionsDataUrl },
  ]);

  const amuDataFolderUrl = createFolder(repo, 'AMU Data', [
    { type: 'datalog', name: 'AMU Staffing Assumptions', url: amuDataUrl },
  ]);

  const ward6DataFolderUrl = createFolder(repo, 'Ward 6 Data', [
    { type: 'datalog', name: 'Ward 6 Staffing Assumptions', url: ward6DataUrl },
  ]);

  const trustChecksVerificationUrl = createVerificationDoc(repo, trustChecksUrl, {
    title: 'Trust-wide rota checks',
    description:
      'Ensure both ward rosters are present and the combined rostered hours remain within the trust budget.',
  });
  const generalWardRulesVerificationUrl = createVerificationDoc(repo, generalWardRulesUrl, {
    title: 'General ward staffing checks',
    description:
      'Ensure assignments are unique, stay within weekly hours, use direct-care staff correctly, and meet baseline ward coverage.',
  });
  const amuRulesVerificationUrl = createVerificationDoc(repo, amuRulesUrl, {
    title: 'AMU-specific checks',
    description:
      'Ensure AMU night shifts have a Band 6+ nurse in charge and all AMU registered nurses hold the acute assessment competency.',
  });
  const ward6RulesVerificationUrl = createVerificationDoc(repo, ward6RulesUrl, {
    title: 'Ward 6-specific checks',
    description:
      'Ensure Ward 6 shifts above the high-census threshold roster three registered nurses.',
  });

  const amuSpecHandle = repo.create<SpecDoc>();
  amuSpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'AMU rota',
      dataFolderUrl: amuDataFolderUrl,
      verificationUrls: [generalWardRulesVerificationUrl, amuRulesVerificationUrl],
    };
  });

  const ward6SpecHandle = repo.create<SpecDoc>();
  ward6SpecHandle.change((d) => {
    d['@patchwork'] = { type: 'spec' };
    d.spec = {
      goal: 'Ward 6 rota',
      dataFolderUrl: ward6DataFolderUrl,
      verificationUrls: [generalWardRulesVerificationUrl, ward6RulesVerificationUrl],
    };
  });

  const spec: Spec = {
    goal: 'Hospital rota',
    dataFolderUrl: rootDataFolderUrl,
    verificationUrls: [trustChecksVerificationUrl],
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
  };
}
