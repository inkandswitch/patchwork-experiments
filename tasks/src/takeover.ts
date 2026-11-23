// When may a router replace a task queue's active router? When that router has
// been quiet for too long. "Quiet" has to be measured from when this router
// first saw it in charge, not from its last heartbeat alone: a router that has
// only just taken over hasn't had the chance to send one, and a router that has
// only just started hasn't had the chance to hear one.
//
// Counting from the last heartbeat alone, "never heard from it" reads as "dead
// for ever", and every router replaces a new active router the moment it sees
// one. Two or more routers then take the queue from each other without end,
// none in charge long enough to send the heartbeat that would stop the others.

/** How long an active router may go unheard before another replaces it. */
export const TAKEOVER_THRESHOLD_MS = 10_000;

export class RouterWatch {
  private readonly lastHeartbeat = new Map<string, number>();
  private readonly inCharge = new Map<string, { routerUrl: string; since: number }>();

  /** A heartbeat arrived from `routerUrl`. */
  heardFrom(routerUrl: string, now = Date.now()) {
    this.lastHeartbeat.set(routerUrl, now);
  }

  /**
   * Whether to replace `activeRouterUrl`, the router the queue's doc names as
   * active. Call it each time round with what the doc says now: that is how it
   * notices a new router taking over, and starts that router's grace period.
   */
  shouldTakeOver(queueUrl: string, activeRouterUrl: string | null, now = Date.now()) {
    if (!activeRouterUrl) {
      // nobody to wait for
      this.inCharge.delete(queueUrl);
      return true;
    }

    let watched = this.inCharge.get(queueUrl);
    if (watched?.routerUrl !== activeRouterUrl) {
      watched = { routerUrl: activeRouterUrl, since: now };
      this.inCharge.set(queueUrl, watched);
    }

    const lastSignOfLife = Math.max(watched.since, this.lastHeartbeat.get(activeRouterUrl) ?? 0);
    return now - lastSignOfLife > TAKEOVER_THRESHOLD_MS;
  }

  /**
   * This router is the active one for `queueUrl`, or no longer follows it. If
   * another router is named later, its grace period starts from then.
   */
  stopWatching(queueUrl: string) {
    this.inCharge.delete(queueUrl);
  }
}
