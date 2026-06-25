import type { SpatialLayer } from "./types.js";
import { apriltagsLayer } from "./apriltags/index.js";

/**
 * The recognition layers the host runs. To add a layer (line drawings, words,
 * …), create a module under src/layers/<name>/ and add its descriptor here —
 * nothing else in the host needs editing (index.ts / providers.ts / UseStage
 * all derive from this array).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LAYERS: SpatialLayer<any>[] = [apriltagsLayer];
