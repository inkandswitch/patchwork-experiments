// Telling whether a frozen value (a stage's local, the view's value) changed
// in what a reader shows. Pure.

/** Has anything but these keys changed? (a shallow compare of two objects) */
export function localChanged(prev, next, ignore = ["hovered"]) {
  if (prev === next) return false;
  if (!prev || !next) return true;
  const skip = new Set(ignore);
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) if (!skip.has(k) && prev[k] !== next[k]) return true;
  return false;
}
