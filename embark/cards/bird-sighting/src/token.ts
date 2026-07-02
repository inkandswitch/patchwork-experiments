import type { ToolRender } from "@inkandswitch/patchwork-plugins";

// The inline token face for a bird-card: a compact chip reading "🐦 <name>",
// sized to the editor's line box so it never grows the line it sits on. Plain
// DOM with inline styles, re-rendered on change. The `(handle, element)`
// signature is the standard tool contract the unified token renderer and
// `<patchwork-view>` both call.
export const BirdCardToken: ToolRender = (handle, element) => {
  const paint = () => {
    const doc = (handle.doc() || {}) as {
      name?: unknown;
      howMany?: unknown;
      "@patchwork"?: { title?: unknown };
    };
    element.replaceChildren();

    const chip = document.createElement("span");
    chip.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;padding:0 10px;margin:0;" +
      "box-sizing:border-box;height:24.8px;" +
      "border:1px solid rgba(0,0,0,0.12);border-radius:12px;background:#ffffff;" +
      "box-shadow:0 1px 2px rgba(0,0,0,0.06);" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;" +
      "line-height:1;color:#111827;vertical-align:middle;white-space:nowrap;";

    const icon = document.createElement("span");
    icon.textContent = "🐦";
    icon.style.cssText = "font-size:15px;line-height:1;";

    const label = document.createElement("span");
    const title =
      (typeof doc.name === "string" && doc.name) ||
      (typeof doc["@patchwork"]?.title === "string" &&
        doc["@patchwork"]?.title) ||
      "Bird";
    label.textContent = title;

    chip.append(icon, label);

    const howMany = doc.howMany;
    if (typeof howMany === "number" && howMany > 1) {
      const meta = document.createElement("span");
      meta.style.cssText = "color:#6b7280;font-weight:600;";
      meta.textContent = " · ×" + howMany;
      chip.append(meta);
    }

    element.append(chip);
  };

  const onChange = () => paint();
  handle.on("change", onChange);
  paint();
  return () => {
    handle.off("change", onChange);
    element.replaceChildren();
  };
};
