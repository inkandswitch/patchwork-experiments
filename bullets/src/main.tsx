import { render } from "solid-js/web";
import type { DocHandle } from "@automerge/automerge-repo";
import { datatype } from "./datatype.ts";
import type { BulletsDoc } from "./datatype.ts";

export const plugins = [
  {
    type: "patchwork:datatype" as const,
    id: "bullets",
    name: "Bullets",
    icon: "List",
    async load() {
      return datatype;
    },
  },
  {
    type: "patchwork:tool" as const,
    id: "bullets",
    name: "Bullets",
    supportedDataTypes: ["bullets"],
    async load() {
      const { BulletsTool } = await import("./tool.tsx");
      return (handle: DocHandle<BulletsDoc>, element: HTMLElement) => {
        return render(
          () => <BulletsTool handle={handle} element={element} />,
          element
        );
      };
    },
  },
];
