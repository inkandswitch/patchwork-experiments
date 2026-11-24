// Where the aboard setup (aboard-probe.html) puts the parts bin's Card table
// in the stock sloop's cockpit, and the room it takes there: one place for
// the probe and for her deck export (export-deck.mjs), which says that her
// mainsheet's stand spot stays put beside it. No imports: the probe page
// loads it as it is.

/** Where the Card table goes, in her hull's frame: between the benches, forward of the wheel, its long side across her. */
export const COCKPIT_TABLE = { position: [0, 0.72, 2.85], rotation: [0, Math.PI / 2, 0], scale: 1 };
/** The middle of the Card table's top, in its frame (tabletop's TABLE.h, and the baize). */
export const TABLE_TOP = [0, 0.7006, 0];
/** tabletop's TABLE (tabletop/src/table/parts.js), a copy: w along its x, l along its z, h its top. */
const TABLE = { w: 0.76, l: 1.2, h: 0.7 };

/**
 * The room the table takes, as boxes [min, max] in her hull's frame: its top
 * (6 cm deep, a bound on its 3) and four legs 6 cm square, 8 cm in from its
 * corners. Turned a quarter, its l lies across her.
 */
export function cockpitTableBoxes() {
  const [cx, y0, cz] = COCKPIT_TABLE.position;
  const [hx, hz] = [TABLE.l / 2, TABLE.w / 2];
  const [x0, x1, z0, z1, top] = [cx - hx, cx + hx, cz - hz, cz + hz, y0 + TABLE.h];
  const legs = [[x0 + 0.08, z0 + 0.08], [x1 - 0.08, z0 + 0.08], [x0 + 0.08, z1 - 0.08], [x1 - 0.08, z1 - 0.08]];
  return [[[x0, top - 0.06, z0], [x1, top, z1]], ...legs.map(([x, z]) => [[x - 0.03, y0, z - 0.03], [x + 0.03, top - 0.06, z + 0.03]])];
}
