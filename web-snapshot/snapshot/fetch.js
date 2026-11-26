/**
 * The fetch a person's capture uses, from the snapshot view.
 *
 * The view runs in a person's tab with no agent behind it, so there is no
 * `ctx.fetchImpl` to borrow: it builds its own guarded fetch here, refusing
 * exactly what the agent's page fetch (its `tabFetch`) refuses — this page's
 * own origin, which serves the person's documents to anyone asking by URL, the
 * sync servers, and every local or private address (guard.js). It is the only place in the
 * package that names the platform's fetch, and it never hands it out bare.
 */

import { guardedFetch, SYNC_SERVERS } from "../guard.js"

export function viewFetch() {
  return guardedFetch({ fetch: (url, init) => fetch(url, init), deny: [location.origin, ...SYNC_SERVERS] })
}
