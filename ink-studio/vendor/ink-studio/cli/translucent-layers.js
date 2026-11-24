/* Deposit translucent optical depth into two neighboring axial slices. Inside a
 * slice the contributions mix continuously. Across slices they still occlude
 * each other back to front. The resulting weights go through the usual passes. */
function blendLayers(layers, width) {
  for (let first = 0; first + 1 < layers.length;) {
    if (!layers[first].transparent) { first++; continue; }
    let end = first + 1;
    while (end < layers.length && layers[end].transparent &&
        layers[end - 1].sort - layers[end].sort < 2 * width) end++;
    if (end - first > 1 && Number.isSafeInteger(Math.floor(layers[first].sort / width)))
      blendRun(layers, first, end, width);
    first = end;
  }
}

function blendRun(layers, first, end, width) {
  const slices = new Map();
  const entries = [];
  function add(depth, amount, pane) {
    let slice = slices.get(depth);
    if (!slice) {
      slice = { extinction: 0, visible: 0 };
      slices.set(depth, slice);
    }
    slice.extinction += amount;
    if (pane) {
      slice.panes ??= new Map();
      slice.panes.set(pane, (slice.panes.get(pane) || 0) + amount);
    }
    return slice;
  }
  for (let i = end - 1; i >= first; i--) {
    const fragment = layers[i], depth = fragment.sort / width, near = Math.floor(depth), fraction = depth - near;
    const extinction = -Math.log1p(-Math.min(1 - 1e-12, fragment.opacity));
    const nearAmount = (1 - fraction) * extinction, farAmount = fraction * extinction;
    entries.push({
      fragment, fraction, nearAmount, farAmount,
      near: add(near, nearAmount, fragment.pane), far: add(near + 1, farAmount, fragment.pane)
    });
  }
  let transmission = 1;
  for (const slice of slices.values()) {
    const amount = slice.extinction;
    slice.visible = amount ? transmission * -Math.expm1(-amount) / amount : 0;
    transmission *= Math.exp(-amount);
  }
  let remaining = 1;
  for (const { fragment, fraction, near, far, nearAmount, farAmount } of entries) {
    const visible = nearAmount * near.visible + farAmount * far.visible;
    fragment.opacity = remaining > 0 ? Math.min(1, visible / remaining) : 0;
    remaining = Math.max(0, remaining - visible);
    if (fragment.pane) {
      // Other surfaces sharing these slices weaken the single-backdrop refraction approximation.
      const nearOther = near.extinction - near.panes.get(fragment.pane);
      const farOther = far.extinction - far.panes.get(fragment.pane);
      const u = Math.max(0, Math.min(1, (nearOther * (1 - fraction) + farOther * fraction) / .25));
      fragment.refraction = 1 - u * u * (3 - 2 * u);
    }
  }
}

module.exports = { blendLayers };
