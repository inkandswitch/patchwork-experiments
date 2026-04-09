import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { DatalogDoc } from '../verification/model';

export type CsvDoc = {
  '@patchwork': { type: 'csv' };
  title?: string;
  content: string;
};

export type ArtifactProjectionKind = 'rota-shifts-v1';

export type ArtifactSheetAnnotationKind = 'cell' | 'row' | 'column' | 'sheet';
export type ArtifactSheetAnnotationSource = 'parse' | 'constraint';

export type ArtifactSheetAnnotation = {
  artifactUrl?: AutomergeUrl;
  kind: ArtifactSheetAnnotationKind;
  row?: number;
  col?: number;
  message: string;
  constraintLabel?: string;
  source: ArtifactSheetAnnotationSource;
};

export type ArtifactFolderEntry = {
  type: string;
  name: string;
  url: AutomergeUrl;
  csvUrl?: AutomergeUrl;
  projectionKind?: ArtifactProjectionKind;
  specPath?: string;
};

type StoredFact = DatalogDoc['facts'][number];

const SHIFT_HEADERS = [
  'Shift',
  'Ward',
  'Night',
  'Hours',
  'Staff 1',
  'Staff 2',
  'Staff 3',
  'Staff 4',
  'Staff 5',
  'In Charge',
  'Patients',
  'Has HCA',
] as const;

export const ROTA_SHIFT_HEADERS = [...SHIFT_HEADERS];

type ShiftHeader = (typeof SHIFT_HEADERS)[number];

export type RotaShiftProjectionIndex = {
  projectionKind: 'rota-shifts-v1';
  rows: Array<{
    row: number;
    shiftId: string;
    ward: string;
    staff: string[];
  }>;
  rowByShiftId: Map<string, number>;
  rowIndicesByWard: Map<string, number[]>;
  rowIndicesByEmployee: Map<string, number[]>;
  columns: Record<ShiftHeader, number>;
  staffColumnIndices: number[];
};

const DYNAMIC_PREDICATES = new Set([
  'shift',
  'night_shift',
  'ward',
  'assigned',
  'assignment_slot',
  'patients',
  'has_hca',
  'in_charge',
  'employee_rostered_hours',
  'ward_roster',
  'rostered_hours',
]);

export function createArtifactCsvDoc(
  repo: Repo,
  title: string,
  datalogDoc: DatalogDoc,
): AutomergeUrl {
  const handle = repo.create<CsvDoc>();
  const projection = projectDatalogArtifactToCsv('rota-shifts-v1', datalogDoc, title);
  handle.change((d) => {
    d['@patchwork'] = { type: 'csv' };
    d.title = projection.title;
    d.content = projection.content;
  });
  return handle.url;
}

export function projectDatalogArtifactToCsv(
  projectionKind: ArtifactProjectionKind,
  datalogDoc: DatalogDoc,
  artifactName: string,
): { title: string; content: string } {
  if (projectionKind !== 'rota-shifts-v1') {
    throw new Error(`Unsupported projection kind: ${projectionKind}`);
  }

  const shifts = extractShiftRows(datalogDoc);
  const rows = [
    [...SHIFT_HEADERS],
    ...shifts.map((shift) => [
      shift.shiftId,
      shift.ward,
      shift.night ? 'yes' : 'no',
      shift.hours,
      ...pad(shift.staff, 5),
      shift.inCharge,
      shift.patients,
      shift.hasHca ? 'yes' : 'no',
    ]),
  ];

  return {
    title: `${artifactName} Table`,
    content: serializeCsv(rows),
  };
}

