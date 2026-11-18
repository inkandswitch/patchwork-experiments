// What a native service hands a caller is given back when the caller's signal aborts (STAGE.md, "Services").

/** Tie `give` to `signal`: it runs once, as the signal aborts or as the returned off is called, whichever is first. */
export function tie(signal, give) {
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    signal.removeEventListener("abort", off);
    give();
  };
  if (signal.aborted) off();
  else signal.addEventListener("abort", off);
  return off;
}
