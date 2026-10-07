// The host's plugin registry, late-bound. Main thread only (never imported by
// the worker-evaluated entry). Resolves to getRegistry, or null when the
// registry isn't there (a test, a bare page): callers degrade to "no provider".

let pending = null;

export function loadGetRegistry() {
  pending ??= import("@inkandswitch/patchwork-plugins")
    .then((m) => (typeof m?.getRegistry === "function" ? m.getRegistry : null))
    .catch(() => null);
  return pending;
}
