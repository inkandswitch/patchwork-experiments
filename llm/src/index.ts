import { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as chatPlugins } from "./chat";

export const plugins: Plugin<any>[] = [...chatPlugins];
