import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as partsBinPlugins } from "./parts-bin";
import { plugins as deckPlugins } from "./deck";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    supportedDatatypes: ["embark-canvas"],
    async load() {
      const { EmbarkCanvasTool } = await import("./canvas");
      return EmbarkCanvasTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "embark-canvas",
    name: "Embark Canvas",
    icon: "LayoutGrid",
    async load() {
      const { EmbarkCanvasDatatype } = await import("./datatype");
      return EmbarkCanvasDatatype;
    },
  },
  {
    // The Cards sidebar entry. The frame's context sidebar renders every
    // `patchwork:component` tagged `context-tool` (like drafts and comments)
    // as a bare component with no document; this one docks the always-on
    // Cards host: the Global / Current Doc card stacks plus the parts bin
    // (see CardsSidebarComponent). The host is shared with the toolbar keeper
    // below through a lease, so the cards keep running while the sidebar is
    // closed as long as the keeper holds it.
    type: "patchwork:component",
    id: "cards",
    tags: ["context-tool"],
    name: "Cards",
    icon: "Layers",
    async load() {
      const { CardsSidebarComponent } = await import("./card-stack/host");
      return CardsSidebarComponent;
    },
  },
  {
    // The always-on keeper: add it to the frame's toolbar lane (via the frame
    // configurator) and it holds a lease on the Cards host, keeping the cards
    // running while the sidebar is closed. Renders nothing and ignores the
    // doc it's pointed at.
    type: "patchwork:tool",
    id: "cards-keeper",
    tags: ["titlebar-tool"],
    name: "Cards",
    icon: "Layers",
    supportedDatatypes: "*",
    unlisted: true,
    async load() {
      const { CardsKeeperTool } = await import("./card-stack/host");
      return CardsKeeperTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "card-stack",
    name: "Card Stack",
    icon: "Layers",
    // Created programmatically by the Cards sidebar (the global singleton and
    // the per-document stacks), never from the "new document" menu, so keep
    // it out of the datatype picker.
    unlisted: true,
    async load() {
      const { CardStackDatatype } = await import("./card-stack/datatype");
      return CardStackDatatype;
    },
  },
  {
    // A stack as a full-frame document tool: one pane, no tabs, plus the
    // collapsible parts bin. Lets card-stack docs open like any document, and
    // is what the browser extension's side panel deep-links to via
    // `#frame=card-stack&doc=<id>` (see cards-browser-extension).
    type: "patchwork:tool",
    id: "card-stack",
    name: "Card Stack",
    icon: "Layers",
    supportedDatatypes: ["card-stack"],
    async load() {
      const { CardStackTool } = await import("./card-stack/CardStackTool");
      return CardStackTool;
    },
  },
  ...partsBinPlugins,
  ...deckPlugins,
];
