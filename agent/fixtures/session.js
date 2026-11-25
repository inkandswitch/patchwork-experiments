/** What tests ask of a session document. */

import { statusOf } from "../session/status.js"

/**
 * A session's status once its runner has let go of it. A loop run on its own
 * (kernel/loop.js run) leaves the lease as it found it, held: giving it up is
 * its runner's part.
 */
export const settled = (doc) => statusOf({ ...doc, lease: null })
