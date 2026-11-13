// What linking every checkpoint costs the session document, against linking
// the two newest (phase 1). A 4-player session: one checkpoint pointer a
// minute ({ url, hash, seating }), and each seat rolling to a new document
// every 10 minutes (as the host does), for 1, 4 and 10 hours. Measures the
// saved document's size and the time to load it (the median of 5).
//
//   node bench/retention.mjs
import * as A from "@automerge/automerge";
import { generateAutomergeUrl } from "@automerge/automerge-repo";

const hex = (n, i) => ((i * 2654435761) >>> 0).toString(16).padStart(8, "0").repeat(n / 8);
function session(minutes, keep) {
  let d = A.from({ engine: { wasm: hex(64, 1), content: hex(64, 2), genesis: hex(16, 3), hz: [35, 1], players: 4, inputBytes: 6 }, vacant: new Uint8Array(6), chunk: 35, every: 2100, roll: 21000, clock: { t: 0, at: 0 }, seats: {}, checkpoints: {} });
  const seat = new Array(4).fill(null);
  for (let m = 0; m <= minutes; m++) {
    const tick = m * 2100;
    if (m % 10 === 0)
      d = A.change(d, (x) => {
        for (let p = 0; p < 4; p++) {
          if (seat[p]) x.seats[seat[p]].until = tick;
          seat[p] = `peer${p}.${tick}`;
          x.seats[seat[p]] = { port: p, from: tick, inputs: generateAutomergeUrl() };
        }
      });
    if (m === 0) continue;
    d = A.change(d, (x) => {
      x.checkpoints[tick] = { url: generateAutomergeUrl(), hash: hex(16, m), seating: hex(16, m + 7) };
      if (keep) for (const t of Object.keys(x.checkpoints).map(Number).sort((a, b) => b - a).slice(keep)) delete x.checkpoints[t];
    });
  }
  const bytes = A.save(d);
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    A.load(bytes);
    times.push(performance.now() - t);
  }
  return { bytes: bytes.length, load: times.sort((a, b) => a - b)[2] };
}

const rows = [];
for (const hours of [1, 4, 10]) {
  const two = session(hours * 60, 2);
  const all = session(hours * 60, 0);
  rows.push({ hours, "two newest: bytes": two.bytes, "load ms": +two.load.toFixed(2), "all: bytes": all.bytes, "load ms ": +all.load.toFixed(2), "extra per checkpoint": Math.round((all.bytes - two.bytes) / (hours * 60)) });
}
console.table(rows);
