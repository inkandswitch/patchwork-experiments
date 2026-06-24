import type { Datatype, Plugin, Tool } from "@inkandswitch/patchwork-plugins";
import { actions } from "./actions";
import "./index.css";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:datatype",
    id: "card-table",
    name: "Card Table",
    icon: "Layers",
    async load() {
      const { CardTableDatatype } = await import("./datatype");
      return CardTableDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "card-zone",
    name: "Card Zone",
    icon: "Layers",
    async load() {
      const { CardZoneDatatype } = await import("./sub-datatypes");
      return CardZoneDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "card-table-keys",
    name: "Card Table Keys",
    icon: "Key",
    async load() {
      const { CardTableKeysDatatype } = await import("./keys-datatype");
      return CardTableKeysDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:tool",
    id: "card-table",
    name: "Card Table",
    icon: "Layers",
    supportedDatatypes: ["card-table"],
    async load() {
      const { CardTableTool } = await import("./tools/table-tool");
      return CardTableTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "card-zone",
    name: "Card Zone",
    icon: "Layers",
    supportedDatatypes: ["card-zone"],
    async load() {
      const { CardZoneTool } = await import("./tools/zone-tool");
      return CardZoneTool;
    },
  } satisfies Tool,
  ...actions,
];
