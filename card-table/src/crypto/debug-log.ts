type LogPayload = Record<string, unknown>;

let announced = false;

function enabled(): boolean {
  try {
    return localStorage.getItem("card-table:crypto-debug") !== "0";
  } catch {
    return true;
  }
}

function write(
  level: "debug" | "info" | "warn" | "error",
  scope: string,
  event: string,
  payload?: LogPayload,
) {
  if (!enabled()) return;
  if (!announced) {
    announced = true;
    console.info(
      "[card-table/crypto] logging enabled — set localStorage card-table:crypto-debug=0 to silence",
    );
  }
  const prefix = `[card-table/crypto:${scope}]`;
  const message = `${prefix} ${event}`;
  if (payload === undefined) {
    console[level](message);
    return;
  }
  console[level](message, payload);
}

export function cryptoLog(scope: string) {
  return {
    debug: (event: string, payload?: LogPayload) =>
      write("debug", scope, event, payload),
    info: (event: string, payload?: LogPayload) =>
      write("info", scope, event, payload),
    warn: (event: string, payload?: LogPayload) =>
      write("warn", scope, event, payload),
    error: (event: string, payload?: LogPayload) =>
      write("error", scope, event, payload),
  };
}
