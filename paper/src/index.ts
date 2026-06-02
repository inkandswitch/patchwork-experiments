import {plugins as paperPlugins} from "./paper"
import {plugins as lineLayerPlugins} from "./line-layer"
import {plugins as rectLayerPlugins} from "./rect-layer"

export const plugins = [...paperPlugins, ...lineLayerPlugins, ...rectLayerPlugins]
