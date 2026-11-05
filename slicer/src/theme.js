// Turning the tool's CSS custom properties into numbers three.js can use.
// Colours may be var()/color-mix()/oklch() expressions, so let the browser
// resolve them: computed `color` on a probe element, then a 1×1 canvas to get
// sRGB bytes out of whatever colour space that came back in.

let ctx = null;

function canvasCtx() {
  if (ctx) return ctx;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    ctx = c.getContext("2d", { willReadFrequently: true });
  } catch {
    ctx = null;
  }
  return ctx;
}

/** @returns {[number, number, number]} sRGB 0..1, or the fallback */
export function resolveCssColor(el, varName, fallback = [0.5, 0.5, 0.5]) {
  if (!el?.isConnected) return fallback;
  const probe = document.createElement("span");
  probe.style.color = `var(${varName})`;
  probe.style.display = "none";
  el.appendChild(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  if (!css) return fallback;
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css);
  if (rgb) return [rgb[1] / 255, rgb[2] / 255, rgb[3] / 255];
  const g = canvasCtx();
  if (!g) return fallback;
  g.clearRect(0, 0, 1, 1);
  g.fillStyle = "#000";
  g.fillStyle = css;
  g.fillRect(0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

/** Call `fn` whenever the Patchwork theme (or the OS colour scheme) changes. */
export function onThemeChange(fn) {
  const mo = new MutationObserver(() => fn());
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["theme", "class", "style", "data-theme"] });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", fn);
  return () => {
    mo.disconnect();
    mq?.removeEventListener?.("change", fn);
  };
}
