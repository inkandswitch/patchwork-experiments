// The pad in this view's hand, and the port it holds, across the machines in
// a scene: what sitting, Escape and P do. extension.js gives it the stage.
//
// - A machine whose trait lists seats (seating.js) is played by sitting at
//   them. Sitting is holding: each frame the port follows the seat this view
//   sits in (`follow`), taken with the pad in hand on sitting down and given
//   back on getting up. Play is the way in: not sitting at it, P sits you at
//   its first free port's seat (the screen's player's first: openPorts),
//   through the seats' roster (`sit`), and the port and pad follow; every
//   port taken, it says so. Escape puts the pad down and keeps the port
//   while you sit; P picks it back up.
// - A machine that lists none is played by Play alone: P takes a free port
//   with the pad (the screen's player's first: portToPlay), and Escape gives
//   it back.
// - P acts on the machine looked at; looking at anything else, on the one
//   whose pad you hold or whose seat you sit in.
// - A click on a machine is Play too, while it would be the way in: no pad
//   in hand and sitting nowhere (`clicks`). Then a click Play can't act on
//   says why (every port taken, no seats package, still starting) rather
//   than nothing; sitting or holding a pad, a click on it is a stray one and
//   goes on (P and Escape are what play then).
//
// A machine `e` is { id, m, pad, ports, kind, title, note }: `m` is
// runMachine's (host.seat, holders(), play(port), leave()), `pad` input.js's.

import { KEYS } from "../patchwork/input.js";
import { portOf, follow as followSeat, portToPlay, openPorts } from "./seating.js";

/** Why Play can't seat you at a machine with seats: nothing here owns seats (the seats package isn't loaded). */
export const NO_SEATS = "Its seats need the seats package";
/**
 * Play on a machine every port of which is taken: greyed out, saying so in
 * its label (where the prompt shows it), not only in a tooltip: a disabled
 * verb's key does nothing, so the label is all a keyboard user gets.
 */
const FULL = Object.freeze({ label: "Play (every port is taken)", disabled: true, title: "Every port is taken" });
/**
 * Play while the session's clock may be nobody's (Host.joining: a port held
 * by a holder not heard from yet, perhaps one long gone): a moment, until
 * that seat is known live or reaped.
 */
const JOINING = Object.freeze({ label: "Play (joining…)", disabled: true, title: "Joining the game: a moment" });

/**
 * @param o.machines  Map id → machine, the extension's
 * @param o.hold      (spec, input) → put: api.hold, the held tool
 * @param o.sitting   () → { of, seat } | null: the seat this view sits in (the roster's)
 * @param o.seatsOf   (id) → seat id per port | null: what machine `id`'s trait lists
 * @param o.prefer    (e) → the port Play offers first (the screen's player)
 * @param o.notify    (text) → void
 * @param o.roster    () → the seats' roster ({ stateOf(ref), sit(ref) }) | null: where nothing owns seats, none
 */
