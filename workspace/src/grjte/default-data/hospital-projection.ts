import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { ProjectionDoc } from '../artifact-projection';
import type { DatalogDoc } from '../verification/model';

type StoredFact = DatalogDoc['facts'][number];

export function buildHospitalRotaProjection(
  artifactDocUrl: AutomergeUrl,
  title: string,
  staffSlots = 5,
): ProjectionDoc {
  return {
    '@patchwork': { type: 'artifact-projection' },
    artifactDocUrl,
    sourceType: 'datalog',
    title: `${title} Table`,
    rowSpec: {
      entityPredicate: 'shift',
      entityIdPrefix: 'shift',
      order: 'entity-fact-order',
    },
    columns: [
      {
        id: 'shift',
        header: 'Shift',
        cellType: 'text',
        read: { kind: 'derived', derive: 'row-id' },
      },
      {
        id: 'ward',
        header: 'Ward',
        cellType: 'text',
        read: { kind: 'fact-arg', pred: 'ward', arg: 1 },
        write: { kind: 'set-fact-arg', pred: 'ward', arg: 1, deleteWhenBlank: true },
      },
      {
        id: 'night',
        header: 'Night',
        cellType: 'boolean',
        read: { kind: 'fact-presence', pred: 'night_shift' },
        write: { kind: 'set-fact-presence', pred: 'night_shift' },
      },
      {
        id: 'hours',
        header: 'Hours',
        cellType: 'number',
        read: { kind: 'fact-arg', pred: 'shift_hours', arg: 1 },
        write: { kind: 'set-fact-arg', pred: 'shift_hours', arg: 1, deleteWhenBlank: true },
      },
      ...Array.from({ length: staffSlots }, (_, index) => ({
        id: `staff-${index + 1}`,
        header: `Staff ${index + 1}`,
        cellType: 'entity' as const,
        read: {
          kind: 'slot-value' as const,
          pred: 'assignment_slot',
          slot: index + 1,
          valueArg: 2,
        },
        write: {
          kind: 'set-slot-value' as const,
          pred: 'assignment_slot',
          slot: index + 1,
          valueArg: 2,
          deleteWhenBlank: true,
        },
      })),
      {
        id: 'in-charge',
        header: 'In Charge',
        cellType: 'entity',
        read: { kind: 'fact-arg', pred: 'in_charge', arg: 1 },
        write: { kind: 'set-fact-arg', pred: 'in_charge', arg: 1, deleteWhenBlank: true },
      },
      {
        id: 'patients',
        header: 'Patients',
        cellType: 'number',
        read: { kind: 'fact-arg', pred: 'patients', arg: 1 },
        write: { kind: 'set-fact-arg', pred: 'patients', arg: 1, deleteWhenBlank: true },
      },
      {
        id: 'has-hca',
        header: 'Has HCA',
        cellType: 'boolean',
        read: { kind: 'fact-presence', pred: 'has_hca' },
        write: { kind: 'set-fact-presence', pred: 'has_hca' },
      },
    ],
    script: HOSPITAL_ROTA_PROJECTION_SCRIPT,
  };
}

export function normalizeHospitalLegacySolutionFacts(facts: StoredFact[]): StoredFact[] {
  const nextFacts: StoredFact[] = [];
  const seenShiftHours = new Set<string>();

  for (const fact of facts) {
    if (
      [
        'shift',
        'ward',
        'night_shift',
        'assignment_slot',
        'in_charge',
        'patients',
        'has_hca',
      ].includes(fact.pred)
    ) {
      nextFacts.push({ ...fact, args: [...fact.args] });
      continue;
    }

    if (fact.pred === 'assigned') {
      const rowId = String(fact.args[0] ?? '');
      if (!rowId || seenShiftHours.has(rowId)) continue;
      seenShiftHours.add(rowId);
      nextFacts.push({
        pred: 'shift_hours',
        args: [rowId, Number(fact.args[2] ?? 0)],
      });
    }
  }

  return nextFacts;
}

