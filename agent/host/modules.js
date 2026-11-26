/**
 * Automerge and automerge-repo, as the host provides them.
 *
 * Every module of this package that needs them imports them from here, never
 * by bare specifier. A bare `import … from "@automerge/automerge"` resolves
 * only through an importmap, which a page has and a worker does not, unless
 * whoever loads the worker resolves it (a pool's run worker does: the tasks
 * package's README, "bare imports"). Here they are imported through
 * `importSpecifier` (host/urls.js): the importmap in a page, the absolute
 * URLs a worker was handed, node_modules in node and in tests. In a page they
 * are Patchwork's own copies, the ones its repo uses.
 */

import { importSpecifier } from "./urls.js"

export const Automerge = await importSpecifier("@automerge/automerge")
export const AutomergeRepo = await importSpecifier("@automerge/automerge-repo")
