type PresenceRecord = Record<string, unknown> | null;

const PRESENCE_FPS = 30;
const PRESENCE_INTERVAL_MS = 1000 / PRESENCE_FPS;

export function createPresenceBroadcaster() {
  let lastSentKey: string | null = null;
  let pending: PresenceRecord = null;
  let pendingUpdate: ((p: PresenceRecord) => void) | null = null;
  let lastSendTime = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushTimer = null;
    if (!pending || !pendingUpdate) return;

    const key = JSON.stringify(pending);
    if (key === lastSentKey) {
      pending = null;
      return;
    }

    lastSentKey = key;
    lastSendTime = performance.now();
    const next = pending;
    pending = null;
    pendingUpdate(next);
  };

  return {
    reset() {
      lastSentKey = null;
      pending = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
    dispose() {
      this.reset();
      pendingUpdate = null;
    },
    maybeBroadcast(presence: PresenceRecord, update: (p: PresenceRecord) => void) {
      pendingUpdate = update;

      const key = JSON.stringify(presence);
      if (key === lastSentKey) return;

      pending = presence;

      const elapsed = performance.now() - lastSendTime;
      if (elapsed >= PRESENCE_INTERVAL_MS) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();
        return;
      }

      if (!flushTimer) {
        flushTimer = setTimeout(flush, PRESENCE_INTERVAL_MS - elapsed);
      }
    },
  };
}
