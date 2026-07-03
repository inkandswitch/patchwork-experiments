// The one logger, one tag (README Phase 2). warn/error always
// ship; debug is diagnostics — visible in dev builds, silent in prod.
const VERBOSE = import.meta.env?.DEV ?? false;
export const log = {
  warn: (msg, ...a) => console.warn("[sketchy]", msg, ...a),
  error: (msg, ...a) => console.error("[sketchy]", msg, ...a),
  debug: (msg, ...a) => { if (VERBOSE) console.log("[sketchy]", msg, ...a); },
};
