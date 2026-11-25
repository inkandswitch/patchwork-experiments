/**
 * Threepane with its document area in the sandboxed iframe.
 *
 * Threepane doesn't know about isolation. It has a generic hook: if its frame
 * tool's element carries `document-area-host="<component id>"`, it renders
 *
 *   <patchwork-view
 *     component="<component id>"
 *     root-component="threepane-document-area"
 *     doc-urls="automerge:…,automerge:…">
 *     <script type="application/json">{…props}</script>
 *   </patchwork-view>
 *
 * instead of rendering its document area inline. This file supplies both ends:
 *
 * - the `threepane-isolation` frame tool, which loads threepane's own frame
 *   tool from the registry and runs it with `document-area-host` pointed at
 * - `threepane-isolation-host`, which turns that element into a
 *   `patchwork-isolation` one (allowlist, bridged providers and tools, the
 *   props script) and mounts isolation on it.
 *
 * Inside the iframe, `threepane-document-area` resolves from the iframe's own
 * registry, which carries the same plugins as the host.
 */

import type { ComponentRender } from "@inkandswitch/patchwork-elements";
import {
  getRegistry,
  type ToolDescription,
  type ToolRender,
} from "@inkandswitch/patchwork-plugins";
import { mountIsolation } from "./component.js";

export const THREEPANE_ISOLATION_HOST = "threepane-isolation-host";

/**
 * Providers the document area subscribes to from outside itself.
 * `patchwork:worker-channel` lets isolated tools use workers, which run out
 * here under threepane's patchwork-worker-provider.
 */
const SHARED_PROVIDERS =
  "patchwork:contact,patchwork:selected-doc,patchwork:worker-channel";

/** Host tools an isolated tool may open with patchwork:open-tool. */
const SHARED_TOOLS = "llm-config-tray";

/** The `threepane-isolation` frame tool: threepane, document area isolated. */
export async function loadThreepaneIsolationTool(): Promise<ToolRender> {
  const threepane = await getRegistry<ToolDescription>(
    "patchwork:tool"
  ).loadWhenReady("threepane");
  const render = threepane.module as ToolRender;
  return (handle, element) => {
    element.setAttribute("document-area-host", THREEPANE_ISOLATION_HOST);
    const cleanup = render(handle, element);
    return () => {
      cleanup();
      element.removeAttribute("document-area-host");
    };
  };
}

/**
 * The `threepane-isolation-host` mount fn: adapts threepane's document-area
 * element to `patchwork-isolation`'s config surface, then mounts isolation.
 * `doc-urls` is mirrored to `automerge-allowlist`, so a document change still
 * reboots the iframe.
 */
export const mountThreepaneIsolationHost: ComponentRender = (element, repo) => {
  element.setAttribute("shared-providers", SHARED_PROVIDERS);
  element.setAttribute("shared-tools", SHARED_TOOLS);
  element
    .querySelector(':scope > script[type="application/json"]')
    ?.setAttribute("data-root-component-data", "");

  const syncAllowlist = () =>
    element.setAttribute(
      "automerge-allowlist",
      element.getAttribute("doc-urls") ?? ""
    );
  syncAllowlist();
  const observer = new MutationObserver(syncAllowlist);
  observer.observe(element, { attributes: true, attributeFilter: ["doc-urls"] });

  const unmount = mountIsolation(element, repo);
  return () => {
    observer.disconnect();
    unmount();
  };
};
