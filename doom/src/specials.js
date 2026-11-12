// What a map's specials do to it, as far as this package imports them. Pure.
//
// Doom puts an action on a LINE (used, walked over, shot) and the motion on
// the SECTORS it acts on: those tagged like the line, or, for a door used
// directly ("D" doors), the sector behind it. Here every line special is
// sorted into what it does (the vanilla set, linedef types 1–141, from the
// Unofficial Doom Specs and the Doom wiki's linedef table), and the sectors
// that move are found from it.
//
// Imported as working: PLAIN DOORS, the sectors that only "D" door lines
// open (used from either side, no key): 1 and 117 open, wait and close, 31
// and 118 open and stay. Everything else that moves a sector (lifts, floors,
// stairs, ceilings, crushers, locked doors, doors worked from a distance by
// switches or tripwires) is imported where it rests and listed as not
// working here, with the rest of the specials (lights, teleporters,
// scrolling walls, exits walked over).
//
// EXIT SWITCHES (11, and the secret exit's 51) are pulled out as parts of
// their own: the line's walls, an object a scene can make lead elsewhere.

/** What each vanilla line special does: [kind, how it's triggered]. */
const KIND = {};
const put = (kind, list) => list.forEach((n) => (KIND[n] = kind));
put("door", [1, 31, 117, 118]); // used directly, no key
put("locked door", [26, 27, 28, 32, 33, 34, 99, 133, 134, 135, 136, 137]);
put("remote door", [2, 3, 4, 16, 29, 42, 46, 50, 61, 63, 75, 76, 86, 90, 103, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116]);
put("lift", [10, 14, 15, 20, 21, 22, 47, 53, 62, 66, 67, 68, 87, 88, 95, 120, 121, 122, 123]);
put("floor", [5, 9, 18, 19, 23, 30, 36, 37, 38, 45, 55, 56, 58, 59, 60, 64, 65, 69, 70, 71, 82, 83, 84, 91, 92, 93, 94, 96, 98, 101, 102, 119, 128, 129, 130, 131, 132, 140]);
put("stairs", [7, 8, 100, 127]);
put("ceiling", [40, 41, 43, 44]);
put("crusher", [6, 25, 49, 73, 77, 141]);
put("stop", [54, 57, 74, 89]);
put("light", [12, 13, 17, 35, 79, 80, 81, 104, 138, 139]);
put("exit switch", [11, 51]);
put("exit", [52, 124]); // walked over: a tripwire, not something used
put("teleporter", [39, 97, 125, 126]);
put("scrolling wall", [48]);

/** Doors used directly act on the sector behind the line; everything else, on the line's tag. */
const DIRECT = new Set([1, 26, 27, 28, 31, 32, 33, 34, 117, 118]);
/** The exit switches: the line is the part (the secret exit, 51, leads somewhere else in Doom). */
export const EXIT_SWITCHES = { 11: { secret: false }, 51: { secret: true } };
/** The kinds that move sectors. */
const MOVES = new Set(["door", "locked door", "remote door", "lift", "floor", "stairs", "ceiling", "crusher"]);

/** Doom's door speeds (map units per tic: 35 tics a second) and its wait (tics), from the specs. */
export const TICS = 35;
const DOOR_SPEED = 2;
const DOOR_WAIT = 150;
/** For each plain door special: how fast it moves (units per second) and how long it waits open before closing (s; null: it stays open). */
export const PLAIN_DOORS = {
  1: { speed: DOOR_SPEED * TICS, wait: DOOR_WAIT / TICS },
  31: { speed: DOOR_SPEED * TICS, wait: null },
  117: { speed: DOOR_SPEED * 4 * TICS, wait: DOOR_WAIT / TICS },
  118: { speed: DOOR_SPEED * 4 * TICS, wait: null },
};

/** Sector specials that move a sector on their own (a door closing after 30 s; one opening after 5 min). */
const SECTOR_MOVES = { 10: "door that closes on its own", 14: "door that opens on its own" };

export const kindOf = (special) => (special ? (KIND[special] ?? "unknown special") : null);

/** The sectors around sector `s` (across its two-sided lines). */
export function neighbours(map, s) {
  const out = new Set();
  for (const l of map.linedefs) {
    if (l.left < 0) continue;
    const f = map.sidedefs[l.right].sector;
    const b = map.sidedefs[l.left].sector;
    if (f === s && b !== s) out.add(b);
    if (b === s && f !== s) out.add(f);
  }
  return [...out];
}

