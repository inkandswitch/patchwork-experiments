import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { ConstraintViolation } from '../verification/datalog-eval';
import type { VerificationConstraintResult } from '../verification/model';
import {
  buildProjectionIndexFromCsvContent,
  type ArtifactProjectionKind,
  type ArtifactSheetAnnotation,
} from './csv-sync';

type ConstraintCarrier = {
  constraintLabel: string;
  violations: ConstraintViolation[];
};

export function deriveConstraintAnnotationsForArtifact(
  artifactUrl: AutomergeUrl,
  projectionKind: ArtifactProjectionKind | undefined,
  csvContent: string,
  constraints: Array<ConstraintCarrier | VerificationConstraintResult>,
): ArtifactSheetAnnotation[] {
  if (!projectionKind) return [];
  const index = buildProjectionIndexFromCsvContent(projectionKind, csvContent);
  if (!index) return [];

  const annotations: ArtifactSheetAnnotation[] = [];

  for (const constraint of constraints) {
    const constraintLabel = 'constraintLabel' in constraint ? constraint.constraintLabel : constraint.label;
    for (const violation of constraint.violations) {
      const mapped = mapViolation(artifactUrl, constraintLabel, violation, index);
      annotations.push(...mapped);
    }
  }

  return dedupeAnnotations(annotations);
}

function mapViolation(
  artifactUrl: AutomergeUrl,
  constraintLabel: string,
  violation: ConstraintViolation,
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
): ArtifactSheetAnnotation[] {
  const annotations: ArtifactSheetAnnotation[] = [];
  let touchedArtifact = false;

  for (const witness of violation.witnesses) {
    const witnessRows = new Set<number>();
    const witnessCells = new Map<number, Set<number>>();

    for (const step of witness.steps) {
      if (step.kind !== 'fact') continue;
      const references = mapFactToReferences(
        artifactUrl,
        constraintLabel,
        step.fact.pred,
        step.fact.args.map((value) => String(value)),
        index,
      );
      if (references.length > 0) {
        touchedArtifact = true;
        for (const reference of references) {
          if (reference.row == null) continue;
          witnessRows.add(reference.row);
          if (reference.col == null) continue;
          if (!witnessCells.has(reference.row)) witnessCells.set(reference.row, new Set());
          witnessCells.get(reference.row)!.add(reference.col);
        }
      }
    }

    for (const value of Object.values(witness.bindings)) {
      if (index.rowByShiftId.has(String(value))) touchedArtifact = true;
      if (index.rowIndicesByWard.has(String(value))) touchedArtifact = true;
      if (index.rowIndicesByEmployee.has(String(value))) touchedArtifact = true;
    }

    if (witnessRows.size === 1) {
      const [row] = [...witnessRows];
      const cols = [...(witnessCells.get(row) ?? new Set<number>())];
      if (cols.length === 1) {
        annotations.push(cellAnnotation(artifactUrl, row, cols[0], constraintLabel));
      } else {
        annotations.push(rowAnnotation(artifactUrl, row, constraintLabel));
      }
      continue;
    }

    if (witnessRows.size > 1) {
      for (const row of witnessRows) {
        annotations.push(rowAnnotation(artifactUrl, row, constraintLabel));
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

function mapFactToReferences(
  _artifactUrl: AutomergeUrl,
  _constraintLabel: string,
  predicate: string,
  args: string[],
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
): Array<{ row?: number; col?: number }> {
  const shiftId = args[0];
  const row = shiftId ? index.rowByShiftId.get(shiftId) : undefined;

  switch (predicate) {
    case 'shift':
      return row == null ? [] : [{ row }];
    case 'ward':
      return row == null
        ? rowsForWard(args[1], index)
        : [{ row, col: index.columns.Ward }];
    case 'night_shift':
      return row == null ? [] : [{ row, col: index.columns.Night }];
    case 'patients':
      return row == null ? [] : [{ row, col: index.columns.Patients }];
    case 'has_hca':
      return row == null ? [] : [{ row, col: index.columns['Has HCA'] }];
    case 'in_charge':
      return row == null
        ? rowsForEmployee(args[1], index)
        : [{ row, col: index.columns['In Charge'] }];
    case 'assigned':
      return row == null ? rowsForEmployee(args[1], index) : mapAssigned(row, args[1], index);
    case 'assignment_slot':
      return row == null ? [] : mapAssignmentSlot(row, args[1], index);
    case 'employee_rostered_hours':
      return rowsForEmployee(args[0], index);
    case 'ward_roster':
    case 'rostered_hours':
      return rowsForWard(args[0], index);
    default:
      return row == null ? [] : [{ row }];
  }
}

function mapAssigned(
  row: number,
  person: string | undefined,
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
) {
  if (!person) return [{ row }];
  const rowEntry = index.rows.find((entry) => entry.row === row);
  const slot = rowEntry?.staff.findIndex((entry) => entry === person) ?? -1;
  if (slot >= 0) {
    return [{ row, col: index.staffColumnIndices[slot] }];
  }
  return [{ row }];
}

function mapAssignmentSlot(
  row: number,
  slotValue: string | undefined,
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
) {
  const slot = Number(slotValue);
  if (!Number.isFinite(slot) || slot < 1 || slot > index.staffColumnIndices.length) {
    return [{ row }];
  }
  return [{ row, col: index.staffColumnIndices[slot - 1] }];
}

function rowsForWard(
  ward: string | undefined,
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
) {
  if (!ward) return [];
  return (index.rowIndicesByWard.get(ward) ?? []).map((row) => ({ row }));
}

function rowsForEmployee(
  employee: string | undefined,
  index: NonNullable<ReturnType<typeof buildProjectionIndexFromCsvContent>>,
) {
  if (!employee) return [];
  return (index.rowIndicesByEmployee.get(employee) ?? []).map((row) => ({ row }));
}

function cellAnnotation(
  artifactUrl: AutomergeUrl,
  row: number,
  col: number,
  message: string,
): ArtifactSheetAnnotation {
  return {
    artifactUrl,
    kind: 'cell',
    row,
    col,
    message,
    constraintLabel: message,
    source: 'constraint',
  };
}

function rowAnnotation(
  artifactUrl: AutomergeUrl,
  row: number,
  message: string,
): ArtifactSheetAnnotation {
  return {
    artifactUrl,
    kind: 'row',
    row,
    message,
    constraintLabel: message,
    source: 'constraint',
  };
}

function dedupeAnnotations(annotations: ArtifactSheetAnnotation[]) {
  const seen = new Set<string>();
  return annotations.filter((annotation) => {
    const key = JSON.stringify([
      annotation.kind,
      annotation.row ?? null,
      annotation.col ?? null,
      annotation.message,
      annotation.constraintLabel ?? null,
      annotation.source,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
