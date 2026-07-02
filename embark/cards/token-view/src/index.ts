import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The generic token view. It is pinned explicitly by `tool-id` (e.g.
// `<patchwork-view doc-url="…" tool-id="token-view">`), never matched by
// datatype — it declares no `supportedDatatypes` and is `unlisted`, so it never
// surfaces in pickers or fallbacks. Given a document it finds a registered tool
// that supports the document's datatype AND is tagged `"token"`, loads it, and
// delegates; otherwise it paints a generic title pill and upgrades in place if
// a matching token tool registers later.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "token-view",
    name: "Token",
    icon: "Tag",
    supportedDatatypes: [],
    unlisted: true,
    async load() {
      const { TokenView } = await import("./TokenView");
      return TokenView;
    },
  },
];
