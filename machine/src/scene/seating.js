// A seat per port at a machine's screen: what the machine lays, where its
// places are, and which port a view holds. Pure: extension.js does the rest.
//
// Seats are the seats package's, met only through its conventions (seats/
// README.md): its `lay(d, seats, of)` writes them on the machine's object
// when its session is made (an object's own seats: copied and removed with
// it, never a table's players), not lasting (a port is held only while
// someone sits at it: nothing is written, and getting up frees it); the
// places given here (`seatPlaces`) say where each port's seat is on the
// cabinet; and its roster says which seat this view is sitting in now. The
// machine never reads or writes the seats trait itself. What it keeps is
// its own: the trait's `seats`, the seat id of each port, in port order,
// written in the same change. A machine whose trait lists seats is played
// by sitting at them; one that lists none (no seats package where it was
// made) by Play alone: the pad in hand holds a port.

import { BODY } from "./cabinet.js";

/** The seat ids a machine with `ports` ports lays, in port order: what its trait's `seats` lists. */
export const portSeats = (ports) => Array.from({ length: ports }, (_, p) => `p${p + 1}`);

/**
 * The port this view's seat (`sitting`, the roster's: { of, seat } | null)
 * is on machine object `id`, whose trait lists `seats` (by port) and which
 * has `ports` ports; null when it sits at none of them.
 */
export function portOf(id, seats, ports, sitting) {
  if (!Array.isArray(seats) || sitting?.of !== id) return null;
  const port = seats.indexOf(sitting.seat);
  return port >= 0 && port < ports ? port : null;
}

/** How far in front of the screen a seated player's eye is (m), and how far apart the seats are. */
export const EYE_DISTANCE = 1.1;
const SPREAD = 0.3;

/** Where port `port` of `ports` sits across the cabinet: x in its frame (m). */
const across = (port, ports) => (port - (ports - 1) / 2) * SPREAD;

/**
 * The seats machine object `id` lays on itself: one per port (portSeats),
 * named "<title> · P<n>", not lasting, each a view of the screen from a
 * little in front of it, side by side, in the object's frame (so a seat
 * rides the cabinet when it's moved). `screen` is the cabinet's (cabinet.js
 * screenOf: what the cabinet is built from).
 */
export function seatsFor(id, { title, ports, screen }) {
  const [x, y, z] = screen.center;
  const out = {};
  for (const [p, sid] of portSeats(ports).entries())
    out[sid] = {
      name: `${title || "Machine"} · P${p + 1}`,
      lasting: false,
      camera: { position: [x + across(p, ports), y + 0.05, z + EYE_DISTANCE], target: [x, y, z], in: id },
    };
  return out;
}

/** The height of the strip of places on the cabinet's front, below the screen (m). */
const PANEL = [0.85, 1.0];

/**
 * Where each port's seat is on machine object `id`, whose trait lists
 * `seats` (by port): a strip across the cabinet's front below the screen,
 * divided into one place per port, in the object's frame (what `seatPlaces`
 * contributes: a name tag on each, and a look at one is a look at its seat).
 */
export function placesFor(id, seats) {
  if (!Array.isArray(seats)) return [];
  const W = BODY.width, D = BODY.depth, n = seats.length;
  return seats.map((seat, p) => ({ seat, of: id, id, min: [-W / 2 + (p * W) / n, PANEL[0], D / 2 - 0.01], max: [-W / 2 + ((p + 1) * W) / n, PANEL[1], D / 2 + 0.01] }));
}

/**
 * What to do about this view's port on one machine, given the port it should
 * hold (`want`: its seat's, or null) and the one it holds (`have`): "stand",
 * "sit", "move" (stand, then sit) or null. Pure.
 */
export function seatStep(want, have) {
  if (want === have) return null;
  if (have === null) return "sit";
  return want === null ? "stand" : "move";
}

/**
 * One frame of following a seat on one machine (runMachine's `m`): the port
 * this view should hold is `want` (its seat's port, or null). Standing, the
 * pad is put down (`putDown`) and the port given back; sitting, the port is
 * taken if it's free and the pad put in hand (`pickUp(port)`). A port
 * someone else plainly holds (`holders`) isn't asked for; it, or one whose
 * holder has only just stood up (Host.sit, the judge, refuses it a moment
 * longer), is asked for again on the next frame.
 */
export function follow(m, want, { pickUp, putDown }) {
  const step = seatStep(want, m.host.seat?.port ?? null);
  if (step === "stand" || step === "move") {
    putDown();
    m.leave();
  }
  if ((step === "sit" || step === "move") && m.holders()[want] === null && m.play(want) !== null) pickUp(want);
}

/**
 * The port Play takes on a machine with no seats: `prefer` (the screen's
 * player) if it's free, else the first free one, else null. `holders` is
 * runMachine's: by port, a holder or null.
 */
export function portToPlay(holders, prefer) {
  if (holders[prefer] === null) return prefer;
  const free = holders.indexOf(null);
  return free < 0 ? null : free;
}
