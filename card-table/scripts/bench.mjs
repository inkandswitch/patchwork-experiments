// What a real deck costs: N cards, k players, 2048-bit group, one machine
// playing every seat in turn. Usage: node scripts/bench.mjs [cards] [players]
import { createParticipant, newDeckDoc } from "../src/deck.js";

const N = Number(process.argv[2] ?? 60);
const K = Number(process.argv[3] ?? 2);
let state = structuredClone(newDeckDoc({ faces: Array.from({ length: N }, (_, i) => ({ name: `card ${i}` })), slots: Object.fromEntries(Array.from({ length: N }, (_, i) => [`o${i}`, i])) }));
const handle = { url: "automerge:bench", doc: () => state, change(fn) { const d = structuredClone(state); fn(d); state = d; } };
const store = () => { const m = new Map(); return { get: (id) => m.get(id) ?? null, set: (id, v) => m.set(id, v) }; };
const players = Array.from({ length: K }, (_, i) => `p${i}`);
const clients = players.map((playerId) => createParticipant({ handle, playerId, keyStore: store() }));
const where = { o0: "p0" };
const visibleTo = (p) => Object.entries(where).filter(([, w]) => (p == null ? w === "public" : w === p || w === "public")).map(([id]) => id);

const t0 = performance.now();
for (let r = 0; r < 4 * K && state.phase !== "ready"; r++) for (const c of clients) await c.step({ players, visibleTo });
const t1 = performance.now();
for (const c of clients) await c.step({ players, visibleTo });
const { looks } = await clients[0].reveal(["o0"]);
const t2 = performance.now();
console.log(`${N} cards, ${K} players: keys + shuffle ${(t1 - t0).toFixed(0)} ms in all (≈${((t1 - t0) / K).toFixed(0)} ms each), first private reveal ${(t2 - t1).toFixed(0)} ms → ${looks.get("o0")?.name}`);
console.log(`the shuffled deck in the doc: ${(JSON.stringify(state.cards).length / 1024).toFixed(0)} KB`);
