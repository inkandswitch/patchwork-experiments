import type { ContextViewMount } from "@embark/context";
import "./views.css";

// The `map-extension` context view: the values on the `map:extensions` channel
// are live extension functions, not JSON, so there is nothing meaningful to
// draw — a muted placeholder stands in (the keys cards publish under are the
// informative part).
export const mapExtensionView: ContextViewMount = (element) => {
  const chip = document.createElement("span");
  chip.className = "embark-map-extension-face";
  chip.textContent = "\u2039extension\u203a";
  element.appendChild(chip);
  return () => chip.remove();
};
