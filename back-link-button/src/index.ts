import { Plugin } from "@inkandswitch/patchwork-plugins";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "back-link-button",
    tags: ["titlebar-tool"],
    name: "Back Link Button",
    icon: "ArrowLeft",
    supportedDatatypes: "*",
    async load() {
      const { renderBackLinkButton } = await import("./BackLinkButton");
      return renderBackLinkButton;
    },
    unlisted: true,
    forTitleBar: true,
  },
];
