// For tests of which docs a view writes (I1, COMPOSITION.md): a handle wrapped to log its writes and sends.

/** Record every write and send a handle takes. */
export function spy(handle) {
  const log = [];
  const change = handle.change.bind(handle);
  const broadcast = handle.broadcast.bind(handle);
  handle.change = (fn, opts) => {
    log.push("change");
    return change(fn, opts);
  };
  handle.broadcast = (m) => {
    log.push(`broadcast:${m?.type ?? "?"}`);
    return broadcast(m);
  };
  return log;
}

