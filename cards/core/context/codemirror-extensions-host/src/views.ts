import type { ContextViewMount } from "@embark/context";
import "./views.css";

// The `codemirror-extension` context view: the values on the
// `codemirror:extensions` channel are live CodeMirror `Extension` objects, not
// JSON, so there is nothing meaningful to draw — a muted placeholder stands in
// (the keys cards publish under are the informative part).
export const codemirrorExtensionView: ContextViewMount = (element) => {
  const chip = document.createElement("span");
  chip.className = "embark-cm-extension-face";
  chip.textContent = "\u2039extension\u203a";
  element.appendChild(chip);
  return () => chip.remove();
};
