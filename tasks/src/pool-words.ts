// What this browser's pool is doing, as the badge and the queue browser say
// it: a few words, and a sentence that says why, both read from the page's
// pool host as it is (browser/pool-host.ts), never guessed.

import type { PoolHostStatus } from './browser/pool-host';

/** The words for a pool host's status: a short form for a badge, and the sentence that explains it. */
export function poolWords(pool: PoolHostStatus): { short: string; long: string } {
  switch (pool.state) {
    case 'running':
    case 'starting':
      return {
        short: pool.busy > 0 ? `${pool.busy} running here` : 'served here',
        long: `This tab runs this browser's pool (${pool.name ?? 'starting'}): ${pool.busy} of ${pool.slots} slots busy.`,
      };
    case 'waiting':
      return {
        short: 'served by another tab',
        long: "Another tab of this browser runs its pool; this one takes over if that one closes.",
      };
    case 'letting go':
      return {
        short: 'finishing up',
        // Said until the drain ends, even when something on this page has
        // started the pool again meanwhile: it then asks for the pool anew.
        long: "This page let go of this browser's pool: it finishes what it is running, takes nothing new, and then the pool goes to whichever tab asks for it next.",
      };
    case 'handing over':
      return {
        short: 'finishing up',
        long: "A newer version of tasks is open in another tab: this tab's pool finishes what it is running and takes nothing new.",
      };
    case 'stood down':
      return {
        short: 'served by another tab',
        long: 'A newer version of tasks is open in another tab, and that tab serves the queues.',
      };
    case 'not started':
      return {
        short: 'not running here',
        long: "This page has no part in this browser's pool: nothing in this frame has started it.",
      };
    case 'unavailable':
      return {
        short: 'not running here',
        long:
          `This browser's pool is not running: ${pool.problem ?? 'it could not start'}.` +
          (pool.retryAt ? ` It tries again at ${new Date(pool.retryAt).toLocaleTimeString()}.` : ''),
      };
  }
}
