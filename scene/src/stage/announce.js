// Telling the host which docs a view shows (Patchwork's `patchwork:mounted`).
//
// A `<patchwork-view doc-url>` announces its doc as it mounts and retracts it
// as it goes, and that's how the providers around a view learn what it shows:
// the draft-state provider makes those docs a draft's members — cloned into a
// draft, and pinned together at a history checkpoint — and the comments
// provider follows their threads. A scene shows many docs through one view —
// linked stages, its objects' sources and renders, what their builds read —
// and opens them itself, so it announces each one it shows *live* in the same
// way. One it shows at fixed heads (a pin) isn't announced: it keeps its own
// version whatever the draft or checkpoint, as a pin should.
//
// Announcements are counted per url, so a doc several parts show is announced
// once, on its first hold, and retracted once, on its last release.

/** What a scene says it is, in the announcements (`detail.toolId`). */
export const TOOL_ID = "scene";

/**
 * @param {EventTarget} target  where the events start (they bubble out of the view)
 * @returns {{ hold(url: string): void, release(url: string): void, held(): string[], dispose(): void }}
 */
export function createAnnouncer(target) {
  const counts = new Map(); // url → holds
  let disposed = false;
  const send = (type, url) =>
    target?.dispatchEvent?.(new CustomEvent(type, { detail: { url, toolId: TOOL_ID }, bubbles: true, composed: true }));
  return {
    /** One more part shows `url` live; the first announces it. */
    hold(url) {
      if (disposed || typeof url !== "string" || !url) return;
      const n = counts.get(url) ?? 0;
      counts.set(url, n + 1);
      if (n === 0) send("patchwork:mounted", url);
    },
    /** One fewer does; the last retracts it. (One never held is ignored.) */
    release(url) {
      const n = counts.get(url);
      if (!n) return;
      if (n > 1) return void counts.set(url, n - 1);
      counts.delete(url);
      if (!disposed) send("patchwork:unmounted", url);
    },
    /** The urls announced now, sorted. */
    held: () => [...counts.keys()].sort(),
    /** Retract everything still announced; nothing is announced after. */
    dispose() {
      if (disposed) return;
      for (const url of counts.keys()) send("patchwork:unmounted", url);
      counts.clear();
      disposed = true;
    },
  };
}