export function hands({ machines, hold, sitting, seatsOf, prefer, notify, roster = () => null }) {
  let held = null; // { id, put }: the pad in this view's hand

  const seated = (e) => seatsOf(e.id) !== null;
  const seatedAt = (e, s = sitting()) => portOf(e.id, seatsOf(e.id), e.ports, s);

  /** Puts machine `e`'s pad for `port` in this view's hand. Put down (Escape), it gives the port back only where the machine has no seats: a seat holds it while you sit. */
  function holdPad(e, port) {
    const mine = { id: e.id, put: null };
    const input = {
      key: (ev) => (e.pad.key(ev.code, true), true),
      keyup: (ev) => (e.pad.key(ev.code, false), true),
      put() {
        if (held === mine) held = null;
        e.pad.clear();
        if (!seated(e)) e.m?.leave();
      },
    };
    held = mine;
    mine.put = hold({ name: `${e.title} · P${port + 1}`, keys: KEYS[e.kind] ?? [] }, input);
  }

  /** The seats roster, if it can sit this view anywhere (a package's late-bound api: checked, never assumed). */
  const sitter = () => {
    const r = roster();
    return typeof r?.sit === "function" && typeof r.stateOf === "function" ? r : null;
  };
  /** The ports Play may sit this view at on machine `e` (with seats), in order, through roster `r`. */
  const open = (e, r) => openPorts(e.m.holders(), seatsOf(e.id), prefer(e), (seat) => r.stateOf({ of: e.id, seat }));

  /** What P acts on, for a look at `target`. */
  function playing(target) {
    if (target != null && machines.has(target)) return target;
    if (held) return held.id;
    const s = sitting();
    for (const e of machines.values()) if (seatedAt(e, s) !== null) return e.id;
    return target;
  }

  return {
    /** The pad in hand: { id } of its machine, or null. */
    held: () => (held ? { id: held.id } : null),
    /** Every frame, per running machine with seats: its port follows the seat this view sits in (`s`, sitting()'s this frame). */
    follow(e, s = sitting()) {
      if (!seated(e)) return;
      followSeat(e.m, seatedAt(e, s), {
        pickUp: (port) => holdPad(e, port),
        putDown: () => held?.id === e.id && held.put(),
      });
    },
    /** The Play command's state, for a look at `target`. */
    verb,
    /** The Play command's run, for a look at `target`. */
    play,
    /** Whether a click on `target` is Play's (below). */
    clicks,
    /** A click on `target` (below). */
    click,
    /** Machine `id` is going: its pad, if in hand, is put down. */
    drop(id) {
      if (held?.id === id) held.put();
    },
  };

  /** The Play command's state, for a look at `target`. */
  function verb(target) {
    const id = playing(target);
    const e = id != null ? machines.get(id) : null;
    if (!e) return null;
    if (!e.m) return { label: "Play", disabled: true, title: e.note ?? "Starting…" };
    if (held?.id === id) return { label: "Put the pad down" };
    if (seated(e) && seatedAt(e) !== null) return { label: "Pick up the pad" };
    if (!e.m.host?.seat && e.m.host?.joining) return JOINING;
    if (seated(e)) {
      const r = sitter();
      if (!r) return { label: "Play (needs the seats package)", disabled: true, title: NO_SEATS };
      const [port] = open(e, r);
      return port === undefined ? FULL : { label: "Play", title: `Sit at P${port + 1} with its pad` };
    }
    if (!e.m.holders().includes(null)) return FULL;
    return { label: "Play" };
  }

  /** The Play command's run, for a look at `target`. */
  function play(target) {
    const id = playing(target);
    const e = id != null ? machines.get(id) : null;
    if (!e?.m) return;
    if (held?.id === id) return void held.put();
    if (seated(e)) {
      // sitting at it: the pad back in hand (the port is the seat's)
      const port = seatedAt(e);
      if (port !== null) {
        if (e.m.host.seat?.port === port) holdPad(e, port);
        return;
      }
      // not sitting at it: sat at the first free port's seat that takes you (the port and its pad follow the seat, next frame)
      const r = sitter();
      if (!r) return void notify(NO_SEATS);
      const seats = seatsOf(e.id);
      for (const p of open(e, r)) if (r.sit({ of: e.id, seat: seats[p] })) return;
      return void notify("Every port on that machine is taken");
    }
    const port = portToPlay(e.m.holders(), prefer(e));
    if (port === null || e.m.play(port) === null) return void notify("Every port on that machine is taken");
    holdPad(e, port);
  }

  /** Whether a click on `target` is Play's: a machine here, no pad in hand, and this view sits nowhere. */
  function clicks(target) {
    return target != null && machines.has(target) && held === null && sitting() === null;
  }

  /**
   * A click on `target`: Play's (`clicks`), run through `run` (the stage's
   * api.run, which applies the verb's state and reach: true if it ran).
   * What Play refuses for the machine's own reason (`verb` disabled) is
   * said, and the click is taken; one the stage refuses with the verb
   * enabled (out of reach) goes on. → whether the click was taken.
   */
  function click(target, run) {
    if (!clicks(target)) return false;
    if (run()) return true;
    const st = verb(target);
    if (!st?.disabled) return false;
    notify(st.title ?? st.label);
    return true;
  }
}
