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

/**
 * Import a bare specifier wherever this is running: through the resolved
 * table in a worker, the importmap in a page, node_modules in node.
 */
export function importSpecifier(specifier) {
  const absolute = resolvedUrls?.[specifier]
  return import(/* @vite-ignore */ absolute ?? specifier)
}