const HOSPITAL_ROTA_PROJECTION_SCRIPT = `
function expandForVerification({ defaultExpanded, projectionDoc, helpers }) {
  const baseFacts = helpers.cloneFacts(defaultExpanded.facts);
  const provenanceEntries = (defaultExpanded.provenanceEntries || []).map((entry) =>
    helpers.provenanceEntry(entry.fact, entry.anchors),
  );
  const derivedFacts = [];
  const wardHours = new Map();
  const employeeHours = new Map();
  const wardRows = new Map();
  const employeeRows = new Map();
  const rowIds = helpers.getRowIds(projectionDoc, baseFacts);
  const hoursColumnId =
    projectionDoc.columns.find(
      (column) => column.read.kind === 'fact-arg' && column.read.pred === 'shift_hours',
    )?.id || null;

  function addProvenance(fact, anchors) {
    provenanceEntries.push(helpers.provenanceEntry(fact, anchors));
  }

  for (const rowId of rowIds) {
    const ward = helpers.findFactArg(baseFacts, 'ward', rowId, 1) || '';
    const hoursValue = helpers.findFactArg(baseFacts, 'shift_hours', rowId, 1);
    const parsedHours = hoursValue == null || hoursValue === '' ? 0 : Number(hoursValue);
    const hours = Number.isFinite(parsedHours) ? parsedHours : 0;
    const assignments = projectionDoc.columns
      .filter((column) => column.read.kind === 'slot-value' && column.read.pred === 'assignment_slot')
      .map((column) => ({
        columnId: column.id,
        person: helpers.findSlotValue(
          baseFacts,
          rowId,
          column.read.pred,
          column.read.slot,
          column.read.valueArg,
        ) || '',
      }))
      .filter((assignment) => Boolean(assignment.person));

    if (ward) {
      if (!wardRows.has(ward)) wardRows.set(ward, new Set());
      wardRows.get(ward).add(rowId);
    }

    for (const assignment of assignments) {
      const assignedFact = helpers.makeFact('assigned', rowId, assignment.person, hours);
      derivedFacts.push(assignedFact);
      const anchors = [{ rowId, columnId: assignment.columnId }];
      if (hoursColumnId) anchors.push({ rowId, columnId: hoursColumnId });
      addProvenance(assignedFact, anchors);

      employeeHours.set(assignment.person, (employeeHours.get(assignment.person) || 0) + hours);
      if (!employeeRows.has(assignment.person)) employeeRows.set(assignment.person, new Set());
      employeeRows.get(assignment.person).add(rowId);
    }

    if (ward) {
      wardHours.set(ward, (wardHours.get(ward) || 0) + assignments.length * hours);
    }
  }

  for (const [ward, rowSet] of wardRows.entries()) {
    const rowIdsForWard = [...rowSet];
    const wardRosterFact = helpers.makeFact('ward_roster', ward);
    derivedFacts.push(wardRosterFact);
    addProvenance(
      wardRosterFact,
      rowIdsForWard.map((rowId) => ({ rowId })),
    );

    const rosteredHoursFact = helpers.makeFact('rostered_hours', ward, wardHours.get(ward) || 0);
    derivedFacts.push(rosteredHoursFact);
    addProvenance(
      rosteredHoursFact,
      rowIdsForWard.map((rowId) => ({ rowId })),
    );
  }

  for (const [employee, totalHours] of [...employeeHours.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const employeeFact = helpers.makeFact('employee_rostered_hours', employee, totalHours);
    derivedFacts.push(employeeFact);
    addProvenance(
      employeeFact,
      [...(employeeRows.get(employee) || new Set())].map((rowId) => ({ rowId })),
    );
  }

  return {
    title: defaultExpanded.title,
    facts: [...baseFacts, ...derivedFacts],
    draftText: helpers.buildExpandedArtifactDraft(
      defaultExpanded.title || 'Artifact',
      baseFacts,
      derivedFacts,
    ),
    provenanceEntries,
  };
}

module.exports = {
  expandForVerification,
};
`;
