// What a listener has heard of runs: for each run's name, when the listener
// first saw the run in a document and when the run's pool was last heard
// saying it is going on, both on the listener's own clock. Whether a run
// counts as heard is `isHeard` of those two (rules.ts); this file only keeps
// the times. A pool keeps one to decide what it may take and when to give
// way, and a reader keeps one to say which runs are going on.

import { isHeard } from './rules';

export interface Now {
  now(): number;
}

export class Hearing {
  private readonly firstSeen = new Map<string, number>();
  private readonly lastHeard = new Map<string, number>();

  constructor(private readonly clock: Now = Date) {}

  /**
   * Notes the runs a document lists, each the first time it is shown. A
   * listener shows it every run it reads, as it reads them: rules that stop
   * at the first heard run do not ask about the rest, and a run first seen
   * only when it is first asked about would be counted as heard for longer
   * than it should be.
   */
  saw(runs: Iterable<{ id: string }> | undefined) {
    const now = this.clock.now();
    for (const run of runs ?? []) {
      if (!this.firstSeen.has(run.id)) {
        this.firstSeen.set(run.id, now);
      }
    }
  }

  /**
   * Whether the run with this name counts as heard now. A run asked about
   * that was never shown is taken as seen now: it can only have come from a
   * document the listener is reading.
   */
  heard = (runId: string): boolean => {
    const now = this.clock.now();
    if (!this.firstSeen.has(runId)) {
      this.firstSeen.set(runId, now);
    }
    return isHeard(this.lastHeard.get(runId) ?? null, this.firstSeen.get(runId)!, now);
  };

  /** Notes that the run's pool has just said it is going on. */
  heardFrom(runId: string) {
    this.lastHeard.set(runId, this.clock.now());
  }

  /** Lets go of what is known of a run, once the listener no longer follows its task. */
  forget(runId: string) {
    this.firstSeen.delete(runId);
    this.lastHeard.delete(runId);
  }
}
