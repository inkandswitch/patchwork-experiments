import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { DatalogDoc, VerificationConstraintResult } from './verification/model';
import type { ConstraintViolation } from './verification/datalog-eval';

type StoredFact = DatalogDoc['facts'][number];

export type FactArgRead = {
  kind: 'fact-arg';
  pred: string;
  arg: number;
};

export type FactPresenceRead = {
  kind: 'fact-presence';
  pred: string;
  trueValue?: string;
  falseValue?: string;
};

export type SlotValueRead = {
  kind: 'slot-value';
  pred: string;
  slot: number;
  valueArg: number;
};

export type DerivedRead = {
  kind: 'derived';
  derive: 'row-id';
};

export type ProjectionReadBinding = FactArgRead | FactPresenceRead | SlotValueRead | DerivedRead;

export type SetFactArgWrite = {
  kind: 'set-fact-arg';
  pred: string;
  arg: number;
  deleteWhenBlank?: boolean;
};

export type SetFactPresenceWrite = {
  kind: 'set-fact-presence';
  pred: string;
};

export type SetSlotValueWrite = {
  kind: 'set-slot-value';
  pred: string;
  slot: number;
  valueArg: number;
  deleteWhenBlank?: boolean;
};

export type SetAllMatchingArgWrite = {
  kind: 'set-all-matching-arg';
  pred: string;
  matchArg: number;
  valueArg: number;
  deleteWhenBlank?: boolean;
};

export type ProjectionWriteBinding =
  | SetFactArgWrite
  | SetFactPresenceWrite
  | SetSlotValueWrite
  | SetAllMatchingArgWrite;

export type ProjectionColumn = {
  id: string;
  header: string;
  hidden?: boolean;
  cellType: 'text' | 'number' | 'boolean' | 'entity';
  read: ProjectionReadBinding;
  write?: ProjectionWriteBinding;
};

export type ProjectionDoc = {
  '@patchwork': { type: 'artifact-projection' };
  artifactDocUrl: AutomergeUrl;
  sourceType: 'datalog';
  title?: string;
  rowSpec: {
    entityPredicate: string;
    entityIdPrefix: string;
    order: 'entity-fact-order';
  };
  columns: ProjectionColumn[];
};

export type ArtifactFolderEntry = {
  type: string;
  name: string;
  url: AutomergeUrl;
  projectionDocUrl?: AutomergeUrl;
  specPath?: string;
};

export type ArtifactSheetAnnotationKind = 'cell' | 'row' | 'column' | 'sheet';
export type ArtifactSheetAnnotationSource = 'parse' | 'constraint';

export type ArtifactSheetAnnotation = {
  artifactUrl?: AutomergeUrl;
  kind: ArtifactSheetAnnotationKind;
  rowId?: string;
  columnId?: string;
  message: string;
  constraintLabel?: string;
  source: ArtifactSheetAnnotationSource;
};

export type MaterializedProjectionColumn = ProjectionColumn & {
  visibleIndex: number;
};

export type MaterializedProjectionRow = {
  rowId: string;
  cells: Array<{
    columnId: string;
    value: string;
    editable: boolean;
  }>;
};

export type MaterializedProjection = {
  title: string;
  columns: MaterializedProjectionColumn[];
  hiddenColumns: ProjectionColumn[];
  rows: MaterializedProjectionRow[];
};

export type SheetAnchor = {
  rowId?: string;
  columnId?: string;
};

export type ExpandedArtifactDoc = Pick<DatalogDoc, 'title' | 'facts' | 'draftText'> & {
  provenanceByFactKey: Map<string, SheetAnchor[]>;
};

type MutationSuccess = {
  ok: true;
  doc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
};

type MutationFailure = {
  ok: false;
  error: string;
  annotations: ArtifactSheetAnnotation[];
};

const DEFAULT_TRUE_VALUE = 'yes';
const DEFAULT_FALSE_VALUE = 'no';

export function createProjectionDoc(repo: Repo, projectionDoc: ProjectionDoc): AutomergeUrl {
  const handle = repo.create<ProjectionDoc>();
  handle.change((doc) => {
    doc['@patchwork'] = { type: 'artifact-projection' };
    doc.artifactDocUrl = projectionDoc.artifactDocUrl;
    doc.sourceType = projectionDoc.sourceType;
    doc.title = projectionDoc.title;
    doc.rowSpec = { ...projectionDoc.rowSpec };
    doc.columns = projectionDoc.columns.map((column) => ({ ...column }));
  });
  return handle.url;
}

