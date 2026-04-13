import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import { serializeFact, type ConstraintViolation } from '../datalog-runtime';
import type { DatalogDoc, StoredFact } from '../spec/datalog-doc';
import type { VerificationConstraintResult } from '../validation/evaluate-verification';

type ArtifactDocLike = Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>;

const DEFAULT_TRUE_VALUE = 'yes';
const DEFAULT_FALSE_VALUE = 'no';

export type ProjectionCellType = 'text' | 'number' | 'boolean' | 'entity';
export type ProjectionCardinality = 'zero-or-one' | 'exactly-one' | 'many';
export type ProjectionBlankPolicy = 'delete' | 'reject';

export type FactArgRead = {
  kind: 'fact-arg';
  pred: string;
  rowKeyArg: number;
  valueArg: number;
};

export type FactPresenceRead = {
  kind: 'fact-presence';
  pred: string;
  rowKeyArg: number;
  trueValue?: string;
  falseValue?: string;
};

export type SlotValueRead = {
  kind: 'slot-value';
  pred: string;
  rowKeyArg: number;
  slotArg: number;
  slot: number;
  valueArg: number;
};

export type DerivedRowKeyRead = {
  kind: 'derived-row-key';
};

export type ProjectionReadBinding =
  | FactArgRead
  | FactPresenceRead
  | SlotValueRead
  | DerivedRowKeyRead;

export type UpsertFactArgWrite = {
  kind: 'upsert-fact-arg';
  pred: string;
  rowKeyArg: number;
  valueArg: number;
};

export type SetFactPresenceWrite = {
  kind: 'set-fact-presence';
  pred: string;
  rowKeyArg: number;
};

export type UpsertSlotValueWrite = {
  kind: 'upsert-slot-value';
  pred: string;
  rowKeyArg: number;
  slotArg: number;
  slot: number;
  valueArg: number;
};

export type ProjectionWriteBinding =
  | UpsertFactArgWrite
  | SetFactPresenceWrite
  | UpsertSlotValueWrite;

export type ProjectionSpecColumn = {
  id: string;
  header: string;
  hidden?: boolean;
  cellType: ProjectionCellType;
  read: ProjectionReadBinding;
  write?: ProjectionWriteBinding;
  cardinality: ProjectionCardinality;
  blankPolicy?: ProjectionBlankPolicy;
  readOnlyReason?: string;
};

export type ProjectionRowsSpec = {
  entityPredicate: string;
  keyArg: number;
  entityIdPrefix: string;
  order: 'entity-fact-order';
  create: {
    insertEntityFact: true;
  };
  delete: {
    mode: 'managed-predicates-only';
  };
};

export type ProjectionVerificationSpec = {
  expandScript?: string;
  mapViolationScript?: string;
};

export type ProjectionSpecDoc = {
  '@patchwork': { type: 'artifact-projection' };
  schemaVersion: 2;
  artifactDocUrl: AutomergeUrl;
  sourceType: 'datalog';
  title?: string;
  rows: ProjectionRowsSpec;
  columns: ProjectionSpecColumn[];
  verification?: ProjectionVerificationSpec;
};

export type ProjectionDoc = ProjectionSpecDoc;

export type ArtifactFolderEntry = {
  type: string;
  name: string;
  url: AutomergeUrl;
  specDocUrls?: AutomergeUrl[];
};

export type ArtifactProjectionAnnotationKind = 'cell' | 'row' | 'column' | 'sheet';
export type ArtifactProjectionAnnotationSource = 'parse' | 'constraint';

export type ArtifactProjectionAnnotation = {
  artifactUrl?: AutomergeUrl;
  kind: ArtifactProjectionAnnotationKind;
  rowId?: string;
  columnId?: string;
  message: string;
  constraintLabel?: string;
  source: ArtifactProjectionAnnotationSource;
};

export type MaterializedProjectionColumn = ProjectionSpecColumn & {
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
  hiddenColumns: ProjectionSpecColumn[];
  rows: MaterializedProjectionRow[];
  annotations: ArtifactProjectionAnnotation[];
};

export type SheetAnchor = {
  rowId?: string;
  columnId?: string;
};

export type ProjectionProvenanceEntry = {
  fact: StoredFact;
  anchors: SheetAnchor[];
};

export type ExpandedArtifactDoc = ArtifactDocLike & {
  provenanceByFactKey: Map<string, SheetAnchor[]>;
  provenanceEntries: ProjectionProvenanceEntry[];
};

export type MutationSuccess = {
  ok: true;
  doc: ArtifactDocLike;
};

export type MutationFailure = {
  ok: false;
  error: string;
  annotations: ArtifactProjectionAnnotation[];
};

export type MutationResult = MutationSuccess | MutationFailure;

type ProjectionRuntimeOptions = {
  projectionUrl?: AutomergeUrl;
  backend?: LensBackend;
};

type NormalizedProjectionColumn = ProjectionSpecColumn & {
  hidden: boolean;
  blankPolicy?: ProjectionBlankPolicy;
};

export type CompiledProjectionSpec = {
  title: string;
  rows: ProjectionRowsSpec;
  columns: NormalizedProjectionColumn[];
  visibleColumns: NormalizedProjectionColumn[];
  hiddenColumns: NormalizedProjectionColumn[];
  managedPredicates: Set<string>;
  rowKeyArgByPredicate: Map<string, number>;
};

export type CompileProjectionSpecResult = {
  ok: boolean;
  compiled?: CompiledProjectionSpec;
  annotations: ArtifactProjectionAnnotation[];
  title: string;
  visibleColumns: NormalizedProjectionColumn[];
  hiddenColumns: NormalizedProjectionColumn[];
};

