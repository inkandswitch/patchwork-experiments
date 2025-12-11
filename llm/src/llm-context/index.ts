import { systemContextPlugin } from "./base-context";
import { actionsContextPlugin } from "./actions-context";
import { todoContextPlugin } from "./actions-todo-context";
import { Plugin } from "@inkandswitch/patchwork-plugins";

export { systemContextPlugin } from "./base-context";
export { actionsContextPlugin } from "./actions-context";
export { todoContextPlugin } from "./actions-todo-context";
export type {
  LLMContextPlugin,
  LLMContextDescription,
  LLMContextImplementation,
  LoadedLLMContext,
} from "./types";

export const plugins: Plugin<any>[] = [
  systemContextPlugin,
  actionsContextPlugin,
  todoContextPlugin,
];
