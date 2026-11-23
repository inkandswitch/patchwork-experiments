/* eslint-env worker */

// The workers' side of moving to a newer build (see version.ts): stepping down
// when a newer build's workers are up.

import { AVAILABILITY_CHANNEL, type AvailabilityStatus } from './availability';
import { BUILD } from './version';

/**
 * Calls `retire`, once, when a pool of a newer build than this worker's says
 * it's running.
 *
 * It waits for the newer pool's own word rather than for a tab's announcement
 * that a newer build exists. A pool only speaks once it has started, so by then
 * there is something to hand over to; a tab might announce a build whose
 * workers then fail to load, and stepping down for that would leave nothing
 * running at all.
 */
export function retireForNewerBuild(retire: () => void) {
  const channel = new BroadcastChannel(AVAILABILITY_CHANNEL);
  channel.onmessage = ({ data }: MessageEvent<AvailabilityStatus>) => {
    if (typeof data?.build === 'number' && data.build > BUILD) {
      channel.close();
      console.log(`a newer build's workers are up (${data.build} > ${BUILD}); stepping down`);
      retire();
    }
  };
}
