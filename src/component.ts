/**
 * The isolation `patchwork:component` mount function.
 *
 * In patchwork-base, cross-package units are resolved through the registry by
 * id — never imported. So isolation ships as a `patchwork:component`
 * (`patchwork-isolation`) rather than the custom element it is in core. The
 * consumer mounts it with `<patchwork-view component="patchwork-isolation">` and
 * hands it the boot spec off that element's DOM surface:
 *
 *   <patchwork-view
 *     component="patchwork-isolation"
 *     root-component="threepane-isolation-root"       // → spec.rootComponentId
 *     automerge-allowlist="automerge:abc,automerge:def" // → spec.rootUrls (allowlist seeds)
 *     shared-providers="patchwork:contact,...">        // read by bootIsolation itself
 *     <script type="application/json">{...}</script>   // → spec.props
 *   </patchwork-view>
 *
 * `bootIsolation` already takes an `HTMLElement` host: it reads
 * `shared-providers` and the `<repo-provider>` ancestor off it and appends the
 * iframe to it. So the mounted `<patchwork-view>` element is a drop-in host.
 *
 * `patchwork-view` only re-syncs a component on `component`/`url` attribute
 * changes, so it will NOT reboot when the boot config changes. This mount fn
 * therefore self-observes the boot-affecting *attributes* (`root-component`,
 * `automerge-allowlist`, `shared-providers`) with a `MutationObserver` and
 * reboots the iframe when one changes — matching the fresh-iframe semantics of
 * core's `configure()`. It deliberately does NOT observe the props `<script>`
 * child or the element's subtree; see the mount fn for why (the iframe is a
 * child of this element, so subtree observation would loop).
 */

import type { AutomergeUrl } from "@automerge/automerge-repo";
import { bootIsolation, type IsolationHandle } from "./boot/index.js";
import type { IsolationBootSpec } from "./types.js";
import { log } from "./log.js";

/**
 * A component receives the element it is mounted on plus the realm-local base
 * `Repo` and returns a cleanup fn. Declared locally (rather than imported from
 * `@inkandswitch/patchwork-elements`) so the package carries no cross-import for
 * a shape it only needs structurally — the render fn ignores `repo`, reading the
 * host repo off the `<repo-provider>` ancestor as `bootIsolation` does.
 */
export type IsolationComponentRender = (
  element: HTMLElement,
  repo: unknown
) => () => void;

/** Read the boot spec off the mounted element's attributes + props JSON child. */
function readSpec(element: HTMLElement): IsolationBootSpec {
  const rootComponentId = element.getAttribute("root-component") ?? "";
  const rootUrls = (element.getAttribute("automerge-allowlist") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as AutomergeUrl[];
  return { rootComponentId, rootUrls, props: readProps(element) };
}

/**
 * Parse the inert `<script type="application/json">` child that carries `props`.
 * Only a direct child is read (never a descendant of the isolated subtree, which
 * lives inside the iframe anyway). Absent/malformed → empty props.
 */
function readProps(element: HTMLElement): Record<string, unknown> {
  const script = Array.from(element.children).find(
    (c): c is HTMLScriptElement =>
      c.tagName === "SCRIPT" &&
      (c as HTMLScriptElement).type === "application/json"
  );
  if (!script?.textContent) return {};
  try {
    return JSON.parse(script.textContent) as Record<string, unknown>;
  } catch (err) {
    console.error("[patchwork-isolation] bad props JSON:", err);
    return {};
  }
}

/**
 * The `patchwork:component` mount function: `(element, repo) => cleanup`. Boots
 * the isolation iframe from the element's DOM config and reboots it on change.
 */
export const mountIsolation: IsolationComponentRender = (element) => {
  let handle: IsolationHandle | null = bootIsolation(element, readSpec(element));

  // Reboot only when a boot-affecting ATTRIBUTE changes — `root-component`
  // (which root to mount), `automerge-allowlist` (the sync allowlist seed), or
  // `shared-providers` (the bridged set). All are consumed host-side when the
  // iframe is built, so a change there requires a fresh boot.
  //
  // We deliberately do NOT observe childList/subtree/characterData:
  //  - bootIsolation appends the iframe as a child of `element` (and teardown
  //    removes it); watching childList would let the iframe's own churn
  //    retrigger the observer and loop init/teardown forever.
  //  - `props` (the inert <script> child) is consumed *inside* the iframe by the
  //    mounted root, which reads it once at mount. A props-only change (e.g.
  //    toggling a collapse flag with no new document) therefore does not reboot
  //    and will not take effect until the next attribute-driven reboot. In
  //    practice the doc-bearing props (selected doc, tray/context slot docs) are
  //    also reflected in `automerge-allowlist`, so selecting a different document already
  //    reboots. If in-place props updates are needed later, postMessage them to
  //    the iframe rather than widening this observer.
  let checkQueued = false;
  const maybeReboot = () => {
    if (checkQueued) return;
    checkQueued = true;
    queueMicrotask(() => {
      checkQueued = false;
      log("config attribute changed; rebooting iframe");
      handle?.teardown();
      handle = bootIsolation(element, readSpec(element));
    });
  };

  const observer = new MutationObserver(maybeReboot);
  observer.observe(element, {
    attributes: true,
    attributeFilter: ["root-component", "automerge-allowlist", "shared-providers"],
  });

  return () => {
    observer.disconnect();
    handle?.teardown();
    handle = null;
  };
};