export function applyCsvToDatalogArtifact(
  projectionKind: ArtifactProjectionKind,
  csvContent: string,
  priorDoc: DatalogDoc,
  artifactName: string,
  artifactUrl?: AutomergeUrl,
):
  | { ok: true; doc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'> }
  | { ok: false; error: string; annotations: ArtifactSheetAnnotation[] } {
  if (projectionKind !== 'rota-shifts-v1') {
    return {
      ok: false,
      error: `Unsupported projection kind: ${projectionKind}`,
      annotations: [
        {
          artifactUrl,
          kind: 'sheet',
          message: `Unsupported projection kind: ${projectionKind}`,
          source: 'parse',
        },
      ],
    };
  }

  const rows = parseCsv(csvContent);
  if (rows.length === 0) {
    return {
      ok: false,
      error: 'CSV is empty. Add a header row and at least one shift row.',
      annotations: [
        {
          artifactUrl,
          kind: 'sheet',
          message: 'CSV is empty. Add a header row and at least one shift row.',
          source: 'parse',
        },
      ],
    };
  }

  const header = rows[0].map((cell) => cell.trim());
  if (!sameHeaders(header, SHIFT_HEADERS as unknown as string[])) {
    const annotations: ArtifactSheetAnnotation[] = SHIFT_HEADERS.flatMap((expected, index) => {
      if (header[index] === expected) return [];
      return [
        {
          artifactUrl,
          kind: 'column',
          col: index,
          message: `Expected header "${expected}" but found "${header[index] || '(blank)'}".`,
          source: 'parse',
        },
      ];
    });
    return {
      ok: false,
      error: `CSV headers must remain: ${SHIFT_HEADERS.join(', ')}`,
      annotations,
    };
  }

  const dynamicFacts: StoredFact[] = [];
  const staticFacts = priorDoc.facts.filter((fact) => !DYNAMIC_PREDICATES.has(fact.pred));
  const wardHours = new Map<string, number>();
  const employeeHours = new Map<string, number>();
  const seenWards = new Set<string>();

  for (const rawRow of rows.slice(1)) {
    const row = pad(
      rawRow.map((cell) => cell.trim()),
      SHIFT_HEADERS.length,
    );
    const shiftId = row[0];
    if (!shiftId) continue;

    const ward = row[1];
    if (!ward) {
      return {
        ok: false,
        error: `Shift "${shiftId}" is missing a ward.`,
        annotations: [
          buildCellAnnotation(
            artifactUrl,
            rowIndexForShiftRows(rows, rawRow),
            1,
            `Shift "${shiftId}" is missing a ward.`,
          ),
        ],
      };
    }

    const night = parseBoolean(row[2]);
    if (night == null) {
      return {
        ok: false,
        error: `Shift "${shiftId}" has invalid Night value "${row[2]}".`,
        annotations: [
          buildCellAnnotation(
            artifactUrl,
            rowIndexForShiftRows(rows, rawRow),
            2,
            `Shift "${shiftId}" has invalid Night value "${row[2]}".`,
          ),
        ],
      };
    }

    const hours = parseInteger(row[3], `Shift "${shiftId}" has invalid Hours value "${row[3]}".`);
    if (typeof hours === 'string') {
      return {
        ok: false,
        error: hours,
        annotations: [
          buildCellAnnotation(artifactUrl, rowIndexForShiftRows(rows, rawRow), 3, hours),
        ],
      };
    }

    const staff = row.slice(4, 9).filter(Boolean);
    if (staff.length === 0) {
      return {
        ok: false,
        error: `Shift "${shiftId}" must include at least one assigned staff member.`,
        annotations: [
          {
            artifactUrl,
            kind: 'row',
            row: rowIndexForShiftRows(rows, rawRow),
            message: `Shift "${shiftId}" must include at least one assigned staff member.`,
            source: 'parse',
          },
        ],
      };
    }

    const inCharge = row[9];
    const patients = row[10];
    const hasHca = parseBoolean(row[11]);
    if (hasHca == null) {
      return {
        ok: false,
        error: `Shift "${shiftId}" has invalid Has HCA value "${row[11]}".`,
        annotations: [
          buildCellAnnotation(
            artifactUrl,
            rowIndexForShiftRows(rows, rawRow),
            11,
            `Shift "${shiftId}" has invalid Has HCA value "${row[11]}".`,
          ),
        ],
      };
    }

    dynamicFacts.push(f('shift', shiftId));
    dynamicFacts.push(f('ward', shiftId, ward));
    if (night) dynamicFacts.push(f('night_shift', shiftId));
    for (const [index, person] of staff.entries()) {
      dynamicFacts.push(f('assigned', shiftId, person, hours));
      dynamicFacts.push(f('assignment_slot', shiftId, index + 1, person));
      employeeHours.set(person, (employeeHours.get(person) ?? 0) + hours);
    }
    if (inCharge) dynamicFacts.push(f('in_charge', shiftId, inCharge));
    if (patients) {
      const parsedPatients = parseInteger(
        patients,
        `Shift "${shiftId}" has invalid Patients value "${patients}".`,
      );
      if (typeof parsedPatients === 'string') {
        return {
          ok: false,
          error: parsedPatients,
          annotations: [
            buildCellAnnotation(
              artifactUrl,
              rowIndexForShiftRows(rows, rawRow),
              10,
              parsedPatients,
            ),
          ],
        };
      }
      dynamicFacts.push(f('patients', shiftId, parsedPatients));
    }
    if (hasHca) dynamicFacts.push(f('has_hca', shiftId));

    seenWards.add(ward);
    wardHours.set(ward, (wardHours.get(ward) ?? 0) + staff.length * hours);
  }

  for (const ward of seenWards) {
    dynamicFacts.unshift(f('rostered_hours', ward, wardHours.get(ward) ?? 0));
    dynamicFacts.unshift(f('ward_roster', ward));
  }
  for (const [employee, totalHours] of [...employeeHours.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    dynamicFacts.unshift(f('employee_rostered_hours', employee, totalHours));
  }

  const facts = [...staticFacts, ...dynamicFacts];
  return {
    ok: true,
    doc: {
      title: artifactName,
      facts,
      draftText: buildDatalogDraft(artifactName, staticFacts, dynamicFacts),
    },
  };
}

export function getArtifactSyncSignature(
  doc: Pick<DatalogDoc, 'title' | 'facts' | 'draftText'>,
): string {
  return JSON.stringify({
    title: doc.title ?? '',
    facts: doc.facts,
    draftText: doc.draftText ?? '',
  });
}

function extractShiftRows(datalogDoc: DatalogDoc) {
  const shiftIds = datalogDoc.facts
    .filter((fact) => fact.pred === 'shift')
    .map((fact) => String(fact.args[0]));

  return shiftIds.map((shiftId) => {
    const ward = findFactArg(datalogDoc.facts, 'ward', shiftId, 1) ?? '';
    const night = datalogDoc.facts.some(
      (fact) => fact.pred === 'night_shift' && String(fact.args[0]) === shiftId,
    );
    const assignments = datalogDoc.facts.filter(
      (fact) => fact.pred === 'assigned' && String(fact.args[0]) === shiftId,
    );
    const staff = assignments.map((fact) => String(fact.args[1]));
    const hours = assignments[0] ? String(assignments[0].args[2]) : '';
    const inCharge = findFactArg(datalogDoc.facts, 'in_charge', shiftId, 1) ?? '';
    const patients = findFactArg(datalogDoc.facts, 'patients', shiftId, 1) ?? '';
    const hasHca = datalogDoc.facts.some(
      (fact) => fact.pred === 'has_hca' && String(fact.args[0]) === shiftId,
    );

    return {
      shiftId,
      ward,
      night,
      hours,
      staff,
      inCharge,
      patients,
      hasHca,
    };
  });
}

export function buildProjectionIndexFromCsvContent(
  projectionKind: ArtifactProjectionKind,
  csvContent: string,
): RotaShiftProjectionIndex | null {
  if (projectionKind !== 'rota-shifts-v1') return null;
  const rows = parseCsv(csvContent);
  if (rows.length === 0) return null;

  const columns = Object.fromEntries(
    SHIFT_HEADERS.map((header, index) => [header, index]),
  ) as Record<ShiftHeader, number>;
  const rowByShiftId = new Map<string, number>();
  const rowIndicesByWard = new Map<string, number[]>();
  const rowIndicesByEmployee = new Map<string, number[]>();
  const projectionRows: RotaShiftProjectionIndex['rows'] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const row = pad(rows[rowIndex].map((cell) => cell.trim()), SHIFT_HEADERS.length);
    const shiftId = row[0];
    if (!shiftId) continue;
    const ward = row[1];
    const staff = row.slice(4, 9).filter(Boolean);
    projectionRows.push({ row: rowIndex, shiftId, ward, staff });
    rowByShiftId.set(shiftId, rowIndex);
    if (ward) {
      rowIndicesByWard.set(ward, [...(rowIndicesByWard.get(ward) ?? []), rowIndex]);
    }
    for (const person of staff) {
      rowIndicesByEmployee.set(person, [...(rowIndicesByEmployee.get(person) ?? []), rowIndex]);
    }
  }

  return {
    projectionKind: 'rota-shifts-v1',
    rows: projectionRows,
    rowByShiftId,
    rowIndicesByWard,
    rowIndicesByEmployee,
    columns,
    staffColumnIndices: [4, 5, 6, 7, 8],
  };
}

function findFactArg(
  facts: StoredFact[],
  predicate: string,
  firstArg: string,
  argIndex: number,
): string | undefined {
  const fact = facts.find(
    (entry) => entry.pred === predicate && String(entry.args[0]) === firstArg,
  );
  return fact ? String(fact.args[argIndex]) : undefined;
}

function f(pred: string, ...args: (string | number)[]): StoredFact {
  return { pred, args };
}

function parseBoolean(value: string): boolean | null {
  if (!value) return false;
  if (['yes', 'true', '1'].includes(value.toLowerCase())) return true;
  if (['no', 'false', '0'].includes(value.toLowerCase())) return false;
  return null;
}

function parseInteger(value: string, errorMessage: string): number | string {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : errorMessage;
}

function sameHeaders(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pad<T>(values: T[], length: number, fillValue = '' as T): T[] {
  return [
    ...values,
    ...Array.from({ length: Math.max(0, length - values.length) }, () => fillValue),
  ].slice(0, length);
}

export function parseCsv(content: string): string[][] {
  if (!content.trim()) return [];
  const rows: string[][] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.trim() === '') continue;
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    rows.push(cells);
  }
  return rows;
}

export function serializeCsv(rows: (string | number)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return '"' + value.replace(/"/g, '""') + '"';
          }
          return value;
        })
        .join(','),
    )
    .join('\n');
}

function buildDatalogDraft(
  title: string,
  staticFacts: StoredFact[],
  dynamicFacts: StoredFact[],
): string {
  const lines = [`% ${title}`];
  if (staticFacts.length > 0) {
    lines.push(...staticFacts.map(serializeFact));
    lines.push('');
  }
  lines.push('% Shift assignments');
  lines.push(...dynamicFacts.map(serializeFact));
  return lines.join('\n');
}

function serializeFact(fact: StoredFact): string {
  return `${fact.pred}(${fact.args.join(', ')}).`;
}

function buildCellAnnotation(
  artifactUrl: AutomergeUrl | undefined,
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
    source: 'parse',
  };
}

function rowIndexForShiftRows(rows: string[][], targetRow: string[]): number {
  return Math.max(1, rows.indexOf(targetRow));
}
