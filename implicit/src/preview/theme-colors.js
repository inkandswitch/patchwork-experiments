// Resolve the tool's theme tokens (CSS custom properties that may hold
// var() / color-mix() expressions) into sRGB triples for the shader.
//
// A probe element resolves var() and color-mix() through the cascade; a 1×1
// canvas then turns whatever colour syntax the browser reports into bytes.

const TOKENS = {
  color: "--implicit-surface-model",
  bg: "--implicit-surface-stage",
  ink: "--implicit-surface-stage-ink",
  warm: "--implicit-surface-warm",
  cool: "--implicit-surface-cool",
};

const FALLBACK = {
  color: [0.78, 0.66, 0.52],
  bg: [0.97, 0.97, 0.96],
  ink: [0.1, 0.1, 0.12],
  warm: [0.9, 0.45, 0.25],
  cool: [0.25, 0.5, 0.9],
};

let ctx2d = null;
function toRGB(css) {
  try {
    if (!ctx2d) {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      ctx2d = c.getContext("2d", { willReadFrequently: true });
    }
    if (!ctx2d) return null;
    ctx2d.clearRect(0, 0, 1, 1);
    ctx2d.fillStyle = "#000";
    ctx2d.fillStyle = css;
    ctx2d.fillRect(0, 0, 1, 1);
    const d = ctx2d.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch {
    return null;
  }
}

/** @param {HTMLElement} host  an element inside the tool, so the tool's tokens apply */
export function readThemeColors(host) {
  const out = {};
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.append(probe);
  try {
    for (const [key, token] of Object.entries(TOKENS)) {
      probe.style.color = "";
      probe.style.color = `var(${token})`;
      const resolved = getComputedStyle(probe).color;
      out[key] = (resolved && toRGB(resolved)) || FALLBACK[key];
    }
  } finally {
    probe.remove();
  }
  return out;
}
