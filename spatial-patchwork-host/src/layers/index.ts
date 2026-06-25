import type { SpatialLayer } from "./types.js";
import { apriltagsLayer } from "./apriltags/index.js";
import { wallsLayer } from "./walls/index.js";

/**
 * The recognition layers the host runs, in PIPELINE ORDER. Each layer sees the
 * regions earlier layers claimed (via the shared frame mask) and ignores them.
 * AprilTags first (claims tag quads), then walls (black marker drawings; ignores
 * already-claimed pixels). To add a layer, create a module under
 * src/layers/<name>/ and add its descriptor here — nothing else in the host
 * needs editing (index.ts / providers.ts / UseStage all derive from this array).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const LAYERS: SpatialLayer<any>[] = [apriltagsLayer, wallsLayer];
