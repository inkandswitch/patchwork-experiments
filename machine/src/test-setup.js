// Set up before every test file (vitest.config.ts setupFiles).
//
// 1. Every host test runs in virtual time (fake timers, performance.now
// among them: vitest.config.ts), and only virtual time may decide what
// happens when. In production, compiling an engine, hashing
// its bytes and gzipping a checkpoint run on real threads and finish when
// they finish; a harness that advances virtual time while it waits for them
// would let the machine's load decide how far time got (and with it what
// was predicted, corrected or skipped). So here they finish before their
// promise is first awaited, with the same results: a run is the same every
// time, on any machine, under any load.
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

WebAssembly.compile = async (bytes) => new WebAssembly.Module(bytes);
Object.defineProperty(crypto.subtle, "digest", {
  value: async (algorithm, data) => {
    if (algorithm !== "SHA-256") throw new Error(`virtual-time setup: no ${algorithm}`);
    const view = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
    return new Uint8Array(createHash("sha256").update(view).digest()).buffer;
  },
});

// Automerge's actor and document ids are drawn from crypto.getRandomValues,
// and which of two concurrent writes wins goes by actor id. Drawn from a
// fixed sequence instead, they are just as distinct within a run, and the
// same in every run.
let seed = 0x9e3779b9;
Object.defineProperty(crypto, "getRandomValues", {
  value: (array) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      bytes[i] = seed & 0xff;
    }
    return array;
  },
});

vi.mock("./host/session.js", async (original) => ({
  ...(await original()),
  gzip: async (bytes) => new Uint8Array(gzipSync(bytes)),
  gunzip: async (bytes) => new Uint8Array(gunzipSync(bytes)),
}));

// 2. Many tests here are long and synchronous (exhaustive loops, thousands of
// engine ticks), and vitest's worker answers its runner only between event
// loop turns, giving up after 60 s: on a loaded machine a run of them makes
// it report "Timeout calling onTaskUpdate" though every test passed. A turn
// of the real event loop after each test lets those answers through.
const immediate = globalThis.setImmediate; // the real one, before any test fakes it
afterEach(() => new Promise((resolve) => immediate(resolve)));
