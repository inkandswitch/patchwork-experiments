import { describe, expect, it } from 'vitest';
import { RouterWatch, TAKEOVER_THRESHOLD_MS } from './takeover';

const queue = 'automerge:queue';
const second = 1_000;

describe('RouterWatch', () => {
  it('takes a queue with no active router straight away', () => {
    expect(new RouterWatch().shouldTakeOver(queue, null, 0)).toBe(true);
  });

  it("gives a router it has never heard from the full threshold before replacing it", () => {
    const watch = new RouterWatch();
    expect(watch.shouldTakeOver(queue, 'router-a', 0)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-a', TAKEOVER_THRESHOLD_MS)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-a', TAKEOVER_THRESHOLD_MS + 1)).toBe(true);
  });

  it('leaves a router alone for as long as its heartbeats keep coming', () => {
    const watch = new RouterWatch();
    for (let now = 0; now < 60 * second; now += second) {
      watch.heardFrom('router-a', now);
      expect(watch.shouldTakeOver(queue, 'router-a', now)).toBe(false);
    }
  });

  it('replaces a router once its heartbeats have stopped for the threshold', () => {
    const watch = new RouterWatch();
    watch.shouldTakeOver(queue, 'router-a', 0);
    watch.heardFrom('router-a', 30 * second);
    expect(watch.shouldTakeOver(queue, 'router-a', 35 * second)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-a', 30 * second + TAKEOVER_THRESHOLD_MS + 1)).toBe(
      true,
    );
  });

  it('starts the grace period again when another router takes over', () => {
    const watch = new RouterWatch();
    watch.shouldTakeOver(queue, 'router-a', 0);
    // router-a went quiet, and router-b replaced it before this router did
    const takeover = TAKEOVER_THRESHOLD_MS + 5 * second;
    expect(watch.shouldTakeOver(queue, 'router-b', takeover)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-b', takeover + TAKEOVER_THRESHOLD_MS)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-b', takeover + TAKEOVER_THRESHOLD_MS + 1)).toBe(
      true,
    );
  });

  it("doesn't hold an old silence against a router that takes a queue back", () => {
    const watch = new RouterWatch();
    watch.shouldTakeOver(queue, 'router-a', 0);
    // this router took over from a quiet router-a…
    watch.stopWatching(queue);
    // …and much later router-a is named again
    const later = 60 * second;
    expect(watch.shouldTakeOver(queue, 'router-a', later)).toBe(false);
    expect(watch.shouldTakeOver(queue, 'router-a', later + TAKEOVER_THRESHOLD_MS + 1)).toBe(true);
  });

  it('takes a queue from a live router on an older protocol without waiting', () => {
    const watch = new RouterWatch();
    watch.shouldTakeOver(queue, 'router-old', 0, 2);
    // very much alive, and no use to anyone on protocol 2
    watch.heardFrom('router-old', 1 * second, 1);
    expect(watch.shouldTakeOver(queue, 'router-old', 1 * second, 2)).toBe(true);
  });

  it('leaves a live router on a newer protocol alone, and one on the same', () => {
    const watch = new RouterWatch();
    for (let now = 0; now < 30 * second; now += second) {
      watch.heardFrom('router-new', now, 3);
      expect(watch.shouldTakeOver(queue, 'router-new', now, 2)).toBe(false);
      watch.heardFrom('router-same', now, 2);
      expect(watch.shouldTakeOver('automerge:other-queue', 'router-same', now, 2)).toBe(false);
    }
  });

  it('still replaces a router on a newer protocol once it has gone quiet', () => {
    // the one person on the newer build went home; the queue must not be stranded
    const watch = new RouterWatch();
    watch.heardFrom('router-new', 0, 3);
    watch.shouldTakeOver(queue, 'router-new', 0, 2);
    expect(watch.shouldTakeOver(queue, 'router-new', TAKEOVER_THRESHOLD_MS + 1, 2)).toBe(true);
  });

  it('settles on one router when three start at once', () => {
    // Each router takes over as the rule allows; the queue doc is modelled as
    // one shared value, and a router sends heartbeats from 3s after taking over
    // for as long as it is still the one named.
    const routers = ['router-a', 'router-b', 'router-c'];
    const watches = new Map(routers.map((router) => [router, new RouterWatch()]));
    let active: string | null = 'router-that-died';
    let activeSince = 0;
    let takeovers = 0;

    for (let now = 0; now <= 120 * second; now += second) {
      if (active && routers.includes(active) && now - activeSince >= 3 * second) {
        for (const watch of watches.values()) watch.heardFrom(active, now);
      }
      for (const router of routers) {
        const watch = watches.get(router)!;
        if (active === router) {
          watch.stopWatching(queue);
        } else if (watch.shouldTakeOver(queue, active, now)) {
          active = router;
          activeSince = now;
          takeovers++;
        }
      }
    }

    expect(routers).toContain(active);
    // one for each router that saw the dead one time out in the same second
    expect(takeovers).toBeLessThanOrEqual(routers.length);
    expect(120 * second - activeSince).toBeGreaterThan(100 * second);
  });
});
