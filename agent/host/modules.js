/**
 * Automerge and automerge-repo, as the host provides them.
 *
 * Every module of this package that needs them imports them from here, never
 * by bare specifier. A bare `import … from "@automerge/automerge"` resolves
 * only through an importmap, which a page has and a worker does not — so one
 * such line anywhere in the runner's module graph kept the SharedWorker
 * runner from loading at all. Here they are imported through
 * `importSpecifier` (host/urls.js): the importmap in a page, the absolute
 * URLs the page handed over in a worker (set before anything imports this:
 * runners/worker.js), node_modules in node and in tests. In a page and in the
 * worker they are Patchwork's own copies, the ones its repo uses.
 */

import { importSpecifier } from "./urls.js"

export const Automerge = await importSpecifier("@automerge/automerge")
export const AutomergeRepo = await importSpecifier("@automerge/automerge-repo")
