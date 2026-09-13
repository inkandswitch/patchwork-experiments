/**
 * Importing the host's modules, lazily and survivably.
 *
 * Patchwork provides automerge and the plugin registry through an importmap,
 * which exists in the browser and nowhere else. Two consequences shape this
 * file:
 *
 *   - These must be *dynamic* imports. A static `import` of a bare specifier
 *     would also break the plugin entry module, which Patchwork evaluates in a
 *     worker that has no importmap (patchwork-skill §2).
 *   - The specifier has to be opaque to bundlers. Vite resolves dynamic import
 *     specifiers at build time and fails the build when it cannot find one, so
 *     a literal string here breaks `vitest` even inside a try/catch. Passing a
 *     variable with `@vite-ignore` leaves the import alone, which is what we
 *     want: in the browser it resolves through the importmap, and in node it
 *     throws and callers fall back.
 */

const SPECIFIERS = {
  plugins: "@inkandswitch/patchwork-plugins",
  automerge: "@automerge/automerge/slim",
  filesystem: "@inkandswitch/patchwork-filesystem",
  elements: "@inkandswitch/patchwork-elements",
  repo: "@automerge/automerge-repo",
  messagechannel: "@automerge/automerge-repo-network-messagechannel",
}

/**
 * Resolved absolute URLs for the bare specifiers, when we are somewhere the
 * importmap does not exist.
 *
 * A worker has no importmap, so `import "@automerge/automerge-repo"` cannot
 * resolve there. Rather than loading an es-module-shims polyfill from a CDN
 * (which is what the `tasks` package does, and which puts a third-party origin
 * in the boot path of a local-first system), the page reads its own importmap
 * out of the DOM, resolves every specifier against `location`, and hands the
 * table to the worker. Measured working on the deployed shell — see
 * probes/worker-repo.mjs.
 */
let resolvedUrls = null

export function setHostUrls(urls) {
  resolvedUrls = urls ?? null
}

export function hostUrls() {
  return resolvedUrls
}

/** Import a host module by nickname. Rejects outside Patchwork. */
export function hostImport(name) {
  const specifier = SPECIFIERS[name]
  if (!specifier) return Promise.reject(new Error(`Unknown host module: ${name}`))
  const absolute = resolvedUrls?.[specifier]
  return import(/* @vite-ignore */ absolute ?? specifier)
}

/** Import a host module, or null when it is not available (tests, node). */
export async function tryHostImport(name) {
  try {
    return await hostImport(name)
  } catch {
    return null
  }
}
