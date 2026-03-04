import { plugins as tldrawPlugins } from "./tldraw/index.ts";
import { plugins as processPlugins } from "./process/index.ts";
import { plugins as chatPlugins } from "./chat/index.ts";
import { plugins as workerPlugins } from "./worker/index.ts";
import { plugins as workspacePlugins } from "./workspace/index.ts";
import { plugins as dropzonePlaygroundPlugins } from "./dropzone-playground/index.ts";

export const plugins = [
  ...tldrawPlugins,
  ...processPlugins,
  ...chatPlugins,
  ...workerPlugins,
  ...workspacePlugins,
  ...dropzonePlaygroundPlugins,
];
