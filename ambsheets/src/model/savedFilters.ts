// Filters, as they are kept in the document.
//
// Filters live in the document so that they survive a reload and are shared: everyone
// looking at the sheet sees it narrowed down the same way. In memory a filter on values
// holds a Set; in the document it is a plain list, in a stable order, so that saving the
// same filters twice writes the same thing.

import type { Filter, Filters } from './analysis';

export type SavedFilter =
  | { kind: 'values'; keys: string[] }
  | { kind: 'range'; min: number; max: number };

/** By subject id (a cell's address, or the id of an amb inside a formula). */
export type SavedFilters = Record<string, SavedFilter>;

export function encodeFilters(filters: Filters): SavedFilters {
  const saved: SavedFilters = {};
  for (const id of [...filters.keys()].sort()) {
    const filter = filters.get(id)!;
    saved[id] =
      filter.kind === 'values'
        ? { kind: 'values', keys: [...filter.keys].sort() }
        : { kind: 'range', min: filter.min, max: filter.max };
  }
  return saved;
}

/** Reads filters from a document, ignoring anything that isn't one. */
export function decodeFilters(saved: unknown): Map<string, Filter> {
  const filters = new Map<string, Filter>();
  if (saved === null || typeof saved !== 'object') return filters;
  for (const [id, value] of Object.entries(saved as Record<string, any>)) {
    if (value?.kind === 'values' && Array.isArray(value.keys) && value.keys.length > 0) {
      filters.set(id, { kind: 'values', keys: new Set(value.keys.map(String)) });
    } else if (value?.kind === 'range' && typeof value.min === 'number' && typeof value.max === 'number') {
      filters.set(id, { kind: 'range', min: value.min, max: value.max });
    }
  }
  return filters;
}

/** A string that is the same for the same filters, however they are stored. */
export const filtersSignature = (filters: Filters) => JSON.stringify(encodeFilters(filters));
