// Pointer lock for headless Chrome, which refuses it ("WrongDocumentError"); sailing-probe.html loads this with ?lock=1:
// requestPointerLock grants at once, document.pointerLockElement reports it,
// and pointer moves carry movementX/Y from their client deltas (CDP moves
// don't set them). window.__mouseReset() forgets the last spot, so the next
// move is a zero delta (re-centring the real mouse without turning).
(() => {
  if (window.__lockShim) return;
  let el = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", { configurable: true, get() { return el; } });
  const fire = () => setTimeout(() => document.dispatchEvent(new Event("pointerlockchange")));
  Element.prototype.requestPointerLock = function () { el = this; fire(); return Promise.resolve(); };
  Document.prototype.exitPointerLock = function () { if (!el) return; el = null; fire(); };
  let last = null;
  window.__mouseReset = () => (last = null);
  window.__moves = 0;
  const fix = (e) => {
    const mx = last ? e.clientX - last[0] : 0, my = last ? e.clientY - last[1] : 0;
    last = [e.clientX, e.clientY];
    window.__moves++;
    Object.defineProperty(e, "movementX", { configurable: true, value: mx });
    Object.defineProperty(e, "movementY", { configurable: true, value: my });
  };
  window.addEventListener("pointermove", fix, true);
  window.__lockShim = true;
})();
