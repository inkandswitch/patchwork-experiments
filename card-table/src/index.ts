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
    id: "secure-deck",
    name: "Secure Deck",
    icon: "Copy",
    async load() {
      const { SecureDeckDatatype } = await import("./sub-datatypes");
      return SecureDeckDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "secure-hand",
    name: "Secure Hand",
    icon: "Hand",
    async load() {
      const { SecureHandDatatype } = await import("./sub-datatypes");
      return SecureHandDatatype;
    },
  } as Datatype,
  {
    type: "patchwork:datatype",
    id: "secure-pile",
    name: "Secure Pile",
    icon: "SquareStack",
    async load() {
      const { SecurePileDatatype } = await import("./sub-datatypes");
      return SecurePileDatatype;
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
    id: "secure-deck",
    name: "Deck",
    icon: "Copy",
    supportedDatatypes: ["secure-deck"],
    async load() {
      const { SecureDeckTool } = await import("./tools/deck-tool");
      return SecureDeckTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "secure-hand",
    name: "Secure Hand",
    icon: "Hand",
    supportedDatatypes: ["secure-hand"],
    async load() {
      const { SecureHandTool } = await import("./tools/hand-tool");
      return SecureHandTool;
    },
  } satisfies Tool,
  {
    type: "patchwork:tool",
    id: "secure-pile",
    name: "Secure Pile",
    icon: "SquareStack",
    supportedDatatypes: ["secure-pile"],
    async load() {
      const { SecurePileTool } = await import("./tools/pile-tool");
      return SecurePileTool;
    },
  } satisfies Tool,
  ...actions,
];
