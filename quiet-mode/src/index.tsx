import { Plugin, ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { render } from "solid-js/web";
import type { AccountDoc } from "./types";

export const plugins: Plugin<any>[] = [
  {
    type: "patchwork:tool",
    id: "quiet-frame",
    tags: ["frame-tool"],
    name: "Quiet Frame",
    icon: "Window",
    supportedDatatypes: ["account"],
    async load(): Promise<ToolImplementation<AccountDoc>> {
      const { PatchworkFrame } = await import("./frame/PatchworkFrame");
      return (handle, element) => {
        return render(
          () => (
            <PatchworkFrame
              handle={handle}
              element={element}
              repo={element.repo}
            />
          ),
          element
        );
      };
    },
  },
];
