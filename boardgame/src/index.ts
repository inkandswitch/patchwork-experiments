import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";
import "./index.css";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "boardgame-collection",
    name: "Board Game Collection",
    icon: "Dices",
    async load() {
      const { BoardgameCollectionDatatype } = await import("./datatype");
      return BoardgameCollectionDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "boardgame",
    name: "Board Game",
    icon: "Dices",
    async load() {
      const { BoardgameDatatype } = await import("./datatype");
      return BoardgameDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "boardgame-collection",
    name: "Board Game Collection",
    icon: "Dices",
    supportedDatatypes: ["boardgame-collection"],
    async load() {
      const { BoardgameCollectionTool } = await import("./tool");
      return BoardgameCollectionTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "boardgame",
    name: "Board Game",
    icon: "Dices",
    supportedDatatypes: ["boardgame"],
    async load() {
      const { BoardgameTool } = await import("./game-tool");
      return BoardgameTool;
    },
  } satisfies Tool,
];
