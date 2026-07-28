import * as Automerge from "@automerge/automerge";
import type { Doc } from "./datatype";

type Cell = [number, number, number];

// Cube-level diff between the doc at the baseline heads (draft fork point)
// and the live doc. Cubes are identified purely by coordinate, so unlike
// tldraw4's shape diff there is no "changed" bucket — only added/deleted.
export type CubeDiff = {
  added: Set<string>; // "x,y,z" keys of cubes not present at the baseline
  deleted: Cell[]; // baseline cubes no longer present, rendered as ghosts
};

export const cellKey = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;

export function diffCubes(doc: Doc, headsBefore: Automerge.Heads): CubeDiff {
  const before = Automerge.view<Doc>(doc, headsBefore);
  const afterCubes = doc.cubes ?? [];
  const beforeKeys = new Set((before.cubes ?? []).map(cellKey));
  const afterKeys = new Set(afterCubes.map(cellKey));

  const added = new Set<string>();
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) added.add(key);
  }

  const deleted: Cell[] = [];
  for (const c of before.cubes ?? []) {
    if (!afterKeys.has(cellKey(c))) deleted.push([c[0], c[1], c[2]]);
  }

  return { added, deleted };
}
