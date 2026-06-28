import { render } from "solid-js/web";
import { createSketchyApi } from "./api.js";
import { Canvas } from "./brush/canvas.jsx";

// Thin plugin entry: set up the public api on the element, mount the Canvas.
export function NewspaceTool(handle, element) {
  element.api = createSketchyApi({ repo: element.repo, element });
  const dispose = render(() => Canvas({ handle, repo: element.repo, element }), element);
  return () => { delete element.api; dispose(); };
}
