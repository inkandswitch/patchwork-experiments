// A piece's looks: its own and its `states` (GAME-FORMAT.md §4), each drawn
// as a piece is, by a ref: the kind for its own look, `<kind>#<n>` for its
// n-th state (kind ids never hold a #). The ref is what draws a look, what
// the game's `drawn` keeps it under, and what a table's trait names it by,
// so a state is drawn on demand by the same machinery as a card's face
// (pieces.js). Pure.

/** The scene trait of a thing with states: every look it has, the one it was laid out in, the one it shows now (table/states.js). */
export const STATES = "tabletop.states";

/** A look's ref: the kind for its own (i = 0), `<kind>#<i>` for its i-th state (1 first). */
export const lookRef = (kind, i = 0) => (i > 0 ? `${kind}#${i}` : kind);

/** A ref's kind and which of its looks: { kind, i } (i = 0: its own). */
export function parseRef(ref) {
  const m = /^(.+)#([1-9][0-9]*)$/.exec(String(ref ?? ""));
  return m ? { kind: m[1], i: Number(m[2]) } : { kind: String(ref ?? ""), i: 0 };
}

/**
 * The piece as a ref draws it: the piece itself for its own look, else it
 * with a state's look (its parts or doc, its snap points or else the
 * piece's) and the state's name in place of its own. null if there's none.
 */
export function pieceAt(pieces, ref) {
  const { kind, i } = parseRef(ref);
  const p = pieces?.[kind];
  if (!p || typeof p !== "object") return null;
  if (!i) return p;
  const st = Array.isArray(p.states) ? p.states[i - 1] : null;
  if (!st || typeof st !== "object") return null;
  const { states: _, parts: __, doc: ___, snapPoints, ...rest } = p;
  const snaps = st.snapPoints ?? snapPoints;
  return { ...rest, name: st.name, ...(st.parts ? { parts: st.parts } : {}), ...(st.doc ? { doc: st.doc } : {}), ...(snaps ? { snapPoints: snaps } : {}) };
}

/** A piece's looks' names, its own first. */
export const lookNames = (piece) => [piece?.name, ...(Array.isArray(piece?.states) ? piece.states.map((s) => s?.name) : [])];

/** Which of a piece's looks a name is (0: its own, or no name given), or -1 when it has none so named. */
export function lookIndex(piece, name) {
  if (name == null) return 0;
  return lookNames(piece).indexOf(name);
}

/** Every ref of a kind's looks: its own, then each state's. */
export const refsOf = (pieces, kind) => lookNames(pieces?.[kind]).map((_, i) => lookRef(kind, i));
