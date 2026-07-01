import type { Plugin } from "@inkandswitch/patchwork-plugins";

// The Mentions card: a document whose tool, while on a canvas, publishes the
// @mention codemirror extension into the shared `CodemirrorExtensions` channel
// (see @embark/codemirror-extensions-host). Drop it on a canvas to turn mentions
// on for every editor there; remove it to turn them off.
export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "mentions-card",
    name: "Mentions",
    icon: "AtSign",
    async load() {
      const { MentionsCardDatatype } = await import("./datatype");
      return MentionsCardDatatype;
    },
  },
  {
    type: "patchwork:tool",
    id: "mentions-card",
    name: "Mentions",
    icon: "AtSign",
    supportedDatatypes: ["mentions-card"],
    async load() {
      const { MentionsCardTool } = await import("./MentionsCardTool");
      return MentionsCardTool;
    },
  },
];
