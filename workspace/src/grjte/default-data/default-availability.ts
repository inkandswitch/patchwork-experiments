import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';

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

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

/**
 * Creates the staff availability reference data document.
 *
 * Contains `day_off(Employee, Day)` facts that record which days each
 * employee is unavailable during the rota period (monday–wednesday).
 *
 * Days off are designed so that:
 *  - james_okafor is off tuesday → fiona_grant covers AMU NIC on tue night
 *  - rachel_green is off wednesday → sam_patel covers Ward 6 on wed
 *  - Several other staff have staggered days off to exercise the constraint
 */
export function createStaffAvailabilityDoc(repo: Repo): AutomergeUrl {
  const handle = repo.create<DatalogDoc>();
  handle.change((d) => {
    d['@patchwork'] = { type: 'datalog' };
    d.title = 'Staff Availability';
    d.facts = [
      // AMU days off
      f('day_off', 'james_okafor', 'tuesday'),
      f('day_off', 'fiona_grant', 'wednesday'),
      f('day_off', 'priya_sharma', 'wednesday'),
      f('day_off', 'emily_davies', 'monday'),
      f('day_off', 'ben_walker', 'tuesday'),
      f('day_off', 'grace_hall', 'monday'),
      f('day_off', 'luke_evans', 'wednesday'),
      f('day_off', 'olivia_barnes', 'tuesday'),

      // Ward 6 days off
      f('day_off', 'rachel_green', 'wednesday'),
      f('day_off', 'sam_patel', 'monday'),
      f('day_off', 'tom_williams', 'wednesday'),
      f('day_off', 'aisha_begum', 'tuesday'),
      f('day_off', 'jade_turner', 'monday'),
      f('day_off', 'chris_adams', 'tuesday'),
      f('day_off', 'dan_murphy', 'wednesday'),
      f('day_off', 'kevin_wright', 'monday'),
    ];
    d.rules = [];
    d.constraints = [];
    d.draftText = `% Staff availability — days off during the rota period (Mon–Wed)

% AMU staff days off
day_off(james_okafor, tuesday).
day_off(fiona_grant, wednesday).
day_off(priya_sharma, wednesday).
day_off(emily_davies, monday).
day_off(ben_walker, tuesday).
day_off(grace_hall, monday).
day_off(luke_evans, wednesday).
day_off(olivia_barnes, tuesday).

% Ward 6 staff days off
day_off(rachel_green, wednesday).
day_off(sam_patel, monday).
day_off(tom_williams, wednesday).
day_off(aisha_begum, tuesday).
day_off(jade_turner, monday).
day_off(chris_adams, tuesday).
day_off(dan_murphy, wednesday).
day_off(kevin_wright, monday).`;
    d.mapStyle = { lines: {}, properties: {} };
  });
  return handle.url;
}
