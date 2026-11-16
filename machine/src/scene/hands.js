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
    verb(target) {
      const id = playing(target);
      const e = id != null ? machines.get(id) : null;
      if (!e) return null;
      if (!e.m) return { label: "Play", disabled: true, title: e.note ?? "Starting…" };
      if (held?.id === id) return { label: "Put the pad down" };
      if (seated(e)) {
        if (seatedAt(e) !== null) return { label: "Pick up the pad" };
        const r = sitter();
        if (!r) return { label: "Play (needs the seats package)", disabled: true, title: NO_SEATS };
        const [port] = open(e, r);
        return port === undefined ? FULL : { label: "Play", title: `Sit at P${port + 1} with its pad` };
      }
      if (!e.m.holders().includes(null)) return FULL;
      return { label: "Play" };
    },
    /** The Play command's run, for a look at `target`. */
    play(target) {
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
    },
    /** Machine `id` is going: its pad, if in hand, is put down. */
    drop(id) {
      if (held?.id === id) held.put();
    },
  };
}
