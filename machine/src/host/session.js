// The session's documents, and the pure functions that read them.
//
// session (one doc, small, linked from wherever the machine is shown):
//   engine:      { wasm, content, genesis, hz: [num, den], players, inputBytes }
//   vacant:      inputBytes bytes: a port nobody holds sends this (zeros)
//   chunk:       ticks per durable input chunk (about one second)
//   every:       ticks between checkpoints (about a minute)
//   roll:        ticks per seat document (about ten minutes)
//   clock:       { t, at, until? }  (the stand-in for the "clock" service; see clock.js)
//   seats:       { [id]: { port, by, from, until?, inputs: url } }
//   checkpoints: { [tick]: { url, hash, seating } }   (every one still good: a
//                seat change in the past drops those after it)
//
// seat inputs (one doc per seat; only its holder writes it):
//   { session, seat, port, from, chunks: { [n]: bytes } }
//   chunk n holds the seat's inputs for ticks [max(from, n·chunk), …), one
//   after another, inputBytes each: a full chunk is `chunk` ticks; the last
//   one may be shorter, and grows when its holder writes it again.
//
// checkpoint (one doc per checkpoint, written once):
//   { session, tick, hash, state }   state: the snapshot, gzipped
//
// Why this shape: HOST.md "The documents", which has the numbers.

/**
 * Which seat holds each port, as a pure function of the seats map: the seats
 * in (from, id) order, each one accepted if its port is free at its `from`.
 * An accepted seat holds [from, until) (until absent: for good). A seat with
 * until <= from is void. So two people taking one port at once settle the same
 * way everywhere: the earlier from, then the smaller id.
 *
 * @returns per port, the accepted [{ id, from, until }] in order
 */
export function seating(seats, ports) {
  const out = Array.from({ length: ports }, () => []);
  const order = Object.entries(seats ?? {})
    .map(([id, s]) => ({ id, port: s.port, from: s.from, until: s.until ?? Infinity }))
    .filter((s) => Number.isInteger(s.port) && s.port >= 0 && s.port < ports && s.until > s.from)
    .sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const s of order) {
    const held = out[s.port];
    const last = held[held.length - 1];
    if (!last || s.from >= last.until) held.push({ id: s.id, from: s.from, until: s.until });
  }
  return out;
}

/** The seat holding port at tick under a seating, or null if it is vacant. */
export function holder(seated, port, tick) {
  for (const s of seated[port]) if (s.from <= tick && tick < s.until) return s.id;
  return null;
}

/**
 * The first tick at which two seatings disagree about who holds some port
 * (Infinity if they agree everywhere).
 */
export function firstDifference(a, b) {
  let first = Infinity;
  for (let p = 0; p < a.length; p++) {
    const edges = new Set([0]);
    for (const s of [...a[p], ...b[p]]) {
      edges.add(s.from);
      if (s.until !== Infinity) edges.add(s.until);
    }
    for (const t of [...edges].sort((x, y) => x - y)) {
      if (t >= first) break;
      if (holder(a, p, t) !== holder(b, p, t)) first = t;
    }
  }
  return first;
}

/**
 * Who held each port over ticks [0, t), as a short key. The state at t is a
 * function of the seating over [0, t) and the seats' inputs, and a seat's
 * input at a tick never changes once made (one writer, who makes each once),
 * so two states at t reached under seatings with equal keys are the same
 * state. A checkpoint records the key it was computed under; one whose key
 * is not the current seating's is stale, whoever wrote it and whenever.
 */
export function seatingKey(seated, t) {
  const text = seated
    .map((port) => port.filter((s) => s.from < t).map((s) => `${s.id}@${s.from}-${Math.min(s.until, t)}`).join(","))
    .join("|");
  // Two FNV-1a lanes: 64 bits, so the documents carry 16 characters, not the
  // whole history of who sat where.
  let a = 0x811c9dc5, b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return [a, b].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/** The ticks chunk n of a seat covers: [start, end). */
export function chunkSpan(n, size, seat) {
  const start = Math.max(seat.from, n * size);
  const end = Math.min(seat.until ?? Infinity, (n + 1) * size);
  return [start, end];
}

/** A run of inputs (inputBytes each) starting at tick `at`, as [tick, bytes] pairs. */
export function* unpack(at, bytes, width) {
  for (let i = 0; i + width <= bytes.length; i += width) yield [at + i / width, bytes.subarray(i, i + width)];
}

/** The inverse: the inputs at ticks [from, to) from a map, which must have them all. */
export function pack(map, from, to, width) {
  const out = new Uint8Array((to - from) * width);
  for (let t = from; t < to; t++) out.set(map.get(t), (t - from) * width);
  return out;
}

export async function gzip(bytes) {
  return pipe(bytes, new CompressionStream("gzip"));
}

export async function gunzip(bytes) {
  return pipe(bytes, new DecompressionStream("gzip"));
}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
