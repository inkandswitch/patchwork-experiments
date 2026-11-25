// Finding a doc that may not have reached the sync server yet. A run's
// layer docs are made by a run moments before it writes their links,
// and a peer that follows a link at once can be told the doc is
// "unavailable" (repo.find rejects rather than waits). So: ask again, a few
// times, before believing it.

/**
 * @param {{ find(url: string): Promise<any> }} repo
 * @param {string} url
 * @param {{ tries?: number, wait?: number, sleep?: (ms: number) => Promise<void> }} [o]
 *   tries: attempts in all; wait: ms before the first retry, doubling, at most 8 s
 */
export async function findWhenThere(repo, url, { tries = 8, wait = 500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const h = await repo.find(url);
      if (h?.doc?.()) return h;
      last = new Error(`${url} came back empty`);
    } catch (err) {
      last = err;
    }
    if (i + 1 < tries) await sleep(Math.min(8000, wait * 2 ** i));
  }
  throw last;
}
