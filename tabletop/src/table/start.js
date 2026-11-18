// Start game: a table's start steps (GAME-FORMAT.md §6, the recipe's
// `start`), run once every seat is taken. The table writer resolved them to
// this table's objects when it laid the table out (setup.js startPlan), into
// the scene's trait `tabletop.start`:
//
//   { steps: [ { shuffle: [id…] }                  the deck's cards, mixed by their keeper
//            | { deal: n, moves: [[id, transform]…] }  n into each seat's hands, each card into a slot
//            | { draw: n, moves: [[id, transform]…] }  n face up onto a thing's snap points
//            | { first: true } ],                   who goes first, one of the seats at random
//     started: null | { first?: seatId } }
//
// What a card is stays its keeper's: a deal moves objects, whatever they
// turn out to be, and the table's rule (visibility.js) shows each in a hand
// to that hand's seat alone. A shuffle goes through the card's keeper (the
// plain one permutes its slots; the joint one queues a shuffle every player
// takes part in). Everything Start writes to the scene is one change, with
// `started`, so pressing it twice, or on two peers at once, deals once: the
// second sees it started (and two at once each move the same cards to the
// same places; the merge keeps one `started`, and so one first player, which
// the HUD reads from the doc). Like the table's other verbs it isn't on the
// editor's undo (scene/EDITOR.md, "Undo").
//
// Who goes first is drawn by the client that starts the game, in the open
// (Math.random): fair against an honest client only. Drawing it by lots, as
// a die's roll is, is later work.

/** The scene's trait (setup.js START). */
export const START = "tabletop.start";

/** A table's start, as its trait has it, or null where it has none. */
export function startOf(scene) {
  const s = scene?.traits?.[START];
  return s && Array.isArray(s.steps) ? s : null;
}

/** The seats nobody has taken, by name. */
const open = (seats) => (seats ?? []).filter((s) => !s?.viewer).map((s) => s?.name || s?.id);

/**
 * Start game's state for the scene (the null target): null where the table
 * has no start; disabled once started, or while a seat is empty (saying
 * which); else ready.
 * @param {object} scene  @param {{ id, name?, viewer }[]} seats  the roster's
 */
export function startState(scene, seats) {
  const s = startOf(scene);
  if (!s) return null;
  if (s.started) return { disabled: true, label: "Game started", title: "This game has started" };
  const waiting = open(seats);
  if (waiting.length) return { disabled: true, title: `Every seat must be taken to start: waiting for ${waiting.join(", ")}` };
  return { title: startTitle(s.steps) };
}

/** What Start will do, in words. */
function startTitle(steps) {
  const words = steps.flatMap((x) => (x.shuffle ? ["shuffle"] : x.deal ? [`deal ${x.deal} to each seat`] : x.draw ? [`lay out ${x.draw}`] : x.first ? ["choose who goes first"] : []));
  return words.length ? `Start the game: ${words.join(", ")}` : "Start the game";
}

/**
 * Run a table's start: each shuffle through its cards' keeper, then every
 * move and `started` in one change. Nothing when it's started already, or a
 * seat is empty.
 * @param {{ scene: object, seats: object[], keeperOf: (id: string) => { shuffle(ids): number } | null,
 *   change: (fn: (d: object) => void) => unknown, setTransform: (scene: object, id: string, t: object) => ((d: object) => void) | null,
 *   random?: () => number }} o
 * @returns {{ dealt: number, moved: number, first: string | null } | null}  null when it didn't start
 */
export function runStart({ scene, seats, keeperOf, change, setTransform, random = Math.random }) {
  const s = startOf(scene);
  if (!s || s.started || open(seats).length) return null;
  let dealt = 0;
  let first = null;
  const writes = [];
  for (const step of s.steps) {
    if (step.shuffle) {
      const ids = step.shuffle.filter((id) => scene.objects?.[id]);
      if (ids.length > 1) keeperOf(ids[0])?.shuffle?.(ids);
    } else if (step.moves) {
      if (step.deal) dealt = Math.max(dealt, step.deal);
      for (const [id, t] of step.moves) {
        if (!scene.objects?.[id]) continue;
        const scale = Number(scene.objects[id].transform?.scale) || 1;
        const w = setTransform(scene, id, { position: [...t.position], rotation: [...(t.rotation ?? [0, 0, 0])], scale });
        if (w) writes.push(w);
      }
    } else if (step.first && seats.length) first = seats[Math.floor(random() * seats.length)]?.id ?? null;
  }
  change((d) => {
    const trait = d.traits?.[START];
    if (!trait || trait.started) return;
    for (const w of writes) w(d);
    trait.started = first ? { first } : {};
  });
  return { dealt, moved: writes.length, first };
}

/** The HUD's line once started with a first player: who goes first, by the seat's name. */
export function startLine(scene, seats) {
  const first = startOf(scene)?.started?.first;
  if (!first) return null;
  const seat = (seats ?? []).find((x) => x.id === first);
  return seat ? `${seat.name || seat.id} goes first.` : null;
}