export function buildDefaultRotaProjection(
  artifactDocUrl: AutomergeUrl,
  title: string,
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
      ...Array.from({ length: 5 }, (_, index) => ({
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
  };
}

export function materializeProjection(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts'>,
): MaterializedProjection {
  const visibleColumns = projectionDoc.columns.filter((column) => !column.hidden);
  const rows = getRowIds(projectionDoc, artifactDoc.facts).map((rowId) => ({
    rowId,
    cells: visibleColumns.map((column) => ({
      columnId: column.id,
      value: readCellValue(column, rowId, artifactDoc.facts),
      editable: Boolean(column.write),
    })),
  }));

  return {
    title: projectionDoc.title || artifactDoc.title || 'Artifact Sheet',
    columns: visibleColumns.map((column, visibleIndex) => ({ ...column, visibleIndex })),
    hiddenColumns: projectionDoc.columns.filter((column) => column.hidden),
    rows,
  };
}

export function normalizeLegacySolutionFacts(
  facts: StoredFact[],
): StoredFact[] {
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
      nextFacts.push(f('shift_hours', rowId, Number(fact.args[2] ?? 0)));
    }
  }

  return nextFacts;
}

export function appendProjectionRow(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts'>,
): MutationSuccess {
  const nextFacts = cloneFacts(priorDoc.facts);
  const rowId = generateRowId(projectionDoc, nextFacts);
  nextFacts.push(f(projectionDoc.rowSpec.entityPredicate, rowId));
  return {
    ok: true,
    doc: {
      title: priorDoc.title,
      facts: nextFacts,
      draftText: buildBaseArtifactDraft(priorDoc.title || 'Artifact', nextFacts),
    },
  };
}

export function deleteProjectionRow(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts'>,
  rowId: string,
  artifactUrl?: AutomergeUrl,
): MutationSuccess | MutationFailure {
  const managedPredicates = getManagedPredicates(projectionDoc);
  const nextFacts = cloneFacts(priorDoc.facts).filter(
    (fact) => !(String(fact.args[0]) === rowId && managedPredicates.has(fact.pred)),
  );

  const remainingRowFacts = nextFacts.filter((fact) => String(fact.args[0]) === rowId);
  if (remainingRowFacts.length > 0) {
    return {
      ok: false,
      error: `Cannot delete row "${rowId}" because non-editable facts still reference it.`,
      annotations: [
        {
          artifactUrl,
          kind: 'row',
          rowId,
          message: `Cannot delete row "${rowId}" because non-editable facts still reference it.`,
          source: 'parse',
        },
      ],
    };
  }

  return {
    ok: true,
    doc: {
      title: priorDoc.title,
      facts: nextFacts,
      draftText: buildBaseArtifactDraft(priorDoc.title || 'Artifact', nextFacts),
    },
  };
}

