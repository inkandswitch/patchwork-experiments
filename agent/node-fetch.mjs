/**
 * The fetch every tool uses when the agent runs in node.
 *
 * Outside a browser nothing else stands between a tool and this machine, its
 * network or the cloud metadata address, so the guard does all of it here:
 * redirects are followed one checked hop at a time, and every address a name
 * resolves to must be public. The node runner and the node probe both build
 * their fetch here, so neither can quietly leave out the DNS check.
 *
 *   sync    the sync server this process talks to, refused like the default ones
 *   fetch   what to guard; the platform's by default
 *   lookup  host -> [{address}]; node's resolver by default
 */

import { lookup as resolve } from "node:dns/promises"
import { guardedFetch, SYNC_SERVERS } from "./tools/guard.js"

export function nodeFetch({ sync = null, fetch: send = (url, init) => fetch(url, init), lookup = (host) => resolve(host, { all: true }) } = {}) {
  return guardedFetch({
    fetch: send,
    deny: [sync, ...SYNC_SERVERS].filter(Boolean),
    direct: true,
    lookup,
  })
}
