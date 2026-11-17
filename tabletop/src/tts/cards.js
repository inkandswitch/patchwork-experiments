// Cards: which cell of which sheet a card shows. Pure.
//
// A custom deck is a sheet of NumWidth × NumHeight cells (TTS's template is
// 10 × 7, the last cell being the "hidden" face shown to other players),
// counted row by row from the top left. A card's CardID is deckKey * 100 +
// cell, the deckKey naming an entry of CustomDeck (KB, save-file format: "Key
// matches the hundreth place of the id (ex. id = 354, index = 3)"). The back is
// the whole BackURL image, or with UniqueBack the same cell of a back sheet.

/** CardID → { deckKey, index }. */
export function cardCell(cardId) {
  const id = Math.max(0, Math.round(Number(cardId) || 0));
  return { deckKey: Math.floor(id / 100), index: id % 100 };
}

/**
 * The cell's rectangle on its sheet, as fractions of the sheet with the origin
 * top left: { x, y, w, h, col, row }. An index past the sheet's last cell is
 * clamped to it (and reported as `clamped`).
 */
export function cellRect(index, numWidth, numHeight) {
  const cols = Math.max(1, Math.round(Number(numWidth) || 1));
  const rows = Math.max(1, Math.round(Number(numHeight) || 1));
  const i = Math.max(0, Math.round(Number(index) || 0));
  const last = cols * rows - 1;
  const k = Math.min(i, last);
  const col = k % cols;
  const row = Math.floor(k / cols);
  return { x: col / cols, y: row / rows, w: 1 / cols, h: 1 / rows, col, row, clamped: i > last };
}

const FULL = { x: 0, y: 0, w: 1, h: 1 };

/**
 * A card's two faces: { face: { url, rect }, back: { url, rect }, shape } or
 * null without a deck entry. `rect` is a cellRect (FULL for a whole image).
 */
export function cardFaces(cardId, entry) {
  if (!entry) return null;
  const { index } = cardCell(cardId);
  const face = cellRect(index, entry.NumWidth, entry.NumHeight);
  const back = entry.UniqueBack ? cellRect(index, entry.NumWidth, entry.NumHeight) : FULL;
  return {
    face: { url: String(entry.FaceURL ?? "").trim(), rect: face },
    back: { url: String(entry.BackURL ?? "").trim(), rect: { x: back.x, y: back.y, w: back.w, h: back.h } },
    // CustomDeck.Type: the card's shape (0 rectangle, 1 rectangle?, 2/3 hex, 4/5 circle). Only rectangles are drawn as such.
    shape: Number(entry.Type) || 0,
    clamped: face.clamped,
  };
}