/** Where a door opens to: the lowest ceiling around it, less 4 (Doom's EV_VerticalDoor). null when it has nothing around it. */
export function doorTop(map, s) {
  const around = neighbours(map, s);
  if (!around.length) return null;
  return Math.min(...around.map((n) => map.sectors[n].ceiling)) - 4;
}

/**
 * Sort the map's specials.
 * A door shuts to its floor (Doom's T_VerticalDoor), so that is its closed
 * height whatever its ceiling is at rest; one a map leaves ajar (its ceiling
 * between its floor and where it opens to) says by how much, `ajar` (units),
 * and is imported shut.
 * @returns {{
 *   doors: { sector: number, closed: number, open: number, ajar: number, speed: number, wait: number | null, lines: number[] }[],
 *   resting: { kind: string, sectors: number[], lines: number[] }[],   // moving parts imported where they rest
 *   inert: { kind: string, lines: number[] }[],                         // specials that move nothing, not imported
 *   exits: { line: number, secret: boolean }[],                        // exit switches: parts of their own
 *   starts: { player: number, thing: number }[],                        // player 1–4 starts (things 1–4)
 * }}
 */
export function classify(map) {
  const tagged = new Map(); // tag → sectors
  map.sectors.forEach((sec, i) => {
    if (sec.tag) (tagged.get(sec.tag) ?? tagged.set(sec.tag, []).get(sec.tag)).push(i);
  });
  // sector → the line specials that act on it
  const actsOn = new Map();
  const inertByKind = new Map();
  const exits = [];
  map.linedefs.forEach((l, i) => {
    const kind = kindOf(l.special);
    if (!kind) return;
    if (EXIT_SWITCHES[l.special]) {
      exits.push({ line: i, secret: EXIT_SWITCHES[l.special].secret });
      return;
    }
    if (!MOVES.has(kind)) {
      (inertByKind.get(kind) ?? inertByKind.set(kind, []).get(kind)).push(i);
      return;
    }
    const sectors = DIRECT.has(l.special) ? (l.left >= 0 ? [map.sidedefs[l.left].sector] : []) : (tagged.get(l.tag) ?? []);
    for (const s of sectors) (actsOn.get(s) ?? actsOn.set(s, []).get(s)).push({ line: i, special: l.special, kind });
  });
  map.sectors.forEach((sec, s) => {
    if (SECTOR_MOVES[sec.special]) (actsOn.get(s) ?? actsOn.set(s, []).get(s)).push({ line: null, special: null, kind: SECTOR_MOVES[sec.special] });
  });

  const doors = [];
  const restingByKind = new Map();
  for (const [s, acts] of [...actsOn].sort((a, b) => a[0] - b[0])) {
    const sec = map.sectors[s];
    const open = doorTop(map, s);
    const plain = acts.every((a) => PLAIN_DOORS[a.special]) && open != null && open > sec.ceiling;
    if (plain) {
      // the first line's speed and wait (the lines of one door agree in every vanilla map)
      const { speed, wait } = PLAIN_DOORS[acts[0].special];
      doors.push({ sector: s, closed: sec.floor, open, ajar: sec.ceiling - sec.floor, speed, wait, lines: acts.map((a) => a.line) });
      continue;
    }
    // named for what moves it that isn't a plain door: a locked door is a locked door even if a plain line opens it too
    const kind = acts.find((a) => !PLAIN_DOORS[a.special])?.kind ?? "door already open";
    const r = restingByKind.get(kind) ?? restingByKind.set(kind, { kind, sectors: [], lines: new Set() }).get(kind);
    r.sectors.push(s);
    for (const a of acts) if (a.line != null) r.lines.add(a.line);
  }
  const starts = [];
  map.things.forEach((t, i) => {
    if (t.type >= 1 && t.type <= 4) starts.push({ player: t.type, thing: i });
  });
  return {
    doors,
    resting: [...restingByKind.values()].map((r) => ({ kind: r.kind, sectors: r.sectors, lines: [...r.lines].sort((a, b) => a - b) })),
    inert: [...inertByKind].map(([kind, lines]) => ({ kind, lines })),
    exits,
    starts,
  };
}
