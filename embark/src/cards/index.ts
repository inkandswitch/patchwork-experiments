import type { Plugin } from "@inkandswitch/patchwork-plugins";
import { plugins as poiPlugins } from "./poi";
import { plugins as weatherPlugins } from "./weather";

// Hard-coded "cards": fixed tool + datatype pairs that behave like the LLM card
// (reading/writing canvas context channels) but with pre-written behavior, each
// presented as a playing card with a title and a description of what it does.
export const plugins: Plugin<any>[] = [...poiPlugins, ...weatherPlugins];
