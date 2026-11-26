/** What tests ask of a session document. */

import { statusOf } from "../session/status.js"

/** A session's status once its run has ended (session/status.js). */
export const settled = (doc) => statusOf(doc)
