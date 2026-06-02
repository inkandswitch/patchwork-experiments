import {plugins as paperPlugins} from "./paper"
import {plugins as lineLayerPlugins} from "./line"
import {plugins as rectLayerPlugins} from "./rect"

export const plugins = [...paperPlugins, ...lineLayerPlugins, ...rectLayerPlugins]
