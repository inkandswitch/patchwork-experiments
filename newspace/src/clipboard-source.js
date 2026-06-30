// Clipboard SOURCE — reads navigator.clipboard.readText() on start, and re-reads
// shortly after the document's "copy"/"cut" events (the event fires before the
// system clipboard is updated, so we read on the next tick). Pushes the text
// string. Gated: the browser only resolves readText() on a user gesture, so the
// node shows an Enable button. See src/sources.js for the factory shape.
import { Source } from "./opstreams.js";
import { stringSchema } from "./ops.js";
import { makeSourceMount } from "./source-nodes.js";

// pure: coerce a clipboard reading into a plain string (testable without a device)
export function cleanText(s) {
  return String(s ?? "");
}

// the clipboard, re-read on copy/cut (prompts for permission). Guards when the
// Async Clipboard API is absent — pushes { error } and returns a no-op stop.
export function clipboardSource() {
  const stream = new Source("");
  const clip = typeof navigator !== "undefined" && navigator.clipboard;
  if (!clip || !clip.readText) {
    stream.push({ error: "clipboard unavailable" });
    return { stream, stop() {} };
  }

  let cancelled = false;
  const read = () => {
    clip.readText()
      .then((t) => { if (!cancelled) stream.push(cleanText(t)); })
      .catch((e) => { if (!cancelled) stream.push({ error: e && e.message }); });
  };

  // the clipboard isn't updated until AFTER the copy/cut event handler returns,
  // so defer the read a tick.
  const onClip = () => setTimeout(read, 0);

  const doc = typeof document !== "undefined" ? document : null;
  if (doc) {
    doc.addEventListener("copy", onClip);
    doc.addEventListener("cut", onClip);
  }
  read(); // initial reading on start

  return {
    stream,
    stop() {
      cancelled = true;
      if (doc) {
        doc.removeEventListener("copy", onClip);
        doc.removeEventListener("cut", onClip);
      }
    },
  };
}

export const plugin = {
  type: "sketchy:window",
  id: "clipboard",
  name: "Clipboard",
  icon: "Clipboard",
  inlets: [],
  outlets: [{ name: "text", type: "json", schema: stringSchema() }],
  async load() {
    return makeSourceMount({ start: clipboardSource, outlet: "text", label: "clipboard", gated: true });
  },
};
