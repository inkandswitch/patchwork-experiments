/**
 * `@patchwork/isolation` — tool isolation as a patchwork-base package.
 *
 * The public surface is the `plugins` array (the shape every patchwork module
 * exports). Isolation is delivered as a single `patchwork:component` resolved by
 * id through the registry — the sanctioned cross-package mechanism — so no
 * consumer ever imports this package; they mount it with
 * `<patchwork-view component="patchwork-isolation" …>`. See ./component.ts for
 * the mount contract and the DOM config surface.
 */

import { Plugin } from "@inkandswitch/patchwork-plugins";
import { mountIsolation } from "./component.js";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:component",
    id: "patchwork-isolation",
    name: "Patchwork Isolation",
    load: async () => mountIsolation,
  },
];
