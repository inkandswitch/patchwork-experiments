// asking(host): each query answered once a state (tick and revision), for
// every order of asks over a bounded run of states; a RemoteHost (no engine
// here) asked as is; a null never kept.
import { asking } from "./asked.js";

/** A host whose state goes through `states` ([tick, revision]); query answers `${kind}@${tick}:${revision}`, counted. */
function host(states, { engine = true, nullUntil = -1 } = {}) {
  let i = 0;
  const calls = [];
  return {
    calls,
    next: () => void i++,
    get engine() {
      return engine ? {} : null;
    },
    get tick() {
      return states[i][0];
    },
    get revision() {
      return states[i][1];
    },
    query(kind) {
      calls.push(kind);
      return i <= nullUntil ? null : `${kind}@${states[i][0]}:${states[i][1]}`;
    },
    output: () => ["out"],
  };
}

// a run of states: steps forward, a rollback re-stepping to a tick seen before (another revision), a frame with no step
const STATES = [[0, 0], [1, 1], [1, 1], [2, 2], [1, 3], [2, 4], [2, 4]];
const KINDS = [0, 1, 2];

test("every pattern of asks over the run: an answer is the state's own, and the host is asked once per kind per state", () => {
  // each frame asks a subset of the kinds, each twice, in order: every subset at every frame would be 8^7; every subset at one frame, the others asking all, covers each subset at each position
  let cases = 0;
  for (let at = 0; at < STATES.length; at++)
    for (let mask = 0; mask < 8; mask++) {
      const h = host(STATES);
      const q = asking(h);
      for (let f = 0; f < STATES.length; f++) {
        if (f) h.next();
        const asks = KINDS.filter((k) => f !== at || mask & (1 << k));
        for (const k of [...asks, ...asks]) {
          expect(q.query(k)).toBe(`${k}@${STATES[f][0]}:${STATES[f][1]}`);
        }
      }
      // the model: one ask per kind per run of frames at one state (the same tick and revision in a row)
      let distinct = 0;
      let run = null;
      let seen = new Set();
      for (let f = 0; f < STATES.length; f++) {
        if (String(STATES[f]) !== run) (run = String(STATES[f])), (seen = new Set());
        for (const k of KINDS.filter((k) => f !== at || mask & (1 << k))) if (!seen.has(k)) seen.add(k), distinct++;
      }
      expect(h.calls.length).toBe(distinct);
      cases++;
    }
  expect(cases).toBe(STATES.length * 8);
});

test("a RemoteHost (no engine here) is asked every time; a null (loading) is asked again; output is the host's", () => {
  const remote = host(STATES, { engine: false });
  const q = asking(remote);
  q.query(1);
  q.query(1);
  expect(remote.calls).toEqual([1, 1]);
  const loading = host([[0, 0], [0, 0]], { nullUntil: 0 });
  const l = asking(loading);
  expect(l.query(2)).toBe(null);
  expect(l.query(2)).toBe(null);
  loading.next();
  expect(l.query(2)).toBe("2@0:0");
  expect(l.query(2)).toBe("2@0:0");
  expect(loading.calls).toEqual([2, 2, 2]);
  expect(q.output()).toEqual(["out"]);
});
