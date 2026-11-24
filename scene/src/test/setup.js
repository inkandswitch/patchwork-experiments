// Every test file's setup (vitest.config.ts, setupFiles). The work a test
// can't step on manual time is work off this thread: a SHA-256 digest (a
// build's hash) runs on Node's thread pool and resolves whenever it is done.
// Each one in flight is kept in `offThread`, so flush() (fake-repo.js) waits
// for exactly those, not for some number of milliseconds.

const pending = new Set();
/** The off-thread work in flight now. */
globalThis.__offThread = pending;

const subtle = globalThis.crypto?.subtle;
if (subtle) {
  const digest = subtle.digest.bind(subtle);
  Object.defineProperty(subtle, "digest", {
    configurable: true,
    value: (...args) => {
      const p = digest(...args);
      pending.add(p);
      const done = () => pending.delete(p);
      p.then(done, done);
      return p;
    },
  });
}
