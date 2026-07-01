import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The @mention codemirror extension is no longer registered globally (it used to
// be baked into every markdown editor). It now ships only as a factory that the
// Mentions card publishes into the canvas `CodemirrorExtensions` channel while
// the card is present (see @embark/mentions-card and
// @embark/codemirror-extensions-host). Nothing is registered from this package.
export const plugins: Plugin<any>[] = [];

export { mentionSearch } from "./extension";
