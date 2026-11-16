// A stopped machine's screen is never black.
//
// A machine stopped where its last player left it shows that state's
// picture: the host restores the newest checkpoint and steps the inputs after
// it to the stop, so the picture is the last one played. But a state can draw
// nothing worth seeing: a session made and never played is at tick 0, where
// Doom has drawn nothing yet (all black) and a Super NES nothing at all (0 by
// 0) until its seventh frame; and a game can stop on a black frame between
// scenes. A screen like that reads as broken, not stopped.
//
// So a stopped screen whose picture is blank (nothing, or one colour all
// over) shows a poster instead: the first picture the engine draws from that
// very state, stepped on with every port vacant, on a private engine (booted
// from the same engine and content, the state restored into it), never the
// host's. It is computed here, from the session's own state, so every view
// shows the same poster, and it is never written anywhere: the session and
// its time are untouched, and the first tick played is the state's own, not
// the poster's (Doom's E1M1 from its start is tick 1; Unarmed's title, 7).
// A state no step within `max` gets a picture out of keeps what's shown.

/** Is a picture blank: none, 0 by 0, or one colour all over (alpha aside)? Pure. */
export function blank(p) {
  if (!p || !p.width || !p.height) return true;
  const r = p.rgba;
  for (let i = 4; i < p.width * p.height * 4; i += 4) if (r[i] !== r[0] || r[i + 1] !== r[1] || r[i + 2] !== r[2]) return false;
  return true;
}

/** One step's input for every port vacant: a port's vacant input (the session's `vacant`), once per player the engine has. */
export function vacantStep(engine, vacant) {
  const one = vacant instanceof Uint8Array ? vacant : new Uint8Array(vacant ?? []);
  if (one.length !== engine.inputBytes) throw new Error(`a vacant input is ${engine.inputBytes} bytes, not ${one.length}`);
  const out = new Uint8Array(engine.players * engine.inputBytes);
  for (let p = 0; p < engine.players; p++) out.set(one, p * engine.inputBytes);
  return out;
}

/**
 * The first picture worth showing from `engine`'s state: its picture of
 * `view` now, else after each step with every port vacant (`vacant`, one
 * port's), until one isn't blank; at most `max` steps. `engine` is a private
 * one, never a host's: it is stepped. `pause()` is awaited every `chunk`
 * steps, so a long search spreads over frames; `alive()` false stops it.
 * → { picture, ticks } (ticks: the steps it took), or null.
 */
export async function firstPicture(engine, { vacant, view = 0, max, chunk = 8, pause = async () => {}, alive = () => true }) {
  const input = vacantStep(engine, vacant);
  for (let ticks = 0; ticks <= max; ticks++) {
    if (!alive()) return null;
    const picture = engine.frame(view);
    if (!blank(picture)) return { picture, ticks };
    if (ticks === max) break;
    engine.step(input);
    if ((ticks + 1) % chunk === 0) await pause();
  }
  return null;
}

/**
 * Posters for one machine's screen, on one view. `get(host, view)` is the
 * poster of the host's state now (its tick and revision) from `view`, or
 * null while it's being found (asked for the first time here, it starts
 * finding it), or if that state has none. One is found at a time; a state
 * asked for meanwhile is found when it's asked for again. `make()` gives a
 * private engine (booted from the session's engine and content: async).
 *
 * @param o.make    async () → engine
 * @param o.vacant  one port's vacant input (the session doc's `vacant`)
 * @param o.max     the most steps to look ahead
 * @param o.pause   awaited between chunks of steps
 */
export function posters({ make, vacant, max, pause = () => new Promise((r) => setTimeout(r, 0)) }) {
  let found = null; // { key, picture | null }: the last state looked at, and its poster
  let working = false;
  let dead = false;
  return {
    get(host, view) {
      if (dead || !host?.engine || host.loading) return null;
      const key = `${host.tick}:${host.revision}:${view}`;
      if (found?.key === key) return found.picture;
      if (working) return null;
      working = true;
      // the host's state, copied out now (a snapshot reads; it never steps the host's engine)
      const snap = host.engine.snapshot();
      (async () => {
        let picture = null;
        try {
          const engine = await make();
          if (!dead) {
            engine.restore(snap);
            picture = (await firstPicture(engine, { vacant, view, max, pause, alive: () => !dead }))?.picture ?? null;
          }
        } catch (err) {
          console.warn("[machine] couldn't find a picture for a stopped screen", err);
        }
        found = { key, picture };
        working = false;
      })();
      return null;
    },
    /** Whether a poster is being found now. */
    busy: () => working,
    dispose() {
      dead = true;
    },
  };
}
