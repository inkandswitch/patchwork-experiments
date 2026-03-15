import type { DocHandle } from "@automerge/automerge-repo";
import type { CanvasDoc, Disposer } from "./types.js";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";
import { ShapeRenderLayer } from "./shape-render-layer.js";

const ShapesLayer = (handle: DocHandle<CanvasDoc>, element: PatchworkViewElement): Disposer => {
  const layer = new ShapeRenderLayer(handle, element, element.repo);
  return () => layer.dispose();
};

export default ShapesLayer;
