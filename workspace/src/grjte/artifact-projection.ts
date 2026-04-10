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
  rowSpec?: {
    entityPredicate: string;
    entityIdPrefix: string;
    order: 'entity-fact-order';
  };
  columns: ProjectionColumn[];
  script?: string;
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
  annotations: ArtifactSheetAnnotation[];
};

export type SheetAnchor = {
  rowId?: string;
  columnId?: string;
};

export type ProjectionProvenanceEntry = {
  fact: StoredFact;
  anchors: SheetAnchor[];
};

export type ExpandedArtifactDoc = Pick<DatalogDoc, 'title' | 'facts' | 'draftText'> & {
  provenanceByFactKey: Map<string, SheetAnchor[]>;
  provenanceEntries: ProjectionProvenanceEntry[];
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

type MutationResult = MutationSuccess | MutationFailure;

type ProjectionRuntimeOptions = {
  projectionUrl?: AutomergeUrl;
};

type ScriptMaterializeContext = {
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  defaultMaterialized: MaterializedProjection;
  helpers: ProjectionScriptHelpers;
};

type ScriptMutationContext = {
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  artifactUrl?: AutomergeUrl;
  rowId: string;
  columnId: string;
  rawValue: string;
  defaultResult: MutationResult;
  helpers: ProjectionScriptHelpers;
};

type ScriptAppendRowContext = {
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  defaultResult: MutationResult;
  helpers: ProjectionScriptHelpers;
};

type ScriptDeleteRowContext = {
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  artifactUrl?: AutomergeUrl;
  rowId: string;
  defaultResult: MutationResult;
  helpers: ProjectionScriptHelpers;
};

type ScriptExpandedArtifactDoc = Pick<DatalogDoc, 'title' | 'facts' | 'draftText'> & {
  provenanceEntries?: ProjectionProvenanceEntry[];
};

type ScriptExpandContext = {
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  defaultExpanded: ScriptExpandedArtifactDoc;
  helpers: ProjectionScriptHelpers;
};

type ScriptMapViolationContext = {
  artifactUrl: AutomergeUrl;
  constraintLabel: string;
  violation: ConstraintViolation;
  expandedArtifactDoc: ScriptExpandedArtifactDoc;
  defaultAnnotations: ArtifactSheetAnnotation[];
  helpers: ProjectionScriptHelpers;
};

type ScriptValidationContext = {
  artifactDoc?: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;
  projectionDoc: ProjectionDoc;
  helpers: ProjectionScriptHelpers;
};

type ProjectionScriptHooks = Partial<{
  materialize: (ctx: ScriptMaterializeContext) => unknown;
  applyCellEdit: (ctx: ScriptMutationContext) => unknown;
  appendRow: (ctx: ScriptAppendRowContext) => unknown;
  deleteRow: (ctx: ScriptDeleteRowContext) => unknown;
  expandForVerification: (ctx: ScriptExpandContext) => unknown;
  mapViolation: (ctx: ScriptMapViolationContext) => unknown;
  validateProjection: (ctx: ScriptValidationContext) => unknown;
}>;

type ProjectionScriptHelpers = {
  cloneFacts: (facts: StoredFact[]) => StoredFact[];
  makeFact: (pred: string, ...args: (string | number)[]) => StoredFact;
  getRowIds: (projectionDoc: ProjectionDoc, facts: StoredFact[]) => string[];
  findFactArg: (
    facts: StoredFact[],
    pred: string,
    rowId: string,
    argIndex: number,
  ) => string | undefined;
  findSlotValue: (
    facts: StoredFact[],
    rowId: string,
    pred: string,
    slot: number,
    valueArg: number,
  ) => string | undefined;
  hasFact: (facts: StoredFact[], pred: string, rowId: string) => boolean;
  readCellValue: (column: ProjectionColumn, rowId: string, facts: StoredFact[]) => string;
  buildBaseArtifactDraft: (title: string, facts: StoredFact[]) => string;
  buildExpandedArtifactDraft: (
    title: string,
    baseFacts: StoredFact[],
    derivedFacts: StoredFact[],
  ) => string;
  buildBaseExpandedArtifact: (
    projectionDoc: ProjectionDoc,
    artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  ) => ScriptExpandedArtifactDoc;
  declarativeMaterialize: (
    projectionDoc: ProjectionDoc,
    artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  ) => MaterializedProjection;
  declarativeApplyCellEdit: (
    projectionDoc: ProjectionDoc,
    artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
    rowId: string,
    columnId: string,
    rawValue: string,
    artifactUrl?: AutomergeUrl,
  ) => MutationResult;
  declarativeAppendRow: (
    projectionDoc: ProjectionDoc,
    artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  ) => MutationResult;
  declarativeDeleteRow: (
    projectionDoc: ProjectionDoc,
    artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
    rowId: string,
    artifactUrl?: AutomergeUrl,
  ) => MutationResult;
  provenanceEntry: (fact: StoredFact, anchors: SheetAnchor[]) => ProjectionProvenanceEntry;
  resolveFactAnchors: (
    fact: StoredFact,
    provenanceEntries: ProjectionProvenanceEntry[],
    groundBody?: StoredFact[],
  ) => SheetAnchor[];
};

const DEFAULT_TRUE_VALUE = 'yes';
const DEFAULT_FALSE_VALUE = 'no';

const projectionScriptCache = new Map<string, ProjectionScriptHooks>();

const scriptHelpers: ProjectionScriptHelpers = {
  cloneFacts,
  makeFact: f,
  getRowIds: (projectionDoc, facts) => getRowIds(projectionDoc, facts),
  findFactArg,
  findSlotValue,
  hasFact,
  readCellValue,
  buildBaseArtifactDraft,
  buildExpandedArtifactDraft,
  buildBaseExpandedArtifact: (projectionDoc, artifactDoc) =>
    toScriptExpandedArtifact(buildBaseExpandedArtifactDoc(projectionDoc, artifactDoc)),
  declarativeMaterialize: (projectionDoc, artifactDoc) =>
    materializeProjectionDeclarative(projectionDoc, artifactDoc, []),
  declarativeApplyCellEdit: (
    projectionDoc,
    artifactDoc,
    rowId,
    columnId,
    rawValue,
    artifactUrl,
  ) =>
    applyProjectionCellEditDeclarative(
      projectionDoc,
      artifactDoc,
      rowId,
      columnId,
      rawValue,
      artifactUrl,
    ),
  declarativeAppendRow: (projectionDoc, artifactDoc) =>
    appendProjectionRowDeclarative(projectionDoc, artifactDoc),
  declarativeDeleteRow: (projectionDoc, artifactDoc, rowId, artifactUrl) =>
    deleteProjectionRowDeclarative(projectionDoc, artifactDoc, rowId, artifactUrl),
  provenanceEntry: (fact, anchors) => ({
    fact: cloneFact(fact),
    anchors: normalizeAnchors(anchors),
  }),
  resolveFactAnchors: (fact, provenanceEntries, groundBody) =>
    resolveFactAnchorsFromEntries(fact, provenanceEntries, groundBody),
};

export function createProjectionDoc(repo: Repo, projectionDoc: ProjectionDoc): AutomergeUrl {
  const handle = repo.create<ProjectionDoc>();
  handle.change((doc) => {
    doc['@patchwork'] = { type: 'artifact-projection' };
    doc.artifactDocUrl = projectionDoc.artifactDocUrl;
    doc.sourceType = projectionDoc.sourceType;
    doc.title = projectionDoc.title;
    doc.rowSpec = projectionDoc.rowSpec ? { ...projectionDoc.rowSpec } : undefined;
    doc.columns = projectionDoc.columns.map((column) => ({ ...column }));
    doc.script = projectionDoc.script ?? '';
  });
  return handle.url;
}

export function materializeProjection(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  options: ProjectionRuntimeOptions = {},
): MaterializedProjection {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const annotations = [
    ...getGenericProjectionAnnotations(projectionDoc, scriptState.hooks),
    ...scriptState.annotations,
    ...getScriptValidationAnnotations(scriptState.hooks, projectionDoc, artifactDoc),
  ];
  const fallback = materializeProjectionDeclarative(projectionDoc, artifactDoc, annotations);

  if (!scriptState.hooks?.materialize) return fallback;

  try {
    const raw = scriptState.hooks.materialize({
      artifactDoc: freezeDocLike(artifactDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      defaultMaterialized: freezeMaterializedProjection(fallback),
      helpers: scriptHelpers,
    });
    return normalizeScriptMaterialized(raw, fallback);
  } catch (error) {
    return {
      ...fallback,
      annotations: dedupeAnnotations([
        ...fallback.annotations,
        scriptRuntimeAnnotation(`Projection script failed during materialization: ${errorMessage(error)}`),
      ]),
    };
  }
}

export function appendProjectionRow(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const fallback = appendProjectionRowDeclarative(projectionDoc, priorDoc);

  if (!scriptState.hooks?.appendRow) return fallback;

  try {
    const raw = scriptState.hooks.appendRow({
      artifactDoc: freezeDocLike(priorDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      defaultResult: freezeMutationResult(fallback),
      helpers: scriptHelpers,
    });
    return normalizeScriptMutationResult(raw, fallback);
  } catch (error) {
    return {
      ok: false,
      error: `Projection script failed while adding a row: ${errorMessage(error)}`,
      annotations: [scriptRuntimeAnnotation(`Projection script failed while adding a row: ${errorMessage(error)}`)],
    };
  }
}

export function deleteProjectionRow(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  rowId: string,
  artifactUrl?: AutomergeUrl,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const fallback = deleteProjectionRowDeclarative(projectionDoc, priorDoc, rowId, artifactUrl);

  if (!scriptState.hooks?.deleteRow) return fallback;

  try {
    const raw = scriptState.hooks.deleteRow({
      artifactDoc: freezeDocLike(priorDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      artifactUrl,
      rowId,
      defaultResult: freezeMutationResult(fallback),
      helpers: scriptHelpers,
    });
    return normalizeScriptMutationResult(raw, fallback);
  } catch (error) {
    return {
      ok: false,
      error: `Projection script failed while deleting a row: ${errorMessage(error)}`,
      annotations: [scriptRuntimeAnnotation(`Projection script failed while deleting a row: ${errorMessage(error)}`, artifactUrl)],
    };
  }
}

export function applyProjectionCellEdit(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  rowId: string,
  columnId: string,
  rawValue: string,
  artifactUrl?: AutomergeUrl,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const fallback = applyProjectionCellEditDeclarative(
    projectionDoc,
    priorDoc,
    rowId,
    columnId,
    rawValue,
    artifactUrl,
  );

  if (!scriptState.hooks?.applyCellEdit) return fallback;

  try {
    const raw = scriptState.hooks.applyCellEdit({
      artifactDoc: freezeDocLike(priorDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      artifactUrl,
      rowId,
      columnId,
      rawValue,
      defaultResult: freezeMutationResult(fallback),
      helpers: scriptHelpers,
    });
    return normalizeScriptMutationResult(raw, fallback);
  } catch (error) {
    return {
      ok: false,
      error: `Projection script failed while editing a cell: ${errorMessage(error)}`,
      annotations: [
        {
          artifactUrl,
          kind: 'cell',
          rowId,
          columnId,
          message: `Projection script failed while editing a cell: ${errorMessage(error)}`,
          source: 'parse',
        },
      ],
    };
  }
}

export function expandArtifactDocForVerification(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  options: ProjectionRuntimeOptions = {},
): ExpandedArtifactDoc {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const fallback = buildBaseExpandedArtifactDoc(projectionDoc, artifactDoc);

  if (!scriptState.hooks?.expandForVerification) return fallback;

  try {
    const raw = scriptState.hooks.expandForVerification({
      artifactDoc: freezeDocLike(artifactDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      defaultExpanded: freezeScriptExpandedArtifactDoc(toScriptExpandedArtifact(fallback)),
      helpers: scriptHelpers,
    });
    return normalizeScriptExpandedArtifact(raw, fallback);
  } catch (error) {
    return {
      ...fallback,
      draftText: [
        fallback.draftText || buildBaseArtifactDraft(artifactDoc.title || 'Artifact', fallback.facts),
        '',
        `% Projection script error: ${errorMessage(error)}`,
      ].join('\n'),
    };
  }
}

export function deriveConstraintAnnotationsForArtifact(
  projectionDoc: ProjectionDoc,
  artifactUrl: AutomergeUrl,
  expandedArtifactDoc: ExpandedArtifactDoc,
  constraints:
    | Array<{ constraintLabel: string; violations: ConstraintViolation[] }>
    | VerificationConstraintResult[],
  options: ProjectionRuntimeOptions = {},
): ArtifactSheetAnnotation[] {
  const scriptState = loadProjectionScriptHooks(projectionDoc, options.projectionUrl);
  const annotations: ArtifactSheetAnnotation[] = [];
  const expandedForScript = toScriptExpandedArtifact(expandedArtifactDoc);

  for (const constraint of constraints) {
    const constraintLabel =
      'constraintLabel' in constraint ? constraint.constraintLabel : constraint.label;
    for (const violation of constraint.violations) {
      const fallback = mapViolationToAnnotations(
        artifactUrl,
        constraintLabel,
        violation,
        expandedArtifactDoc.provenanceByFactKey,
      );

      if (!scriptState.hooks?.mapViolation) {
        annotations.push(...fallback);
        continue;
      }

      try {
        const raw = scriptState.hooks.mapViolation({
          artifactUrl,
          constraintLabel,
          violation,
          expandedArtifactDoc: freezeScriptExpandedArtifactDoc(expandedForScript),
          defaultAnnotations: freezeAnnotations(fallback),
          helpers: scriptHelpers,
        });
        annotations.push(...normalizeScriptAnnotations(raw, 'constraint', artifactUrl, constraintLabel, fallback));
      } catch (error) {
        annotations.push(
          ...fallback,
          scriptRuntimeAnnotation(
            `Projection script failed while mapping a verification result: ${errorMessage(error)}`,
            artifactUrl,
            'constraint',
            constraintLabel,
          ),
        );
      }
    }
  }

  return dedupeAnnotations(annotations);
}

export function buildBaseArtifactDraft(title: string, facts: StoredFact[]): string {
  const lines = [`% ${title}`];
  for (const fact of facts) lines.push(serializeFact(fact));
  return lines.join('\n');
}

export function buildExpandedArtifactDraft(
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

function materializeProjectionDeclarative(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  annotations: ArtifactSheetAnnotation[],
): MaterializedProjection {
  const visibleColumns = projectionDoc.columns.filter((column) => !column.hidden);
  const rows = projectionDoc.rowSpec
    ? getRowIds(projectionDoc, artifactDoc.facts).map((rowId) => ({
        rowId,
        cells: visibleColumns.map((column) => ({
          columnId: column.id,
          value: readCellValue(column, rowId, artifactDoc.facts),
          editable: Boolean(column.write),
        })),
      }))
    : [];

  return {
    title: projectionDoc.title || artifactDoc.title || 'Artifact Sheet',
    columns: visibleColumns.map((column, visibleIndex) => ({ ...column, visibleIndex })),
    hiddenColumns: projectionDoc.columns.filter((column) => column.hidden),
    rows,
    annotations: dedupeAnnotations(annotations),
  };
}

function appendProjectionRowDeclarative(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
): MutationResult {
  if (!projectionDoc.rowSpec) {
    return {
      ok: false,
      error: 'Projection is missing rowSpec, so rows cannot be added declaratively.',
      annotations: [scriptRuntimeAnnotation('Projection is missing rowSpec, so rows cannot be added declaratively.')],
    };
  }

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

function deleteProjectionRowDeclarative(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  rowId: string,
  artifactUrl?: AutomergeUrl,
): MutationResult {
  if (!projectionDoc.rowSpec) {
    return {
      ok: false,
      error: 'Projection is missing rowSpec, so rows cannot be deleted declaratively.',
      annotations: [scriptRuntimeAnnotation('Projection is missing rowSpec, so rows cannot be deleted declaratively.', artifactUrl)],
    };
  }

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

function applyProjectionCellEditDeclarative(
  projectionDoc: ProjectionDoc,
  priorDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
  rowId: string,
  columnId: string,
  rawValue: string,
  artifactUrl?: AutomergeUrl,
): MutationResult {
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
      if (!parsed.ok) return mutationError(artifactUrl, rowId, columnId, parsed.error);
      if (parsed.value == null && write.deleteWhenBlank) {
        removeFacts(nextFacts, (fact) => fact.pred === write.pred && String(fact.args[0]) === rowId);
      } else if (parsed.value != null) {
        upsertRowFact(nextFacts, rowId, write.pred, write.arg, parsed.value);
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
        upsertSlotFact(nextFacts, rowId, write.pred, write.slot, write.valueArg, normalized);
      }
      break;
    }
    case 'set-all-matching-arg': {
      const parsed = parseValueForColumn(column, normalized);
      if (!parsed.ok) return mutationError(artifactUrl, rowId, columnId, parsed.error);
      const matches = nextFacts.filter(
        (fact) => fact.pred === write.pred && String(fact.args[0]) === rowId,
      );
      if (matches.length === 0 && parsed.value != null) {
        const args: (string | number)[] = [rowId];
        args[write.matchArg] = rowId;
        args[write.valueArg] = parsed.value;
        nextFacts.push({ pred: write.pred, args });
      } else {
        for (const fact of matches) {
          if (parsed.value == null && write.deleteWhenBlank) {
            removeFacts(nextFacts, (entry) => entry === fact);
          } else if (parsed.value != null) {
            fact.args[write.valueArg] = parsed.value;
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

function buildBaseExpandedArtifactDoc(
  projectionDoc: ProjectionDoc,
  artifactDoc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
): ExpandedArtifactDoc {
  const facts = cloneFacts(artifactDoc.facts);
  const provenanceEntries = facts.flatMap((fact) => {
    const anchors = anchorsForPersistedFact(projectionDoc, fact);
    return anchors.length > 0 ? [{ fact: cloneFact(fact), anchors }] : [];
  });

  return {
    title: artifactDoc.title,
    facts,
    draftText: buildBaseArtifactDraft(artifactDoc.title || 'Artifact', facts),
    provenanceEntries,
    provenanceByFactKey: provenanceEntriesToMap(provenanceEntries),
  };
}

function getGenericProjectionAnnotations(
  projectionDoc: ProjectionDoc,
  hooks?: ProjectionScriptHooks,
): ArtifactSheetAnnotation[] {
  const annotations: ArtifactSheetAnnotation[] = [];
  if (!projectionDoc.columns.length) {
    annotations.push({
      kind: 'sheet',
      message: 'Projection defines no columns.',
      source: 'parse',
    });
  }
  if (!projectionDoc.rowSpec && !hooks?.materialize) {
    annotations.push({
      kind: 'sheet',
      message: 'Projection is missing rowSpec and does not provide a script materialize hook.',
      source: 'parse',
    });
  }
  return annotations;
}

function getScriptValidationAnnotations(
  hooks: ProjectionScriptHooks | undefined,
  projectionDoc: ProjectionDoc,
  artifactDoc?: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
): ArtifactSheetAnnotation[] {
  if (!hooks?.validateProjection) return [];

  try {
    const raw = hooks.validateProjection({
      artifactDoc: artifactDoc ? freezeDocLike(artifactDoc) : undefined,
      projectionDoc: freezeProjectionDoc(projectionDoc),
      helpers: scriptHelpers,
    });
    return normalizeScriptAnnotations(raw, 'parse');
  } catch (error) {
    return [scriptRuntimeAnnotation(`Projection script failed during validation: ${errorMessage(error)}`)];
  }
}

function loadProjectionScriptHooks(
  projectionDoc: ProjectionDoc,
  projectionUrl?: AutomergeUrl,
): { hooks?: ProjectionScriptHooks; annotations: ArtifactSheetAnnotation[] } {
  const script = projectionDoc.script?.trim();
  if (!script) return { hooks: undefined, annotations: [] };

  const cacheKey = buildProjectionScriptCacheKey(projectionDoc, projectionUrl);
  const cached = projectionScriptCache.get(cacheKey);
  if (cached) return { hooks: cached, annotations: [] };

  try {
    const hooks = compileProjectionScript(script);
    projectionScriptCache.set(cacheKey, hooks);
    return { hooks, annotations: [] };
  } catch (error) {
    return {
      hooks: undefined,
      annotations: [scriptRuntimeAnnotation(`Projection script failed to compile: ${errorMessage(error)}`)],
    };
  }
}

function compileProjectionScript(script: string): ProjectionScriptHooks {
  const evaluator = new Function(
    'helpers',
    [
      '"use strict";',
      'const module = { exports: {} };',
      'const exports = module.exports;',
      script,
      'return module.exports;',
    ].join('\n'),
  ) as (helpers: ProjectionScriptHelpers) => unknown;

  const raw = evaluator(scriptHelpers);
  if (!raw || typeof raw !== 'object') {
    throw new Error('Projection script must return an object of hook functions.');
  }

  const hooks = raw as Record<string, unknown>;
  const validKeys = new Set([
    'materialize',
    'applyCellEdit',
    'appendRow',
    'deleteRow',
    'expandForVerification',
    'mapViolation',
    'validateProjection',
  ]);

  for (const [key, value] of Object.entries(hooks)) {
    if (!validKeys.has(key)) continue;
    if (value != null && typeof value !== 'function') {
      throw new Error(`Projection script export "${key}" must be a function.`);
    }
  }

  return hooks as ProjectionScriptHooks;
}

function buildProjectionScriptCacheKey(projectionDoc: ProjectionDoc, projectionUrl?: AutomergeUrl) {
  const script = projectionDoc.script ?? '';
  return projectionUrl ? `${projectionUrl}::${script}` : `inline::${script}`;
}

function normalizeScriptMaterialized(
  raw: unknown,
  fallback: MaterializedProjection,
): MaterializedProjection {
  if (!raw || typeof raw !== 'object') return fallback;

  const record = raw as Record<string, unknown>;
  const next: MaterializedProjection = {
    title: typeof record.title === 'string' ? record.title : fallback.title,
    columns: Array.isArray(record.columns)
      ? normalizeMaterializedColumns(record.columns)
      : cloneMaterializedColumns(fallback.columns),
    hiddenColumns: Array.isArray(record.hiddenColumns)
      ? normalizeProjectionColumns(record.hiddenColumns)
      : cloneProjectionColumns(fallback.hiddenColumns),
    rows: Array.isArray(record.rows)
      ? normalizeMaterializedRows(record.rows)
      : cloneMaterializedRows(fallback.rows),
    annotations: dedupeAnnotations([
      ...fallback.annotations,
      ...normalizeScriptAnnotations(record.annotations, 'parse'),
    ]),
  };

  return next;
}

function normalizeScriptMutationResult(raw: unknown, fallback: MutationResult): MutationResult {
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  if (record.ok === true) {
    const doc = normalizeDocLike(record.doc);
    if (!doc) return fallback;
    return { ok: true, doc };
  }
  if (record.ok === false) {
    return {
      ok: false,
      error: typeof record.error === 'string' ? record.error : 'Projection script rejected the edit.',
      annotations: normalizeScriptAnnotations(record.annotations, 'parse'),
    };
  }
  return fallback;
}

function normalizeScriptExpandedArtifact(
  raw: unknown,
  fallback: ExpandedArtifactDoc,
): ExpandedArtifactDoc {
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  const facts = normalizeFacts(record.facts);
  if (!facts) return fallback;

  const title =
    typeof record.title === 'string'
      ? record.title
      : fallback.title;
  const draftText =
    typeof record.draftText === 'string'
      ? record.draftText
      : buildBaseArtifactDraft(title || 'Artifact', facts);
  const provenanceEntries = Array.isArray(record.provenanceEntries)
    ? normalizeProvenanceEntries(record.provenanceEntries)
    : fallback.provenanceEntries;

  return {
    title,
    facts,
    draftText,
    provenanceEntries,
    provenanceByFactKey: provenanceEntriesToMap(provenanceEntries),
  };
}

function toScriptExpandedArtifact(expanded: ExpandedArtifactDoc): ScriptExpandedArtifactDoc {
  return {
    title: expanded.title,
    facts: cloneFacts(expanded.facts),
    draftText: expanded.draftText,
    provenanceEntries: expanded.provenanceEntries.map((entry) => ({
      fact: cloneFact(entry.fact),
      anchors: normalizeAnchors(entry.anchors),
    })),
  };
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

function resolveFactAnchorsFromEntries(
  fact: StoredFact,
  provenanceEntries: ProjectionProvenanceEntry[],
  groundBody?: StoredFact[],
) {
  return resolveFactAnchors(fact, provenanceEntriesToMap(provenanceEntries), groundBody);
}

function getRowIds(projectionDoc: ProjectionDoc, facts: StoredFact[]) {
  if (!projectionDoc.rowSpec) return [];
  return facts
    .filter((fact) => fact.pred === projectionDoc.rowSpec?.entityPredicate)
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

function parseValueForColumn(
  column: ProjectionColumn,
  rawValue: string,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  if (!rawValue) return { ok: true, value: null };
  if (column.cellType === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return {
        ok: false,
        error: `Expected a number for "${column.header}" but found "${rawValue}".`,
      };
    }
    return { ok: true, value: parsed };
  }
  if (column.cellType === 'boolean') {
    return {
      ok: false,
      error: `Column "${column.header}" uses a presence binding and should not be written as a scalar value.`,
    };
  }
  return { ok: true, value: rawValue };
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
  const predicates = new Set<string>();
  if (projectionDoc.rowSpec) predicates.add(projectionDoc.rowSpec.entityPredicate);
  for (const column of projectionDoc.columns) {
    if (!column.write) continue;
    predicates.add(column.write.pred);
  }
  return predicates;
}

function generateRowId(projectionDoc: ProjectionDoc, facts: StoredFact[]) {
  if (!projectionDoc.rowSpec) {
    throw new Error('Projection is missing rowSpec.');
  }
  const existing = new Set(
    facts
      .filter((fact) => fact.pred === projectionDoc.rowSpec?.entityPredicate)
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

  if (projectionDoc.rowSpec && fact.pred === projectionDoc.rowSpec.entityPredicate) {
    return anchors.length > 0 ? anchors : [{ rowId }];
  }

  return anchors.length > 0 ? anchors : [{ rowId }];
}

function cloneFact(fact: StoredFact): StoredFact {
  return { ...fact, args: [...fact.args] };
}

function cloneFacts(facts: StoredFact[]) {
  return facts.map((fact) => cloneFact(fact));
}

function cloneProjectionColumns(columns: ProjectionColumn[]) {
  return columns.map((column) => ({ ...column }));
}

function cloneMaterializedColumns(columns: MaterializedProjectionColumn[]) {
  return columns.map((column) => ({ ...column }));
}

function cloneMaterializedRows(rows: MaterializedProjectionRow[]) {
  return rows.map((row) => ({
    rowId: row.rowId,
    cells: row.cells.map((cell) => ({ ...cell })),
  }));
}

function provenanceEntriesToMap(entries: ProjectionProvenanceEntry[]) {
  const map = new Map<string, SheetAnchor[]>();
  for (const entry of entries) {
    const key = factSignature(entry.fact);
    const existing = map.get(key) ?? [];
    map.set(key, [...existing, ...normalizeAnchors(entry.anchors)]);
  }
  return map;
}

function factSignature(fact: StoredFact) {
  return JSON.stringify([fact.pred, fact.args.map((arg) => String(arg))]);
}

function normalizeFacts(raw: unknown): StoredFact[] | null {
  if (!Array.isArray(raw)) return null;
  const facts: StoredFact[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const fact = entry as Record<string, unknown>;
    if (typeof fact.pred !== 'string' || !Array.isArray(fact.args)) return null;
    facts.push({
      pred: fact.pred,
      args: fact.args.filter(
        (arg): arg is string | number => typeof arg === 'string' || typeof arg === 'number',
      ),
      comment: typeof fact.comment === 'string' ? fact.comment : undefined,
    });
  }
  return facts;
}

function normalizeProjectionColumns(raw: unknown[]): ProjectionColumn[] {
  const columns: ProjectionColumn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const column = entry as Partial<ProjectionColumn>;
    if (
      typeof column.id !== 'string' ||
      typeof column.header !== 'string' ||
      !column.read ||
      typeof column.read !== 'object' ||
      !column.cellType
    ) {
      continue;
    }
    columns.push({
      id: column.id,
      header: column.header,
      hidden: Boolean(column.hidden),
      cellType: column.cellType,
      read: column.read as ProjectionReadBinding,
      write: column.write as ProjectionWriteBinding | undefined,
    });
  }
  return columns.map((column, index) => ({ ...column, visibleIndex: index })) as MaterializedProjectionColumn[];
}

function normalizeMaterializedColumns(raw: unknown[]): MaterializedProjectionColumn[] {
  return normalizeProjectionColumns(raw) as MaterializedProjectionColumn[];
}

function normalizeMaterializedRows(raw: unknown[]): MaterializedProjectionRow[] {
  const rows: MaterializedProjectionRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.rowId !== 'string' || !Array.isArray(row.cells)) continue;
    rows.push({
      rowId: row.rowId,
      cells: row.cells.flatMap((cellEntry) => {
        if (!cellEntry || typeof cellEntry !== 'object') return [];
        const cell = cellEntry as Record<string, unknown>;
        if (typeof cell.columnId !== 'string') return [];
        return [
          {
            columnId: cell.columnId,
            value: typeof cell.value === 'string' ? cell.value : String(cell.value ?? ''),
            editable: Boolean(cell.editable),
          },
        ];
      }),
    });
  }
  return rows;
}

function normalizeProvenanceEntries(raw: unknown[]): ProjectionProvenanceEntry[] {
  const entries: ProjectionProvenanceEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const facts = normalizeFacts(candidate.fact ? [candidate.fact] : []);
    if (!facts || facts.length === 0) continue;
    entries.push({
      fact: facts[0],
      anchors: normalizeAnchors(candidate.anchors),
    });
  }
  return entries;
}

function normalizeAnchors(raw: unknown): SheetAnchor[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const anchor = entry as Record<string, unknown>;
    return [
      {
        rowId: typeof anchor.rowId === 'string' ? anchor.rowId : undefined,
        columnId: typeof anchor.columnId === 'string' ? anchor.columnId : undefined,
      },
    ];
  });
}

function normalizeDocLike(raw: unknown): Pick<DatalogDoc, 'title' | 'facts' | 'draftText'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const facts = normalizeFacts(record.facts);
  if (!facts) return null;
  return {
    title: typeof record.title === 'string' ? record.title : undefined,
    facts,
    draftText: typeof record.draftText === 'string' ? record.draftText : undefined,
  };
}

function normalizeScriptAnnotations(
  raw: unknown,
  source: ArtifactSheetAnnotationSource,
  artifactUrl?: AutomergeUrl,
  constraintLabel?: string,
  fallback: ArtifactSheetAnnotation[] = [],
): ArtifactSheetAnnotation[] {
  if (raw == null) return fallback;
  if (Array.isArray(raw)) {
    const annotations: ArtifactSheetAnnotation[] = [];
    for (const entry of raw) {
      if (typeof entry === 'string') {
        annotations.push({
          artifactUrl,
          kind: 'sheet',
          message: entry,
          constraintLabel,
          source,
        });
        continue;
      }
      if (!entry || typeof entry !== 'object') continue;
      const annotation = entry as Record<string, unknown>;
      const kind = annotation.kind;
      const message = annotation.message;
      if (
        kind !== 'cell' &&
        kind !== 'row' &&
        kind !== 'column' &&
        kind !== 'sheet'
      ) {
        continue;
      }
      if (typeof message !== 'string') continue;
      annotations.push({
        artifactUrl:
          typeof annotation.artifactUrl === 'string'
            ? (annotation.artifactUrl as AutomergeUrl)
            : artifactUrl,
        kind,
        rowId: typeof annotation.rowId === 'string' ? annotation.rowId : undefined,
        columnId: typeof annotation.columnId === 'string' ? annotation.columnId : undefined,
        message,
        constraintLabel:
          typeof annotation.constraintLabel === 'string'
            ? annotation.constraintLabel
            : constraintLabel,
        source,
      });
    }
    return dedupeAnnotations(annotations.length > 0 ? annotations : fallback);
  }
  return fallback;
}

function freezeDocLike(doc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>) {
  return deepFreeze({
    title: doc.title,
    facts: cloneFacts(doc.facts),
    draftText: doc.draftText,
  });
}

function freezeProjectionDoc(projectionDoc: ProjectionDoc) {
  return deepFreeze({
    '@patchwork': { ...projectionDoc['@patchwork'] },
    artifactDocUrl: projectionDoc.artifactDocUrl,
    sourceType: projectionDoc.sourceType,
    title: projectionDoc.title,
    rowSpec: projectionDoc.rowSpec ? { ...projectionDoc.rowSpec } : undefined,
    columns: cloneProjectionColumns(projectionDoc.columns),
    script: projectionDoc.script,
  });
}

function freezeMaterializedProjection(materialized: MaterializedProjection) {
  return deepFreeze({
    title: materialized.title,
    columns: cloneMaterializedColumns(materialized.columns),
    hiddenColumns: cloneProjectionColumns(materialized.hiddenColumns),
    rows: cloneMaterializedRows(materialized.rows),
    annotations: materialized.annotations.map((annotation) => ({ ...annotation })),
  });
}

function freezeMutationResult(result: MutationResult) {
  if (result.ok) {
    return deepFreeze({
      ok: true as const,
      doc: {
        title: result.doc.title,
        facts: cloneFacts(result.doc.facts),
        draftText: result.doc.draftText,
      },
    });
  }
  return deepFreeze({
    ok: false as const,
    error: result.error,
    annotations: result.annotations.map((annotation) => ({ ...annotation })),
  });
}

function freezeScriptExpandedArtifactDoc(expanded: ScriptExpandedArtifactDoc) {
  return deepFreeze({
    title: expanded.title,
    facts: cloneFacts(expanded.facts),
    draftText: expanded.draftText,
    provenanceEntries: (expanded.provenanceEntries ?? []).map((entry) => ({
      fact: cloneFact(entry.fact),
      anchors: normalizeAnchors(entry.anchors),
    })),
  });
}

function freezeAnnotations(annotations: ArtifactSheetAnnotation[]) {
  return deepFreeze(annotations.map((annotation) => ({ ...annotation })));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (nested && typeof nested === 'object' && !Object.isFrozen(nested)) deepFreeze(nested);
  }
  return value;
}

function serializeFact(fact: StoredFact) {
  return `${fact.pred}(${fact.args.join(', ')}).`;
}

function scriptRuntimeAnnotation(
  message: string,
  artifactUrl?: AutomergeUrl,
  source: ArtifactSheetAnnotationSource = 'parse',
  constraintLabel?: string,
): ArtifactSheetAnnotation {
  return {
    artifactUrl,
    kind: 'sheet',
    message,
    constraintLabel,
    source,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
