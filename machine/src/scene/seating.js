// A seat per port at a machine's screen: what the machine lays, where its
// places are, and which port a view holds. Pure: extension.js does the rest.
//
// Seats are the seats package's, met only through its conventions (seats/
// README.md): its `lay(d, seats)` writes them when the machine's session is
// made, the places given here (`seatPlaces`) say where each port's seat is
// on the cabinet, and its roster says which seat this view is sitting in
// now. The machine never reads or writes the seats trait itself.
//
// A port is held by the view sitting in its seat: sitting down at port N's
// seat takes port N, and standing up (or watching, or sitting elsewhere, or
// leaving) gives it back. A machine with no seats (no seats package where it
// was made) is played by Play alone: the pad in hand holds a port.

import { BODY } from "./cabinet.js";

/** Port `port`'s seat on machine object `id`. */
export const seatId = (id, port) => `${id}.p${port + 1}`;

/** The port seat `sid` is on machine object `id`, or null. */
export function portOfSeat(id, ports, sid) {
  if (typeof sid !== "string" || !sid.startsWith(`${id}.p`)) return null;
  const n = sid.slice(id.length + 2);
  if (!/^[1-9][0-9]*$/.test(n)) return null;
  const port = Number(n) - 1;
  return port < ports ? port : null;
}

/** How far in front of the screen a seated player's eye is (m), and how far apart the seats are. */
export const EYE_DISTANCE = 1.1;
const SPREAD = 0.3;

/** Where port `port` of `ports` sits across the cabinet: x in its frame (m). */
const across = (port, ports) => (port - (ports - 1) / 2) * SPREAD;

/**
 * The seats machine object `id` lays: one per port, named "<title> · P<n>",
 * each a view of the screen from a little in front of it, side by side, in
 * the object's frame (so a seat rides the cabinet when it's moved). `screen`
 * is the cabinet's (cabinet.js screenOf: what the cabinet is built from).
 */
export function seatsFor(id, { title, ports, screen }) {
  const [x, y, z] = screen.center;
  const out = {};
  for (let p = 0; p < ports; p++)
    out[seatId(id, p)] = {
      name: `${title || "Machine"} · P${p + 1}`,
      camera: { position: [x + across(p, ports), y + 0.05, z + EYE_DISTANCE], target: [x, y, z], in: id },
    };
  return out;
}

/** The height of the strip of places on the cabinet's front, below the screen (m). */
const PANEL = [0.85, 1.0];

/**
 * Where each port's seat is on machine object `id`: a strip across the
 * cabinet's front below the screen, divided into one place per port, in the
 * object's frame (what `seatPlaces` contributes: a name tag on each, and a
 * look at one is a look at its seat). Only for the seats `laid`.
 */
export function placesFor(id, ports, laid) {
  const W = BODY.width, D = BODY.depth;
  const out = [];
  for (let p = 0; p < ports; p++) {
    const seat = seatId(id, p);
    if (!laid.has(seat)) continue;
    out.push({ seat, id, min: [-W / 2 + (p * W) / ports, PANEL[0], D / 2 - 0.01], max: [-W / 2 + ((p + 1) * W) / ports, PANEL[1], D / 2 + 0.01] });
  }
  return out;
}

/** How many ports machine object `id` has seats for, among the seat ids laid (its seats are P1..PN). */
export function seatedPorts(id, laid) {
  let n = 0;
  while (laid.has(seatId(id, n))) n++;
  return n;
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
 * taken if it's free and the pad put in hand (`pickUp(port)`); a port still
 * held by someone else is asked for again on the next frame.
 */
export function follow(m, want, { pickUp, putDown }) {
  const step = seatStep(want, m.host.seat?.port ?? null);
  if (step === "stand" || step === "move") {
    putDown();
    m.leave();
  }
  if ((step === "sit" || step === "move") && m.play(want) !== null) pickUp(want);
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