export interface LensBackend {
  readonly id: string;
  validate(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
  ): ArtifactProjectionAnnotation[];
  materialize(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
  ): MaterializedProjection;
  applyCellEdit(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    columnId: string,
    rawValue: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult;
  appendRow(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): MutationResult;
  deleteRow(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult;
  buildBaseProvenance(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
  ): ExpandedArtifactDoc;
}

type VerificationExpandContext = {
  artifactDoc: ArtifactDocLike;
  projectionDoc: ProjectionSpecDoc;
  defaultExpanded: ArtifactDocLike & {
    provenanceEntries: ProjectionProvenanceEntry[];
  };
  helpers: ProjectionScriptHelpers;
};

type VerificationMapViolationContext = {
  artifactUrl: AutomergeUrl;
  constraintLabel: string;
  violation: ConstraintViolation;
  expandedArtifactDoc: ArtifactDocLike & {
    provenanceEntries: ProjectionProvenanceEntry[];
  };
  defaultAnnotations: ArtifactProjectionAnnotation[];
  helpers: ProjectionScriptHelpers;
};

type ProjectionScriptHelpers = {
  cloneFacts: (facts: StoredFact[]) => StoredFact[];
  makeFact: (pred: string, ...args: (string | number)[]) => StoredFact;
  getRowIds: (projectionDoc: ProjectionSpecDoc, facts: StoredFact[]) => string[];
  findFactArg: (
    facts: StoredFact[],
    pred: string,
    rowId: string,
    valueArg: number,
    rowKeyArg?: number,
  ) => string | undefined;
  findSlotValue: (
    facts: StoredFact[],
    rowId: string,
    pred: string,
    slot: number,
    valueArg: number,
    rowKeyArg?: number,
    slotArg?: number,
  ) => string | undefined;
  hasFact: (facts: StoredFact[], pred: string, rowId: string, rowKeyArg?: number) => boolean;
  readCellValue: (column: ProjectionSpecColumn, rowId: string, facts: StoredFact[]) => string;
  buildBaseArtifactDraft: (title: string, facts: StoredFact[]) => string;
  buildExpandedArtifactDraft: (
    title: string,
    baseFacts: StoredFact[],
    derivedFacts: StoredFact[],
  ) => string;
  provenanceEntry: (fact: StoredFact, anchors: SheetAnchor[]) => ProjectionProvenanceEntry;
  resolveFactAnchors: (
    fact: StoredFact,
    provenanceEntries: ProjectionProvenanceEntry[],
    groundBody?: StoredFact[],
  ) => SheetAnchor[];
};

const verificationScriptCache = new Map<string, (ctx: unknown) => unknown>();

const scriptHelpers: ProjectionScriptHelpers = {
  cloneFacts,
  makeFact: f,
  getRowIds,
  findFactArg,
  findSlotValue,
  hasFact,
  readCellValue,
  buildBaseArtifactDraft,
  buildExpandedArtifactDraft,
  provenanceEntry: (fact, anchors) => ({
    fact: cloneFact(fact),
    anchors: normalizeAnchors(anchors),
  }),
  resolveFactAnchors: (fact, entries, groundBody) =>
    resolveFactAnchorsFromEntries(fact, entries, groundBody),
};

class NativeDatalogLensBackend implements LensBackend {
  readonly id = 'native-datalog';

  validate(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): ArtifactProjectionAnnotation[] {
    const annotations: ArtifactProjectionAnnotation[] = [];

    for (const rowId of getRowIdsFromCompiled(compiled, doc.facts)) {
      for (const column of compiled.visibleColumns) {
        const matches = getReadMatches(column, rowId, doc.facts);
        if (column.read.kind === 'derived-row-key') continue;

        if (column.cardinality === 'zero-or-one' && matches.length > 1) {
          annotations.push({
            kind: 'cell',
            rowId,
            columnId: column.id,
            message: `Column "${column.header}" has ${matches.length} matching facts but only zero or one is allowed.`,
            source: 'parse',
          });
        }

        if (column.cardinality === 'exactly-one') {
          if (matches.length === 0) {
            annotations.push({
              kind: 'cell',
              rowId,
              columnId: column.id,
              message: `Column "${column.header}" requires exactly one matching fact.`,
              source: 'parse',
            });
          } else if (matches.length > 1) {
            annotations.push({
              kind: 'cell',
              rowId,
              columnId: column.id,
              message: `Column "${column.header}" has ${matches.length} matching facts but exactly one is required.`,
              source: 'parse',
            });
          }
        }
      }
    }

    return dedupeAnnotations(annotations);
  }

  materialize(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): MaterializedProjection {
    const rows = getRowIdsFromCompiled(compiled, doc.facts).map((rowId) => ({
      rowId,
      cells: compiled.visibleColumns.map((column) => ({
        columnId: column.id,
        value: readCellValue(column, rowId, doc.facts),
        editable: Boolean(column.write),
      })),
    }));

    return {
      title: compiled.title,
      columns: compiled.visibleColumns.map((column, visibleIndex) => ({ ...column, visibleIndex })),
      hiddenColumns: compiled.hiddenColumns.map((column) => ({ ...column })),
      rows,
      annotations: [],
    };
  }

  applyCellEdit(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    columnId: string,
    rawValue: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult {
    const column = compiled.columns.find((entry) => entry.id === columnId);
    if (!column) {
      return mutationError(artifactUrl, rowId, columnId, `Unknown column "${columnId}".`);
    }
    const write = column.write;
    if (!write) {
      return mutationError(artifactUrl, rowId, columnId, `Column "${column.header}" is read-only.`);
    }

    const nextFacts = cloneFacts(doc.facts);
    const normalized = rawValue.trim();
    const value = parseInputValue(column, normalized);
    if (!value.ok) {
      return mutationError(artifactUrl, rowId, columnId, value.error);
    }

    if (value.value == null && column.blankPolicy === 'reject') {
      return mutationError(
        artifactUrl,
        rowId,
        columnId,
        `Column "${column.header}" does not allow blank values.`,
      );
    }

    switch (write.kind) {
      case 'upsert-fact-arg': {
        const matches = nextFacts.filter(
          (fact) =>
            fact.pred === write.pred &&
            String(fact.args[write.rowKeyArg]) === rowId,
        );
        if (matches.length > 1) {
          return mutationError(
            artifactUrl,
            rowId,
            columnId,
            `Column "${column.header}" is ambiguous because multiple matching facts already exist.`,
          );
        }
        if (value.value == null) {
          removeFacts(
            nextFacts,
            (fact) =>
              fact.pred === write.pred &&
              String(fact.args[write.rowKeyArg]) === rowId,
          );
        } else if (matches.length === 1) {
          matches[0].args[write.valueArg] = value.value;
        } else {
          nextFacts.push(
            buildFactFromWrite(write.pred, write.rowKeyArg, rowId, {
              [write.valueArg]: value.value,
            }),
          );
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
        const matches = nextFacts.filter(
          (fact) =>
            fact.pred === write.pred &&
            String(fact.args[write.rowKeyArg]) === rowId,
        );
        if (parsed) {
          if (matches.length === 0) {
            nextFacts.push(buildFactFromWrite(write.pred, write.rowKeyArg, rowId));
          }
        } else {
          removeFacts(
            nextFacts,
            (fact) =>
              fact.pred === write.pred &&
              String(fact.args[write.rowKeyArg]) === rowId,
          );
        }
        break;
      }
      case 'upsert-slot-value': {
        const matches = nextFacts.filter(
          (fact) =>
            fact.pred === write.pred &&
            String(fact.args[write.rowKeyArg]) === rowId &&
            Number(fact.args[write.slotArg]) === write.slot,
        );
        if (matches.length > 1) {
          return mutationError(
            artifactUrl,
            rowId,
            columnId,
            `Column "${column.header}" is ambiguous because multiple slot facts already exist.`,
          );
        }
        if (value.value == null) {
          removeFacts(
            nextFacts,
            (fact) =>
              fact.pred === write.pred &&
              String(fact.args[write.rowKeyArg]) === rowId &&
              Number(fact.args[write.slotArg]) === write.slot,
          );
        } else if (matches.length === 1) {
          matches[0].args[write.valueArg] = value.value;
        } else {
          nextFacts.push(
            buildFactFromWrite(write.pred, write.rowKeyArg, rowId, {
              [write.slotArg]: write.slot,
              [write.valueArg]: value.value,
            }),
          );
        }
        break;
      }
      default: {
        const exhaustiveCheck: never = write;
        throw new Error(`Unsupported write binding: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }

    return successResult(doc.title, nextFacts);
  }

  appendRow(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): MutationResult {
    const rowId = generateRowId(compiled, doc.facts);
    const nextFacts = cloneFacts(doc.facts);
    nextFacts.push(buildFactFromWrite(compiled.rows.entityPredicate, compiled.rows.keyArg, rowId));
    return successResult(doc.title, nextFacts);
  }

  deleteRow(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult {
    const nextFacts = cloneFacts(doc.facts);
    const filteredFacts = nextFacts.filter((fact) => !matchesManagedRow(compiled, fact, rowId));

    const remainingReferences = filteredFacts.filter((fact) =>
      fact.args.some((arg) => String(arg) === rowId),
    );
    if (remainingReferences.length > 0) {
      return {
        ok: false,
        error: `Cannot delete row "${rowId}" because unmanaged facts still reference it.`,
        annotations: [
          {
            artifactUrl,
            kind: 'row',
            rowId,
            message: `Cannot delete row "${rowId}" because unmanaged facts still reference it.`,
            source: 'parse',
          },
        ],
      };
    }

    return successResult(doc.title, filteredFacts);
  }

  buildBaseProvenance(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): ExpandedArtifactDoc {
    const facts = cloneFacts(doc.facts);
    const provenanceEntries = facts.flatMap((fact) => {
      const anchors = anchorsForFact(compiled, fact);
      return anchors.length > 0 ? [{ fact: cloneFact(fact), anchors }] : [];
    });

    return {
      title: doc.title,
      facts,
      draftText: buildBaseArtifactDraft(doc.title || 'Artifact', facts),
      provenanceEntries,
      provenanceByFactKey: provenanceEntriesToMap(provenanceEntries),
    };
  }
}

/**
 * This is a compatibility scaffold for the planned panproto backend. Until the
 * repo includes an installable JS/WASM panproto runtime, it delegates to the
 * native backend while preserving the backend interface and parity test seam.
 */
class PanprotoLensBackend implements LensBackend {
  readonly id = 'panproto';

  constructor(private readonly fallback: LensBackend) {}

  validate(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): ArtifactProjectionAnnotation[] {
    return this.fallback.validate(compiled, doc);
  }

  materialize(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): MaterializedProjection {
    return this.fallback.materialize(compiled, doc);
  }

  applyCellEdit(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    columnId: string,
    rawValue: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult {
    return this.fallback.applyCellEdit(compiled, doc, rowId, columnId, rawValue, artifactUrl);
  }

  appendRow(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): MutationResult {
    return this.fallback.appendRow(compiled, doc);
  }

  deleteRow(
    compiled: CompiledProjectionSpec,
    doc: ArtifactDocLike,
    rowId: string,
    artifactUrl?: AutomergeUrl,
  ): MutationResult {
    return this.fallback.deleteRow(compiled, doc, rowId, artifactUrl);
  }

  buildBaseProvenance(compiled: CompiledProjectionSpec, doc: ArtifactDocLike): ExpandedArtifactDoc {
    return this.fallback.buildBaseProvenance(compiled, doc);
  }
}

export const nativeDatalogLensBackend: LensBackend = new NativeDatalogLensBackend();
export const panprotoLensBackend: LensBackend = new PanprotoLensBackend(nativeDatalogLensBackend);

export function createProjectionDoc(repo: Repo, projectionDoc: ProjectionSpecDoc): AutomergeUrl {
  const handle = repo.create<ProjectionSpecDoc>();
  handle.change((doc) => {
    doc['@patchwork'] = { type: 'artifact-projection' };
    doc.schemaVersion = 2;
    doc.artifactDocUrl = projectionDoc.artifactDocUrl;
    doc.sourceType = 'datalog';
    doc.title = projectionDoc.title;
    doc.rows = cloneRowsSpec(projectionDoc.rows);
    doc.columns = projectionDoc.columns.map((column) => cloneColumn(column));
    if (projectionDoc.verification) {
      doc.verification = { ...projectionDoc.verification };
    }
  });
  return handle.url;
}

export function compileProjectionSpec(specDoc: ProjectionSpecDoc): CompileProjectionSpecResult {
  const annotations: ArtifactProjectionAnnotation[] = [];
  const title = specDoc.title || 'Artifact Sheet';
  const columns = Array.isArray(specDoc.columns)
    ? specDoc.columns.map((column) => normalizeColumn(column))
    : [];
  const visibleColumns = columns.filter((column) => !column.hidden);
  const hiddenColumns = columns.filter((column) => column.hidden);

  if (specDoc['@patchwork']?.type !== 'artifact-projection') {
    annotations.push(sheetAnnotation('Projection document has the wrong datatype marker.'));
  }
  if (specDoc.schemaVersion !== 2) {
    annotations.push(sheetAnnotation('Projection must declare schemaVersion 2.'));
  }
  if (specDoc.sourceType !== 'datalog') {
    annotations.push(sheetAnnotation('Projection only supports datalog sources.'));
  }
  if (!specDoc.rows) {
    annotations.push(sheetAnnotation('Projection is missing rows configuration.'));
  } else {
    if (specDoc.rows.order !== 'entity-fact-order') {
      annotations.push(sheetAnnotation('rows.order must be "entity-fact-order".'));
    }
    if (!specDoc.rows.create?.insertEntityFact) {
      annotations.push(sheetAnnotation('rows.create.insertEntityFact must be true.'));
    }
    if (specDoc.rows.delete?.mode !== 'managed-predicates-only') {
      annotations.push(sheetAnnotation('rows.delete.mode must be "managed-predicates-only".'));
    }
  }

  const seenColumnIds = new Set<string>();
  const rowKeyArgByPredicate = new Map<string, number>();
  const managedPredicates = new Set<string>();

  if (specDoc.rows?.entityPredicate) {
    managedPredicates.add(specDoc.rows.entityPredicate);
    rowKeyArgByPredicate.set(specDoc.rows.entityPredicate, specDoc.rows.keyArg);
  }

  for (const column of columns) {
    if (!column.id) {
      annotations.push(sheetAnnotation('Projection columns must have an id.'));
      continue;
    }
    if (seenColumnIds.has(column.id)) {
      annotations.push(columnAnnotation(column.id, `Column id "${column.id}" must be unique.`));
      continue;
    }
    seenColumnIds.add(column.id);

    if (column.cardinality === 'many' && column.write) {
      annotations.push(
        columnAnnotation(
          column.id,
          `Editable column "${column.header}" cannot use cardinality "many".`,
        ),
      );
    }

    switch (column.read.kind) {
      case 'fact-arg':
        registerPredicateRowKey(rowKeyArgByPredicate, column.read.pred, column.read.rowKeyArg, column.id, annotations);
        break;
      case 'fact-presence':
        registerPredicateRowKey(rowKeyArgByPredicate, column.read.pred, column.read.rowKeyArg, column.id, annotations);
        if (column.cellType !== 'boolean') {
          annotations.push(columnAnnotation(column.id, `Column "${column.header}" must use cellType "boolean" for fact-presence reads.`));
        }
        break;
      case 'slot-value':
        registerPredicateRowKey(rowKeyArgByPredicate, column.read.pred, column.read.rowKeyArg, column.id, annotations);
        break;
      case 'derived-row-key':
        if (column.write) {
          annotations.push(columnAnnotation(column.id, `Column "${column.header}" derives the row key and cannot be editable.`));
        }
        break;
      default: {
        const exhaustiveCheck: never = column.read;
        annotations.push(columnAnnotation(column.id, `Unsupported read binding: ${JSON.stringify(exhaustiveCheck)}`));
      }
    }

    if (!column.write) continue;

    if (column.read.kind === 'derived-row-key') {
      annotations.push(columnAnnotation(column.id, `Column "${column.header}" cannot define a write binding.`));
      continue;
    }

    switch (column.write.kind) {
      case 'upsert-fact-arg':
        registerManagedPredicate(managedPredicates, rowKeyArgByPredicate, column.write.pred, column.write.rowKeyArg, column.id, annotations);
        if (
          column.read.kind !== 'fact-arg' ||
          column.read.pred !== column.write.pred ||
          column.read.rowKeyArg !== column.write.rowKeyArg ||
          column.read.valueArg !== column.write.valueArg
        ) {
          annotations.push(columnAnnotation(column.id, `Column "${column.header}" write binding must mirror its fact-arg read binding.`));
        }
        break;
      case 'set-fact-presence':
        registerManagedPredicate(managedPredicates, rowKeyArgByPredicate, column.write.pred, column.write.rowKeyArg, column.id, annotations);
        if (
          column.read.kind !== 'fact-presence' ||
          column.read.pred !== column.write.pred ||
          column.read.rowKeyArg !== column.write.rowKeyArg
        ) {
          annotations.push(columnAnnotation(column.id, `Column "${column.header}" write binding must mirror its fact-presence read binding.`));
        }
        break;
      case 'upsert-slot-value':
        registerManagedPredicate(managedPredicates, rowKeyArgByPredicate, column.write.pred, column.write.rowKeyArg, column.id, annotations);
        if (
          column.read.kind !== 'slot-value' ||
          column.read.pred !== column.write.pred ||
          column.read.rowKeyArg !== column.write.rowKeyArg ||
          column.read.slotArg !== column.write.slotArg ||
          column.read.slot !== column.write.slot ||
          column.read.valueArg !== column.write.valueArg
        ) {
          annotations.push(columnAnnotation(column.id, `Column "${column.header}" write binding must mirror its slot-value read binding.`));
        }
        break;
      default: {
        const exhaustiveCheck: never = column.write;
        annotations.push(columnAnnotation(column.id, `Unsupported write binding: ${JSON.stringify(exhaustiveCheck)}`));
      }
    }
  }

  const ok = annotations.length === 0;
  if (!ok || !specDoc.rows) {
    return { ok: false, annotations, title, visibleColumns, hiddenColumns };
  }

  return {
    ok: true,
    annotations,
    title,
    visibleColumns,
    hiddenColumns,
    compiled: {
      title,
      rows: cloneRowsSpec(specDoc.rows),
      columns,
      visibleColumns,
      hiddenColumns,
      managedPredicates,
      rowKeyArgByPredicate,
    },
  };
}

export function materializeProjection(
  projectionDoc: ProjectionSpecDoc,
  artifactDoc: ArtifactDocLike,
  options: ProjectionRuntimeOptions = {},
): MaterializedProjection {
  const compile = compileProjectionSpec(projectionDoc);
  if (!compile.ok || !compile.compiled) {
    return {
      title: compile.title || artifactDoc.title || 'Artifact Sheet',
      columns: compile.visibleColumns.map((column, visibleIndex) => ({ ...column, visibleIndex })),
      hiddenColumns: compile.hiddenColumns.map((column) => ({ ...column })),
      rows: [],
      annotations: dedupeAnnotations(compile.annotations),
    };
  }

  const backend = options.backend ?? nativeDatalogLensBackend;
  const base = backend.materialize(compile.compiled, artifactDoc);
  const annotations = dedupeAnnotations([
    ...compile.annotations,
    ...base.annotations,
    ...backend.validate(compile.compiled, artifactDoc),
  ]);
  return { ...base, annotations };
}

export function appendProjectionRow(
  projectionDoc: ProjectionSpecDoc,
  priorDoc: ArtifactDocLike,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const compile = compileProjectionSpec(projectionDoc);
  if (!compile.ok || !compile.compiled) {
    return {
      ok: false,
      error: compile.annotations[0]?.message || 'Projection spec is invalid.',
      annotations: compile.annotations,
    };
  }
  return (options.backend ?? nativeDatalogLensBackend).appendRow(compile.compiled, priorDoc);
}

export function deleteProjectionRow(
  projectionDoc: ProjectionSpecDoc,
  priorDoc: ArtifactDocLike,
  rowId: string,
  artifactUrl?: AutomergeUrl,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const compile = compileProjectionSpec(projectionDoc);
  if (!compile.ok || !compile.compiled) {
    return {
      ok: false,
      error: compile.annotations[0]?.message || 'Projection spec is invalid.',
      annotations: compile.annotations,
    };
  }
  return (options.backend ?? nativeDatalogLensBackend).deleteRow(
    compile.compiled,
    priorDoc,
    rowId,
    artifactUrl,
  );
}

export function applyProjectionCellEdit(
  projectionDoc: ProjectionSpecDoc,
  priorDoc: ArtifactDocLike,
  rowId: string,
  columnId: string,
  rawValue: string,
  artifactUrl?: AutomergeUrl,
  options: ProjectionRuntimeOptions = {},
): MutationResult {
  const compile = compileProjectionSpec(projectionDoc);
  if (!compile.ok || !compile.compiled) {
    return {
      ok: false,
      error: compile.annotations[0]?.message || 'Projection spec is invalid.',
      annotations: compile.annotations,
    };
  }
  return (options.backend ?? nativeDatalogLensBackend).applyCellEdit(
    compile.compiled,
    priorDoc,
    rowId,
    columnId,
    rawValue,
    artifactUrl,
  );
}

export function expandArtifactDocForVerification(
  projectionDoc: ProjectionSpecDoc,
  artifactDoc: ArtifactDocLike,
  options: ProjectionRuntimeOptions = {},
): ExpandedArtifactDoc {
  const compile = compileProjectionSpec(projectionDoc);
  const backend = options.backend ?? nativeDatalogLensBackend;
  const fallback = compile.ok && compile.compiled
    ? backend.buildBaseProvenance(compile.compiled, artifactDoc)
    : buildFallbackExpandedArtifactDoc(artifactDoc);

  const script = projectionDoc.verification?.expandScript?.trim();
  if (!script) return fallback;

  try {
    const raw = loadVerificationScript(script, 'expand')({
      artifactDoc: freezeDocLike(artifactDoc),
      projectionDoc: freezeProjectionDoc(projectionDoc),
      defaultExpanded: freezeExpandedArtifactForScript(fallback),
      helpers: scriptHelpers,
    } satisfies VerificationExpandContext);
    return normalizeScriptExpandedArtifact(raw, fallback);
  } catch (error) {
    return {
      ...fallback,
      draftText: [
        fallback.draftText || buildBaseArtifactDraft(artifactDoc.title || 'Artifact', fallback.facts),
        '',
        `% Verification expansion script error: ${errorMessage(error)}`,
      ].join('\n'),
    };
  }
}

export function deriveConstraintAnnotationsForArtifact(
  projectionDoc: ProjectionSpecDoc,
  artifactUrl: AutomergeUrl,
  expandedArtifactDoc: ExpandedArtifactDoc,
  constraints:
    | Array<{ constraintLabel: string; violations: ConstraintViolation[] }>
    | VerificationConstraintResult[],
  _options: ProjectionRuntimeOptions = {},
): ArtifactProjectionAnnotation[] {
  const annotations: ArtifactProjectionAnnotation[] = [];
  const script = projectionDoc.verification?.mapViolationScript?.trim();

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
      if (!script) {
        annotations.push(...fallback);
        continue;
      }

      try {
        const raw = loadVerificationScript(script, 'mapViolation')({
          artifactUrl,
          constraintLabel,
          violation,
          expandedArtifactDoc: freezeExpandedArtifactForScript(expandedArtifactDoc),
          defaultAnnotations: freezeAnnotations(fallback),
          helpers: scriptHelpers,
        } satisfies VerificationMapViolationContext);
        annotations.push(
          ...normalizeScriptAnnotations(raw, 'constraint', artifactUrl, constraintLabel, fallback),
        );
      } catch (error) {
        annotations.push(
          ...fallback,
          scriptRuntimeAnnotation(
            `Verification mapViolationScript failed: ${errorMessage(error)}`,
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
    lines.push(...baseFacts.map((fact) => serializeFact(fact)));
  }
  if (derivedFacts.length > 0) {
    if (baseFacts.length > 0) lines.push('');
    lines.push('% Derived facts used by verification');
    lines.push(...derivedFacts.map((fact) => serializeFact(fact)));
  }
  return lines.join('\n');
}

function normalizeColumn(column: ProjectionSpecColumn): NormalizedProjectionColumn {
  return {
    ...column,
    hidden: Boolean(column.hidden),
    blankPolicy:
      column.blankPolicy ??
      (column.write ? (column.cardinality === 'exactly-one' ? 'reject' : 'delete') : undefined),
    read: { ...column.read },
    write: column.write ? { ...column.write } : undefined,
  };
}

function cloneRowsSpec(rows: ProjectionRowsSpec): ProjectionRowsSpec {
  return {
    entityPredicate: rows.entityPredicate,
    keyArg: rows.keyArg,
    entityIdPrefix: rows.entityIdPrefix,
    order: rows.order,
    create: { ...rows.create },
    delete: { ...rows.delete },
  };
}

function cloneColumn(column: ProjectionSpecColumn): ProjectionSpecColumn {
  const result: ProjectionSpecColumn = {
    ...column,
    read: { ...column.read },
  };
  if (column.write) result.write = { ...column.write };
  return result;
}

function registerPredicateRowKey(
  registry: Map<string, number>,
  pred: string,
  rowKeyArg: number,
  columnId: string,
  annotations: ArtifactProjectionAnnotation[],
) {
  const existing = registry.get(pred);
  if (existing != null && existing !== rowKeyArg) {
    annotations.push(
      columnAnnotation(
        columnId,
        `Predicate "${pred}" is configured with conflicting row key positions (${existing} and ${rowKeyArg}).`,
      ),
    );
    return;
  }
  registry.set(pred, rowKeyArg);
}

function registerManagedPredicate(
  managedPredicates: Set<string>,
  registry: Map<string, number>,
  pred: string,
  rowKeyArg: number,
  columnId: string,
  annotations: ArtifactProjectionAnnotation[],
) {
  managedPredicates.add(pred);
  registerPredicateRowKey(registry, pred, rowKeyArg, columnId, annotations);
}

function getRowIds(projectionDoc: ProjectionSpecDoc, facts: StoredFact[]) {
  if (!projectionDoc.rows) return [];
  return facts
    .filter((fact) => fact.pred === projectionDoc.rows.entityPredicate)
    .map((fact) => String(fact.args[projectionDoc.rows.keyArg] ?? ''))
    .filter(Boolean);
}

function getRowIdsFromCompiled(compiled: CompiledProjectionSpec, facts: StoredFact[]) {
  return facts
    .filter((fact) => fact.pred === compiled.rows.entityPredicate)
    .map((fact) => String(fact.args[compiled.rows.keyArg] ?? ''))
    .filter(Boolean);
}

function getReadMatches(
  column: ProjectionSpecColumn,
  rowId: string,
  facts: StoredFact[],
): StoredFact[] {
  const read = column.read;
  switch (read.kind) {
    case 'fact-arg':
      return facts.filter(
        (fact) =>
          fact.pred === read.pred &&
          String(fact.args[read.rowKeyArg]) === rowId,
      );
    case 'fact-presence':
      return facts.filter(
        (fact) =>
          fact.pred === read.pred &&
          String(fact.args[read.rowKeyArg]) === rowId,
      );
    case 'slot-value':
      return facts.filter(
        (fact) =>
          fact.pred === read.pred &&
          String(fact.args[read.rowKeyArg]) === rowId &&
          Number(fact.args[read.slotArg]) === read.slot,
      );
    case 'derived-row-key':
      return [];
    default: {
      const exhaustiveCheck: never = read;
      throw new Error(`Unsupported read binding: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function readCellValue(column: ProjectionSpecColumn, rowId: string, facts: StoredFact[]): string {
  const matches = getReadMatches(column, rowId, facts);

  const read = column.read;
  switch (read.kind) {
    case 'fact-arg':
      if (matches.length === 0) return '';
      if (column.cardinality === 'many') {
        return matches
          .map((fact) => String(fact.args[read.valueArg] ?? ''))
          .filter(Boolean)
          .join(', ');
      }
      return String(matches[0].args[read.valueArg] ?? '');
    case 'fact-presence':
      return matches.length > 0
        ? read.trueValue || DEFAULT_TRUE_VALUE
        : read.falseValue || DEFAULT_FALSE_VALUE;
    case 'slot-value':
      if (matches.length === 0) return '';
      if (column.cardinality === 'many') {
        return matches
          .map((fact) => String(fact.args[read.valueArg] ?? ''))
          .filter(Boolean)
          .join(', ');
      }
      return String(matches[0].args[read.valueArg] ?? '');
    case 'derived-row-key':
      return rowId;
    default: {
      const exhaustiveCheck: never = read;
      throw new Error(`Unsupported read binding: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function parseInputValue(
  column: ProjectionSpecColumn,
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
    return { ok: true, value: rawValue };
  }
  return { ok: true, value: rawValue };
}

function parseBooleanValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (['yes', 'true', '1'].includes(normalized)) return true;
  if (['no', 'false', '0'].includes(normalized)) return false;
  return null;
}

function buildFactFromWrite(
  pred: string,
  rowKeyArg: number,
  rowId: string,
  extraArgs: Record<number, string | number> = {},
): StoredFact {
  const indices = [rowKeyArg, ...Object.keys(extraArgs).map((key) => Number(key))];
  const length = Math.max(1, ...indices) + 1;
  const args: Array<string | number> = Array.from({ length }, () => '');
  args[rowKeyArg] = rowId;
  for (const [index, value] of Object.entries(extraArgs)) {
    args[Number(index)] = value;
  }
  return { pred, args };
}

function generateRowId(compiled: CompiledProjectionSpec, facts: StoredFact[]) {
  const existing = new Set(getRowIdsFromCompiled(compiled, facts));
  let candidate = '';
  do {
    candidate = `${compiled.rows.entityIdPrefix}_${Math.random().toString(36).slice(2, 8)}`;
  } while (existing.has(candidate));
  return candidate;
}

function matchesManagedRow(compiled: CompiledProjectionSpec, fact: StoredFact, rowId: string) {
  const rowKeyArg = compiled.rowKeyArgByPredicate.get(fact.pred);
  return rowKeyArg != null && String(fact.args[rowKeyArg] ?? '') === rowId;
}

function successResult(title: string | undefined, facts: StoredFact[]): MutationSuccess {
  return {
    ok: true,
    doc: {
      title,
      facts,
      draftText: buildBaseArtifactDraft(title || 'Artifact', facts),
    },
  };
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

function cloneFact(fact: StoredFact): StoredFact {
  return { ...fact, args: [...fact.args] };
}

function cloneFacts(facts: StoredFact[]) {
  return facts.map((fact) => cloneFact(fact));
}

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

function removeFacts(facts: StoredFact[], predicate: (fact: StoredFact) => boolean) {
  for (let index = facts.length - 1; index >= 0; index -= 1) {
    if (predicate(facts[index])) facts.splice(index, 1);
  }
}

function findFactArg(
  facts: StoredFact[],
  pred: string,
  rowId: string,
  valueArg: number,
  rowKeyArg = 0,
): string | undefined {
  const fact = facts.find(
    (entry) => entry.pred === pred && String(entry.args[rowKeyArg] ?? '') === rowId,
  );
  return fact ? String(fact.args[valueArg] ?? '') : undefined;
}

function findSlotValue(
  facts: StoredFact[],
  rowId: string,
  pred: string,
  slot: number,
  valueArg: number,
  rowKeyArg = 0,
  slotArg = 1,
) {
  const fact = facts.find(
    (entry) =>
      entry.pred === pred &&
      String(entry.args[rowKeyArg] ?? '') === rowId &&
      Number(entry.args[slotArg] ?? NaN) === slot,
  );
  return fact ? String(fact.args[valueArg] ?? '') : undefined;
}

function hasFact(facts: StoredFact[], pred: string, rowId: string, rowKeyArg = 0) {
  return facts.some(
    (fact) => fact.pred === pred && String(fact.args[rowKeyArg] ?? '') === rowId,
  );
}

function anchorsForFact(compiled: CompiledProjectionSpec, fact: StoredFact): SheetAnchor[] {
  const rowKeyArg = compiled.rowKeyArgByPredicate.get(fact.pred);
  const rowId = rowKeyArg != null ? String(fact.args[rowKeyArg] ?? '') : '';
  if (!rowId) return [];

  const anchors = compiled.columns.flatMap((column) => {
    switch (column.read.kind) {
      case 'fact-arg':
        return column.read.pred === fact.pred &&
          String(fact.args[column.read.rowKeyArg] ?? '') === rowId
          ? [{ rowId, columnId: column.id }]
          : [];
      case 'fact-presence':
        return column.read.pred === fact.pred &&
          String(fact.args[column.read.rowKeyArg] ?? '') === rowId
          ? [{ rowId, columnId: column.id }]
          : [];
      case 'slot-value':
        return column.read.pred === fact.pred &&
          String(fact.args[column.read.rowKeyArg] ?? '') === rowId &&
          Number(fact.args[column.read.slotArg] ?? NaN) === column.read.slot
          ? [{ rowId, columnId: column.id }]
          : [];
      case 'derived-row-key':
        return fact.pred === compiled.rows.entityPredicate &&
          String(fact.args[compiled.rows.keyArg] ?? '') === rowId
          ? [{ rowId, columnId: column.id }]
          : [];
      default: {
        const exhaustiveCheck: never = column.read;
        throw new Error(`Unsupported read binding: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  });

  return anchors.length > 0 ? anchors : [{ rowId }];
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

function buildFallbackExpandedArtifactDoc(artifactDoc: ArtifactDocLike): ExpandedArtifactDoc {
  const facts = cloneFacts(artifactDoc.facts);
  return {
    title: artifactDoc.title,
    facts,
    draftText: buildBaseArtifactDraft(artifactDoc.title || 'Artifact', facts),
    provenanceEntries: [],
    provenanceByFactKey: new Map(),
  };
}

function loadVerificationScript(script: string, kind: 'expand' | 'mapViolation') {
  const cacheKey = `${kind}::${script}`;
  const cached = verificationScriptCache.get(cacheKey);
  if (cached) return cached;

  const evaluator = new Function(
    'ctx',
    ['"use strict";', script].join('\n'),
  ) as (ctx: unknown) => unknown;
  verificationScriptCache.set(cacheKey, evaluator);
  return evaluator;
}

function normalizeScriptExpandedArtifact(
  raw: unknown,
  fallback: ExpandedArtifactDoc,
): ExpandedArtifactDoc {
  if (!raw || typeof raw !== 'object') return fallback;
  const record = raw as Record<string, unknown>;
  const facts = normalizeFacts(record.facts);
  if (!facts) return fallback;

  const provenanceEntries = Array.isArray(record.provenanceEntries)
    ? normalizeProvenanceEntries(record.provenanceEntries)
    : fallback.provenanceEntries;

  return {
    title: typeof record.title === 'string' ? record.title : fallback.title,
    facts,
    draftText:
      typeof record.draftText === 'string'
        ? record.draftText
        : buildBaseArtifactDraft((typeof record.title === 'string' ? record.title : fallback.title) || 'Artifact', facts),
    provenanceEntries,
    provenanceByFactKey: provenanceEntriesToMap(provenanceEntries),
  };
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

function mapViolationToAnnotations(
  artifactUrl: AutomergeUrl,
  constraintLabel: string,
  violation: ConstraintViolation,
  provenanceByFactKey: Map<string, SheetAnchor[]>,
): ArtifactProjectionAnnotation[] {
  const annotations: ArtifactProjectionAnnotation[] = [];
  let touchedArtifact = false;
  const hasNegation = violation.constraint.body.some((atom) => atom.pred === 'not');

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
        if (!hasNegation && anchor.rowId && anchor.columnId) {
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

function normalizeScriptAnnotations(
  raw: unknown,
  source: ArtifactProjectionAnnotationSource,
  artifactUrl?: AutomergeUrl,
  constraintLabel?: string,
  fallback: ArtifactProjectionAnnotation[] = [],
): ArtifactProjectionAnnotation[] {
  if (raw == null) return fallback;
  if (!Array.isArray(raw)) return fallback;

  const annotations: ArtifactProjectionAnnotation[] = [];
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
    if (
      annotation.kind !== 'cell' &&
      annotation.kind !== 'row' &&
      annotation.kind !== 'column' &&
      annotation.kind !== 'sheet'
    ) {
      continue;
    }
    if (typeof annotation.message !== 'string') continue;
    annotations.push({
      artifactUrl:
        typeof annotation.artifactUrl === 'string'
          ? (annotation.artifactUrl as AutomergeUrl)
          : artifactUrl,
      kind: annotation.kind,
      rowId: typeof annotation.rowId === 'string' ? annotation.rowId : undefined,
      columnId: typeof annotation.columnId === 'string' ? annotation.columnId : undefined,
      message: annotation.message,
      constraintLabel:
        typeof annotation.constraintLabel === 'string'
          ? annotation.constraintLabel
          : constraintLabel,
      source,
    });
  }

  return dedupeAnnotations(annotations.length > 0 ? annotations : fallback);
}

function sheetAnnotation(message: string): ArtifactProjectionAnnotation {
  return { kind: 'sheet', message, source: 'parse' };
}

function columnAnnotation(columnId: string, message: string): ArtifactProjectionAnnotation {
  return { kind: 'column', columnId, message, source: 'parse' };
}

function scriptRuntimeAnnotation(
  message: string,
  artifactUrl?: AutomergeUrl,
  source: ArtifactProjectionAnnotationSource = 'parse',
  constraintLabel?: string,
): ArtifactProjectionAnnotation {
  return { artifactUrl, kind: 'sheet', message, source, constraintLabel };
}

function dedupeAnnotations(annotations: ArtifactProjectionAnnotation[]) {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    const key = JSON.stringify([
      annotation.artifactUrl,
      annotation.kind,
      annotation.rowId,
      annotation.columnId,
      annotation.message,
      annotation.constraintLabel,
      annotation.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function freezeDocLike(doc: ArtifactDocLike) {
  return deepFreeze({
    title: doc.title,
    facts: cloneFacts(doc.facts),
    draftText: doc.draftText,
  });
}

function freezeProjectionDoc(projectionDoc: ProjectionSpecDoc) {
  return deepFreeze({
    '@patchwork': { ...projectionDoc['@patchwork'] },
    schemaVersion: projectionDoc.schemaVersion,
    artifactDocUrl: projectionDoc.artifactDocUrl,
    sourceType: projectionDoc.sourceType,
    title: projectionDoc.title,
    rows: cloneRowsSpec(projectionDoc.rows),
    columns: projectionDoc.columns.map((column) => cloneColumn(column)),
    verification: projectionDoc.verification ? { ...projectionDoc.verification } : undefined,
  });
}

function freezeExpandedArtifactForScript(expanded: ExpandedArtifactDoc) {
  return deepFreeze({
    title: expanded.title,
    facts: cloneFacts(expanded.facts),
    draftText: expanded.draftText,
    provenanceEntries: expanded.provenanceEntries.map((entry) => ({
      fact: cloneFact(entry.fact),
      anchors: normalizeAnchors(entry.anchors),
    })),
  });
}

function freezeAnnotations(annotations: ArtifactProjectionAnnotation[]) {
  return deepFreeze(annotations.map((annotation) => ({ ...annotation })));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
