// Test helper: build sheet data from { address: text }.
import { posOf } from '../src/lang/values';

export function sheet(cells: Record<string, string>, rows = 20, cols = 8): (string | null)[][] {
  const data: (string | null)[][] = Array.from({ length: rows }, () => new Array(cols).fill(null));
  for (const [addr, text] of Object.entries(cells)) {
    const { row, col } = posOf(addr);
    data[row][col] = text;
  }
  return data;
}

export const BUDGET = {
  A3: 'Car',
  B3: '{500, 1200}',
  A4: 'Apartment',
  B4: '{2800, 3700, 4200}',
  A5: 'Netflix',
  B5: '18',
  A7: 'TOTAL',
  B7: 'total = SUM(B3:B5)',
  A8: 'Can afford?',
  B8: '=total <= 4200',
};
