import { plugins as paperPlugins } from "./paper";
import { plugins as lineLayerPlugins } from "./line";
import { plugins as rectLayerPlugins } from "./rect";
import { plugins as embedLayerPlugins } from "./embed";
import { plugins as mapPlugins } from "./map";
import { plugins as surfacePlugins } from "./surface";

export const plugins = [
  ...paperPlugins,
  ...lineLayerPlugins,
  ...rectLayerPlugins,
  ...embedLayerPlugins,
  ...mapPlugins,
  ...surfacePlugins,
];