export function applyProjectionCellEdit(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts'>,
  rowId: string,
  columnId: string,
  rawValue: string,
  artifactUrl?: AutomergeUrl,
): MutationSuccess | MutationFailure {
  const column = projectionDoc.columns.find((entry) => entry.id === columnId);
  if (!column) {
    return {
      ok: false,
      error: `Unknown column "${columnId}".`,
      annotations: [
        {
          artifactUrl,
          kind: 'sheet',
          message: `Unknown column "${columnId}".`,
          source: 'parse',
        },
      ],
    };
  }
  if (!column.write) {
    return {
      ok: false,
      error: `Column "${column.header}" is read-only.`,
      annotations: [
        {
          artifactUrl,
          kind: 'cell',
          rowId,
          columnId,
          message: `Column "${column.header}" is read-only.`,
          source: 'parse',
        },
      ],
    };
  }

  const nextFacts = cloneFacts(priorDoc.facts);
  const normalized = normalizeInput(rawValue);

  const write = column.write;

  switch (write.kind) {
    case 'set-fact-arg': {
      const parsed = parseValueForColumn(column, normalized);
      if (typeof parsed === 'string') {
        return mutationError(artifactUrl, rowId, columnId, parsed);
      }
      if (parsed == null && write.deleteWhenBlank) {
        removeFacts(nextFacts, (fact) => fact.pred === write.pred && String(fact.args[0]) === rowId);
      } else if (parsed != null) {
        upsertRowFact(nextFacts, rowId, write.pred, write.arg, parsed);
      }
      break;
    }
    case 'set-fact-presence': {
      const parsed = parseBooleanValue(normalized);
      if (parsed == null) {
        return mutationError(
          artifactUrl,
          rowId,
          columnId,
          `Expected a boolean value for "${column.header}". Use yes/no, true/false, or 1/0.`,
        );
      }
      if (parsed) ensurePresenceFact(nextFacts, rowId, write.pred);
      else removeFacts(nextFacts, (fact) => fact.pred === write.pred && String(fact.args[0]) === rowId);
      break;
    }
    case 'set-slot-value': {
      if (!normalized && write.deleteWhenBlank) {
        removeFacts(
          nextFacts,
          (fact) =>
            fact.pred === write.pred &&
            String(fact.args[0]) === rowId &&
            Number(fact.args[1]) === write.slot,
        );
      } else {
        upsertSlotFact(
          nextFacts,
          rowId,
          write.pred,
          write.slot,
          write.valueArg,
          normalized,
        );
      }
      break;
    }
    case 'set-all-matching-arg': {
      const parsed = parseValueForColumn(column, normalized);
      if (typeof parsed === 'string') {
        return mutationError(artifactUrl, rowId, columnId, parsed);
      }
      const matches = nextFacts.filter(
        (fact) => fact.pred === write.pred && String(fact.args[0]) === rowId,
      );
      if (matches.length === 0 && parsed != null) {
        const args: (string | number)[] = [rowId];
        args[write.matchArg] = rowId;
        args[write.valueArg] = parsed;
        nextFacts.push({ pred: write.pred, args });
      } else {
        for (const fact of matches) {
          if (parsed == null && write.deleteWhenBlank) {
            removeFacts(nextFacts, (entry) => entry === fact);
          } else if (parsed != null) {
            fact.args[write.valueArg] = parsed;
          }
        }
      }
      break;
    }
    default: {
      const exhaustiveCheck: never = write;
      throw new Error(`Unsupported write binding: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }

  return {
    ok: true,
    doc: {
      title: priorDoc.title,
      facts: nextFacts,
      draftText: buildBaseArtifactDraft(priorDoc.title || 'Artifact', nextFacts),
    },
  };
}

export function expandArtifactDocForVerification(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts'>,
): ExpandedArtifactDoc {
  const baseFacts = cloneFacts(artifactDoc.facts);
  const provenanceByFactKey = new Map<string, SheetAnchor[]>();
  const rows = getExpandedRows(projectionDoc, baseFacts);
  const derivedFacts: StoredFact[] = [];

  for (const fact of baseFacts) {
    addProvenance(provenanceByFactKey, fact, anchorsForPersistedFact(projectionDoc, fact));
  }

  const wardHours = new Map<string, number>();
  const employeeHours = new Map<string, number>();
  const wardRows = new Map<string, Set<string>>();
  const employeeRows = new Map<string, Set<string>>();

  for (const row of rows) {
    const hours = row.hours ?? 0;
    if (row.ward) {
      if (!wardRows.has(row.ward)) wardRows.set(row.ward, new Set());
      wardRows.get(row.ward)!.add(row.rowId);
    }

    for (const assignment of row.assignments) {
      const assignedFact = f('assigned', row.rowId, assignment.person, hours);
      derivedFacts.push(assignedFact);
      addProvenance(provenanceByFactKey, assignedFact, [
        { rowId: row.rowId, columnId: assignment.columnId },
        { rowId: row.rowId, columnId: findColumnIdByPredicate(projectionDoc, 'shift_hours') || undefined },
      ]);

      employeeHours.set(assignment.person, (employeeHours.get(assignment.person) ?? 0) + hours);
      if (!employeeRows.has(assignment.person)) employeeRows.set(assignment.person, new Set());
      employeeRows.get(assignment.person)!.add(row.rowId);
    }

    if (row.ward) {
      wardHours.set(row.ward, (wardHours.get(row.ward) ?? 0) + row.assignments.length * hours);
    }
  }

  for (const [ward, rowIds] of wardRows.entries()) {
    const wardRosterFact = f('ward_roster', ward);
    derivedFacts.push(wardRosterFact);
    addProvenance(
      provenanceByFactKey,
      wardRosterFact,
      [...rowIds].map((rowId) => ({ rowId })),
    );

    const rosteredHoursFact = f('rostered_hours', ward, wardHours.get(ward) ?? 0);
    derivedFacts.push(rosteredHoursFact);
    addProvenance(
      provenanceByFactKey,
      rosteredHoursFact,
      [...rowIds].map((rowId) => ({ rowId })),
    );
  }

  for (const [employee, totalHours] of [...employeeHours.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const employeeFact = f('employee_rostered_hours', employee, totalHours);
    derivedFacts.push(employeeFact);
    addProvenance(
      provenanceByFactKey,
      employeeFact,
      [...(employeeRows.get(employee) ?? new Set<string>())].map((rowId) => ({ rowId })),
    );
  }

  const facts = [...baseFacts, ...derivedFacts];
  return {
    title: artifactDoc.title,
    facts,
    draftText: buildExpandedArtifactDraft(artifactDoc.title || 'Artifact', baseFacts, derivedFacts),
    provenanceByFactKey,
  };
}

export function deriveConstraintAnnotationsForArtifact(
  artifactUrl: AutomergeUrl,
  expandedArtifactDoc: ExpandedArtifactDoc,
  constraints: Array<{ constraintLabel: string; violations: ConstraintViolation[] } | VerificationConstraintResult>,
): ArtifactSheetAnnotation[] {
  const annotations: ArtifactSheetAnnotation[] = [];

  for (const constraint of constraints) {
    const constraintLabel =
      'constraintLabel' in constraint ? constraint.constraintLabel : constraint.label;
    for (const violation of constraint.violations) {
      annotations.push(
        ...mapViolationToAnnotations(
          artifactUrl,
          constraintLabel,
          violation,
          expandedArtifactDoc.provenanceByFactKey,
        ),
      );
    }
  }

  return dedupeAnnotations(annotations);
}

export function buildBaseArtifactDraft(
  title: string,
  facts: StoredFact[],
): string {
  const lines = [`% ${title}`];
  for (const fact of facts) {
    lines.push(serializeFact(fact));
  }
  return lines.join('\n');
}

function buildExpandedArtifactDraft(
  title: string,
  baseFacts: StoredFact[],
  derivedFacts: StoredFact[],
): string {
  const lines = [`% ${title}`];
  if (baseFacts.length > 0) {
    lines.push('% Base solution facts');
    lines.push(...baseFacts.map(serializeFact));
  }
  if (derivedFacts.length > 0) {
    if (baseFacts.length > 0) lines.push('');
    lines.push('% Derived facts used by verification');
    lines.push(...derivedFacts.map(serializeFact));
  }
  return lines.join('\n');
}

function getExpandedRows(
  projectionDoc: ProjectionDoc,
  facts: StoredFact[],
): Array<{
  rowId: string;
  ward: string;
  hours: number | null;
  assignments: Array<{ person: string; columnId: string }>;
}> {
  return getRowIds(projectionDoc, facts).map((rowId) => {
    const ward = findFactArg(facts, 'ward', rowId, 1) ?? '';
    const hoursValue = findFactArg(facts, 'shift_hours', rowId, 1);
    const parsedHours = hoursValue == null || hoursValue === '' ? null : Number(hoursValue);
    const assignments = projectionDoc.columns
      .filter((column): column is ProjectionColumn & { read: SlotValueRead } => column.read.kind === 'slot-value')
      .map((column) => ({
        columnId: column.id,
        slot: column.read.slot,
        person: findSlotValue(facts, rowId, column.read.pred, column.read.slot, column.read.valueArg) ?? '',
      }))
      .filter((assignment) => Boolean(assignment.person))
      .map(({ person, columnId }) => ({ person, columnId }));

    return {
      rowId,
      ward,
      hours: Number.isFinite(parsedHours) ? parsedHours : null,
      assignments,
    };
  });
}

function anchorsForPersistedFact(projectionDoc: ProjectionDoc, fact: StoredFact): SheetAnchor[] {
  const rowId = String(fact.args[0] ?? '');
  if (!rowId) return [];

  const anchors = projectionDoc.columns.flatMap((column) => {
    const read = column.read;
    if (read.kind === 'fact-arg' && read.pred === fact.pred) {
      return [{ rowId, columnId: column.id }];
    }
    if (read.kind === 'fact-presence' && read.pred === fact.pred) {
      return [{ rowId, columnId: column.id }];
    }
    if (
      read.kind === 'slot-value' &&
      read.pred === fact.pred &&
      Number(fact.args[1]) === read.slot
    ) {
      return [{ rowId, columnId: column.id }];
    }
    return [];
  });

  if (fact.pred === projectionDoc.rowSpec.entityPredicate) {
    return anchors.length > 0 ? anchors : [{ rowId }];
  }

  return anchors.length > 0 ? anchors : [{ rowId }];
}

function mapViolationToAnnotations(
  artifactUrl: AutomergeUrl,
  constraintLabel: string,
  violation: ConstraintViolation,
  provenanceByFactKey: Map<string, SheetAnchor[]>,
): ArtifactSheetAnnotation[] {
  const annotations: ArtifactSheetAnnotation[] = [];
  let touchedArtifact = false;

  for (const witness of violation.witnesses) {
    const rowAnchors = new Set<string>();
    const cellAnchors = new Set<string>();

    for (const step of witness.steps) {
      if (step.kind !== 'fact') continue;
      const anchors = resolveFactAnchors(step.fact, provenanceByFactKey, step.derivedBy?.groundBody);
      if (anchors.length === 0) continue;
      touchedArtifact = true;

      for (const anchor of anchors) {
        if (anchor.rowId) rowAnchors.add(anchor.rowId);
        if (anchor.rowId && anchor.columnId) {
          cellAnchors.add(JSON.stringify([anchor.rowId, anchor.columnId]));
        }
      }
    }

    if (cellAnchors.size > 0) {
      for (const key of cellAnchors) {
        const [rowId, columnId] = JSON.parse(key) as [string, string];
        annotations.push({
          artifactUrl,
          kind: 'cell',
          rowId,
          columnId,
          message: constraintLabel,
          constraintLabel,
          source: 'constraint',
        });
      }
      continue;
    }

    if (rowAnchors.size > 0) {
      for (const rowId of rowAnchors) {
        annotations.push({
          artifactUrl,
          kind: 'row',
          rowId,
          message: constraintLabel,
          constraintLabel,
          source: 'constraint',
        });
      }
    }
  }

  if (annotations.length === 0 && touchedArtifact) {
    annotations.push({
      artifactUrl,
      kind: 'sheet',
      message: constraintLabel,
      constraintLabel,
      source: 'constraint',
    });
  }

  return annotations;
}

function resolveFactAnchors(
  fact: StoredFact,
  provenanceByFactKey: Map<string, SheetAnchor[]>,
  groundBody?: StoredFact[],
) {
  const direct = provenanceByFactKey.get(factSignature(fact)) ?? [];
  if (direct.length > 0 || !groundBody || groundBody.length === 0) return direct;

  return groundBody.flatMap((entry) => provenanceByFactKey.get(factSignature(entry)) ?? []);
}

function getRowIds(projectionDoc: ProjectionDoc, facts: StoredFact[]) {
  return facts
    .filter((fact) => fact.pred === projectionDoc.rowSpec.entityPredicate)
    .map((fact) => String(fact.args[0]))
    .filter(Boolean);
}

function readCellValue(column: ProjectionColumn, rowId: string, facts: StoredFact[]): string {
  switch (column.read.kind) {
    case 'fact-arg':
      return findFactArg(facts, column.read.pred, rowId, column.read.arg) ?? '';
    case 'fact-presence':
      return hasFact(facts, column.read.pred, rowId)
        ? column.read.trueValue || DEFAULT_TRUE_VALUE
        : column.read.falseValue || DEFAULT_FALSE_VALUE;
    case 'slot-value':
      return findSlotValue(
        facts,
        rowId,
        column.read.pred,
        column.read.slot,
        column.read.valueArg,
      ) ?? '';
    case 'derived':
      if (column.read.derive === 'row-id') return rowId;
      return '';
    default: {
      const exhaustiveCheck: never = column.read;
      throw new Error(`Unsupported read binding: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function parseValueForColumn(column: ProjectionColumn, rawValue: string): string | number | null {
  if (!rawValue) return null;
  if (column.cellType === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return `Expected a number for "${column.header}" but found "${rawValue}".`;
    }
    return parsed;
  }
  if (column.cellType === 'boolean') {
    return `Column "${column.header}" uses a presence binding and should not be written as a scalar value.`;
  }
  return rawValue;
}

function mutationError(
  artifactUrl: AutomergeUrl | undefined,
  rowId: string,
  columnId: string,
  error: string,
): MutationFailure {
  return {
    ok: false,
    error,
    annotations: [
      {
        artifactUrl,
        kind: 'cell',
        rowId,
        columnId,
        message: error,
        source: 'parse',
      },
    ],
  };
}

function parseBooleanValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (['yes', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  return null;
}

function normalizeInput(value: string) {
  return value.trim();
}

function ensurePresenceFact(facts: StoredFact[], rowId: string, pred: string) {
  if (facts.some((fact) => fact.pred === pred && String(fact.args[0]) === rowId)) return;
  facts.push(f(pred, rowId));
}

function upsertRowFact(
  facts: StoredFact[],
  rowId: string,
  pred: string,
  arg: number,
  value: string | number | boolean,
) {
  const existing = facts.find((fact) => fact.pred === pred && String(fact.args[0]) === rowId);
  const nextValue = typeof value === 'boolean' ? Number(value) : value;
  if (existing) {
    existing.args[arg] = nextValue;
    return;
  }

  const args: (string | number)[] = Array.from({ length: arg + 1 }, () => '');
  args[0] = rowId;
  args[arg] = nextValue;
  facts.push({ pred, args });
}

function upsertSlotFact(
  facts: StoredFact[],
  rowId: string,
  pred: string,
  slot: number,
  valueArg: number,
  value: string,
) {
  const existing = facts.find(
    (fact) =>
      fact.pred === pred && String(fact.args[0]) === rowId && Number(fact.args[1]) === slot,
  );
  if (existing) {
    existing.args[valueArg] = value;
    return;
  }

  const args: (string | number)[] = Array.from({ length: Math.max(3, valueArg + 1) }, () => '');
  args[0] = rowId;
  args[1] = slot;
  args[valueArg] = value;
  facts.push({ pred, args });
}

function removeFacts(facts: StoredFact[], predicate: (fact: StoredFact) => boolean) {
  for (let index = facts.length - 1; index >= 0; index--) {
    if (predicate(facts[index])) facts.splice(index, 1);
  }
}

function getManagedPredicates(projectionDoc: ProjectionDoc) {
  const predicates = new Set<string>([projectionDoc.rowSpec.entityPredicate]);
  for (const column of projectionDoc.columns) {
    if (!column.write) continue;
    predicates.add(column.write.pred);
  }
  return predicates;
}

function generateRowId(projectionDoc: ProjectionDoc, facts: StoredFact[]) {
  const existing = new Set(
    facts
      .filter((fact) => fact.pred === projectionDoc.rowSpec.entityPredicate)
      .map((fact) => String(fact.args[0])),
  );

  let candidate = '';
  do {
    candidate = `${projectionDoc.rowSpec.entityIdPrefix}_${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.has(candidate));

  return candidate;
}

function findFactArg(
  facts: StoredFact[],
  pred: string,
  rowId: string,
  argIndex: number,
): string | undefined {
  const fact = facts.find((entry) => entry.pred === pred && String(entry.args[0]) === rowId);
  return fact ? String(fact.args[argIndex]) : undefined;
}

function findSlotValue(
  facts: StoredFact[],
  rowId: string,
  pred: string,
  slot: number,
  valueArg: number,
) {
  const fact = facts.find(
    (entry) =>
      entry.pred === pred &&
      String(entry.args[0]) === rowId &&
      Number(entry.args[1]) === slot,
  );
  return fact ? String(fact.args[valueArg]) : undefined;
}

function hasFact(facts: StoredFact[], pred: string, rowId: string) {
  return facts.some((fact) => fact.pred === pred && String(fact.args[0]) === rowId);
}

function cloneFacts(facts: StoredFact[]) {
  return facts.map((fact) => ({ ...fact, args: [...fact.args] }));
}

function addProvenance(
  provenanceByFactKey: Map<string, SheetAnchor[]>,
  fact: StoredFact,
  anchors: SheetAnchor[],
) {
  if (anchors.length === 0) return;
  const key = factSignature(fact);
  const existing = provenanceByFactKey.get(key) ?? [];
  provenanceByFactKey.set(key, [...existing, ...anchors]);
}

function findColumnIdByPredicate(projectionDoc: ProjectionDoc, pred: string) {
  return projectionDoc.columns.find((column) => {
    if (column.read.kind === 'fact-arg') return column.read.pred === pred;
    if (column.read.kind === 'fact-presence') return column.read.pred === pred;
    return false;
  })?.id;
}

function factSignature(fact: StoredFact) {
  return JSON.stringify([fact.pred, fact.args.map((arg) => String(arg))]);
}

function serializeFact(fact: StoredFact) {
  return `${fact.pred}(${fact.args.join(', ')}).`;
}

function dedupeAnnotations(annotations: ArtifactSheetAnnotation[]) {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    const key = JSON.stringify([
      annotation.kind,
      annotation.rowId ?? null,
      annotation.columnId ?? null,
      annotation.message,
      annotation.constraintLabel ?? null,
      annotation.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}
