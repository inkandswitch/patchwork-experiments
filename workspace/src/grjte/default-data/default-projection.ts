import type { ProjectionSpecDoc } from '../../../../grjte-workflow-tools/src/artifact-projection/artifact-projection';
import type { DatalogDoc } from '../../../../grjte-workflow-tools/src/spec/types';

type StoredFact = DatalogDoc['facts'][number];

export function buildHospitalRotaProjectionSpec(
  title: string,
  staffSlots = 5,
): ProjectionSpecDoc {
  return {
    '@patchwork': { type: 'artifact-projection' },
    schemaVersion: 3,
    sourceType: 'datalog',
    title: `${title} Table`,
    rows: {
      entityPredicate: 'shift',
      keyArg: 0,
      entityIdPrefix: 'shift',
      order: 'entity-fact-order',
      create: { insertEntityFact: true },
      delete: { mode: 'managed-predicates-only' },
    },
    columns: [
      {
        id: 'shift',
        header: 'Shift',
        cellType: 'text',
        read: { kind: 'derived-row-key' },
        cardinality: 'exactly-one',
        readOnlyReason: 'The row key is derived from the shift fact.',
      },
      {
        id: 'ward',
        header: 'Ward',
        cellType: 'text',
        read: { kind: 'fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 },
        write: { kind: 'upsert-fact-arg', pred: 'ward', rowKeyArg: 0, valueArg: 1 },
        cardinality: 'zero-or-one',
        blankPolicy: 'delete',
      },
      {
        id: 'night',
        header: 'Night',
        cellType: 'boolean',
        read: { kind: 'fact-presence', pred: 'night_shift', rowKeyArg: 0 },
        write: { kind: 'set-fact-presence', pred: 'night_shift', rowKeyArg: 0 },
        cardinality: 'zero-or-one',
      },
      {
        id: 'hours',
        header: 'Hours',
        cellType: 'number',
        read: { kind: 'fact-arg', pred: 'shift_hours', rowKeyArg: 0, valueArg: 1 },
        write: { kind: 'upsert-fact-arg', pred: 'shift_hours', rowKeyArg: 0, valueArg: 1 },
        cardinality: 'zero-or-one',
        blankPolicy: 'delete',
      },
      ...Array.from({ length: staffSlots }, (_, index) => ({
        id: `staff-${index + 1}`,
        header: `Staff ${index + 1}`,
        cellType: 'entity' as const,
        read: {
          kind: 'slot-value' as const,
          pred: 'assignment_slot',
          rowKeyArg: 0,
          slotArg: 1,
          slot: index + 1,
          valueArg: 2,
        },
        write: {
          kind: 'upsert-slot-value' as const,
          pred: 'assignment_slot',
          rowKeyArg: 0,
          slotArg: 1,
          slot: index + 1,
          valueArg: 2,
        },
        cardinality: 'zero-or-one' as const,
        blankPolicy: 'delete' as const,
      })),
      {
        id: 'in-charge',
        header: 'In Charge',
        cellType: 'entity',
        read: { kind: 'fact-arg', pred: 'in_charge', rowKeyArg: 0, valueArg: 1 },
        write: { kind: 'upsert-fact-arg', pred: 'in_charge', rowKeyArg: 0, valueArg: 1 },
        cardinality: 'zero-or-one',
        blankPolicy: 'delete',
      },
      {
        id: 'patients',
        header: 'Patients',
        cellType: 'number',
        read: { kind: 'fact-arg', pred: 'patients', rowKeyArg: 0, valueArg: 1 },
        write: { kind: 'upsert-fact-arg', pred: 'patients', rowKeyArg: 0, valueArg: 1 },
        cardinality: 'zero-or-one',
        blankPolicy: 'delete',
      },
      {
        id: 'has-hca',
        header: 'Has HCA',
        cellType: 'boolean',
        read: { kind: 'fact-presence', pred: 'has_hca', rowKeyArg: 0 },
        write: { kind: 'set-fact-presence', pred: 'has_hca', rowKeyArg: 0 },
        cardinality: 'zero-or-one',
      },
    ],
    verification: {
      expandScript: HOSPITAL_ROTA_EXPAND_SCRIPT,
    },
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

export const HOSPITAL_ROTA_EXPAND_SCRIPT = `
const { defaultExpanded, projectionDoc, helpers } = ctx;
{
  const baseFacts = helpers.cloneFacts(defaultExpanded.facts);
  const provenanceEntries = (defaultExpanded.provenanceEntries || []).map((entry) =>
    helpers.provenanceEntry(entry.fact, entry.anchors),
  );
  const derivedFacts = [];
  const wardHours = new Map();
  const employeeHours = new Map();
  const wardRows = new Map();
  const employeeCells = new Map();
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
      if (!employeeCells.has(assignment.person)) employeeCells.set(assignment.person, []);
      employeeCells.get(assignment.person).push({ rowId, columnId: assignment.columnId });
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
      employeeCells.get(employee) || [],
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
`;

export function buildPostgresConfigProjectionSpec(
  title: string,
): ProjectionSpecDoc {
  return {
    '@patchwork': { type: 'artifact-projection' },
    schemaVersion: 3,
    sourceType: 'datalog',
    viewKind: 'key-value',
    title: `${title} Config`,
    entries: [
      {
        id: 'max-connections',
        label: 'max_connections',
        cellType: 'number',
        read: { kind: 'singleton-fact-arg', pred: 'max_connections', valueArg: 0 },
        readOnlyReason: 'Derived from capacity planning facts.',
      },
      {
        id: 'shared-buffers',
        label: 'shared_buffers',
        cellType: 'text',
        read: { kind: 'singleton-fact-arg', pred: 'shared_buffers', valueArg: 0 },
        readOnlyReason: 'Derived from the selected instance size.',
      },
      {
        id: 'work-mem',
        label: 'work_mem',
        cellType: 'text',
        read: { kind: 'singleton-fact-arg', pred: 'work_mem', valueArg: 0 },
        readOnlyReason: 'Derived from the selected instance size.',
      },
    ],
    view: {
      expandScript: POSTGRES_CONFIG_VIEW_EXPAND_SCRIPT,
    },
    verification: {},
  };
}

export const POSTGRES_CONFIG_VIEW_EXPAND_SCRIPT = `
const { defaultExpanded, helpers } = ctx;
{
  const baseFacts = helpers.cloneFacts(defaultExpanded.facts);
  const provenanceEntries = (defaultExpanded.provenanceEntries || []).map((entry) =>
    helpers.provenanceEntry(entry.fact, entry.anchors),
  );
  const derivedFacts = [];

  const serviceTier =
    baseFacts.find((fact) => fact.pred === 'service' && String(fact.args[0] ?? '') === 'postgres')
      ?.args[1] ?? '';
  const instanceFact = baseFacts.find(
    (fact) => fact.pred === 'instance' && String(fact.args[0] ?? '') === String(serviceTier),
  );
  const peakConnectionsFact = baseFacts.find(
    (fact) => fact.pred === 'peak_concurrent_db_connections',
  );

  const cores = Number(instanceFact?.args[1] ?? 0);
  const memoryMb = Number(instanceFact?.args[2] ?? 0);
  const peakConnections = Number(peakConnectionsFact?.args[0] ?? 0);

  if (Number.isFinite(peakConnections) && peakConnections > 0) {
    derivedFacts.push(helpers.makeFact('max_connections', peakConnections));
    if (peakConnectionsFact) {
      provenanceEntries.push(
        helpers.provenanceEntry(
          helpers.makeFact('max_connections', peakConnections),
          [{ kind: 'key-value-entry', entryId: 'max-connections' }],
        ),
      );
    }
  }

  if (Number.isFinite(memoryMb) && memoryMb > 0) {
    const sharedBuffersMb = Math.max(128, Math.floor(memoryMb / 4));
    derivedFacts.push(helpers.makeFact('shared_buffers', sharedBuffersMb + 'MB'));
    if (instanceFact) {
      provenanceEntries.push(
        helpers.provenanceEntry(
          helpers.makeFact('shared_buffers', sharedBuffersMb + 'MB'),
          [{ kind: 'key-value-entry', entryId: 'shared-buffers' }],
        ),
      );
    }
  }

  if (Number.isFinite(cores) && cores > 0) {
    derivedFacts.push(helpers.makeFact('work_mem', cores + 'MB'));
    if (instanceFact) {
      provenanceEntries.push(
        helpers.provenanceEntry(
          helpers.makeFact('work_mem', cores + 'MB'),
          [{ kind: 'key-value-entry', entryId: 'work-mem' }],
        ),
      );
    }
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
`;
