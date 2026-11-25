// The study tool: a part, how it is held and loaded, and what a run found,
// with the part in 3D beside its panel to pick faces on.

import css from "./styles.css?inline";
import { createViewport } from "./viewport.js";
import { mountStudyPanel } from "./study-panel.js";

export default function StudyTool(handle, element) {
  const repo = handle.repo ?? window.repo;
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("div");
  root.className = "fea";
  root.innerHTML = `<div class="study"></div>`;
  element.append(style, root);
  const layout = root.firstElementChild;
  const viewport = createViewport(layout);
  const panel = mountStudyPanel(layout, { repo, handle, stage: viewport, element });
  // the panel first in the document, the part beside it
  layout.insertBefore(panel.root, viewport.el);
  // for probes: what the tool is showing
  element.__fea = { panel, viewport };
  return () => {
    delete element.__fea;
    panel.dispose();
    viewport.dispose();
    root.remove();
    style.remove();
  };
}
