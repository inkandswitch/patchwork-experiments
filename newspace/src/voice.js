// A voice-note brush — click the canvas and speak; the words STREAM live into a
// text-tool-style card (hand font) as you talk, and the audio is saved as a real
// Patchwork file doc with its `.transcript`. Click ■ to stop.
//
// Registered as a `newspace:brush` plugin. The brush places a `voice` item and
// "claims" it for THIS client; the host's VoiceItem renderer (only on the
// claiming client) opens the live transcription stream + an audio recorder, and
// shows the stop button. Streaming is @chee/patchwork-transcript's
// createTranscriptionStream (Silero VAD + a local ASR model in a worker), loaded
// as a shared service-worker bundle via the @chee/patchwork-bundles vite plugin.

import { createTranscriptionStream } from "@chee/patchwork-transcript";

// ---- self-contained styling (injected once) --------------------------------
const CSS = `
.ns-voice { pointer-events: none; }
/* a play/stop button + status, with the transcript below rendered like plain
   text-tool text (no card chrome). */
.ns-voice-head { position: absolute; left: 0; top: -30px; display: flex; align-items: center; gap: 7px; pointer-events: auto; cursor: move; }
.ns-voice-btn { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
  border: 1.5px solid var(--ns-ink); background: var(--ns-sky); color: #fff; font-size: 12px; cursor: pointer;
  box-shadow: inset 1px 1px 0 var(--ns-hi), 1px 1px 0 var(--ns-shadow); user-select: none; }
.ns-voice-btn:active { transform: translate(1px, 1px); box-shadow: inset 1px 1px 0 var(--ns-hi); }
.ns-voice-btn.stop { background: var(--ns-pink); animation: ns-voice-pulse 1s ease-in-out infinite; }
@keyframes ns-voice-pulse { 50% { opacity: 0.5; } }
.ns-voice-status { font-size: 11px; font-weight: 700; color: var(--ns-chrome-lo); font-family: var(--ns-font, system-ui); font-variant-numeric: tabular-nums; }
/* the playback progress bar grows into existence when you hit play */
.ns-voice-bar { flex: 0 0 auto; width: 60px; height: 5px; border-radius: 999px; background: var(--ns-chrome-lo); overflow: hidden;
  transform-origin: left center; animation: ns-voice-bar-in 0.28s cubic-bezier(.2,.9,.3,1.25); }
@keyframes ns-voice-bar-in { from { transform: scaleX(0); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
.ns-voice-bar-fill { display: block; height: 100%; background: var(--ns-pink); border-radius: 999px; transition: width 0.1s linear; }
/* transcript — indistinguishable from text-tool text; editable in place */
.ns-voice-transcript { position: absolute; inset: 0; pointer-events: auto; cursor: text; outline: none;
  line-height: 1.3; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
.ns-voice-transcript:empty::after { content: "speak…"; color: var(--ns-chrome-lo); }
.ns-voice-interim { position: absolute; inset: 0; pointer-events: none; opacity: 0.5; line-height: 1.3; white-space: pre-wrap; }
`;
function injectCSS() {
  if (typeof document === "undefined" || document.getElementById("newspace-voice-brush")) return;
  const el = document.createElement("style");
  el.id = "newspace-voice-brush";
  el.textContent = CSS;
  document.head.appendChild(el);
}
injectCSS();

// the item this client just created and should open a mic stream for (claimed
// once by the host's VoiceItem, so peers viewing the same item don't record)
let pending = null;
export function claimVoice(itemId) {
  if (pending !== itemId) return false;
  pending = null;
  return true;
}

// Open a live transcription stream + an audio recorder off one mic. The stream
// drives onInterim/onFinal as you speak; the recorder captures the audio so we
// can save it as a file on stop. Returns { stop } → Promise<Blob|null>.
export async function startVoiceStream(handlers) {
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(mediaStream);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  // the live stream consumes a CLONED track so it doesn't fight the recorder
  const track = mediaStream.getAudioTracks()[0].clone();
  const session = await createTranscriptionStream({
    track,
    onStatus: handlers.onStatus,
    onReady: handlers.onReady,
    onInterim: handlers.onInterim,
    onFinal: handlers.onFinal,
    onError: (e) => console.warn("[voice] stream error", e),
  });
  return {
    stop: () => new Promise((resolve) => {
      try { session.close(); } catch {}
      try { track.stop(); } catch {}
      recorder.onstop = () => {
        mediaStream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
      };
      try { recorder.stop(); } catch { resolve(null); }
    }),
  };
}

// store the recording as a real file doc (same shape as a pasted image), with a
// `.transcript` field for its text
export async function saveAudioFile(repo, blob, transcript = "") {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const ext = ((blob.type || "audio/webm").split("/")[1] || "webm").split(";")[0];
  const file = await repo.create2({
    "@patchwork": { type: "file" },
    content: buf, extension: ext, mimeType: blob.type || "audio/webm",
    name: `Voice note.${ext}`, transcript,
  });
  return file.url;
}

export const VoiceBrush = {
  id: "voice",
  name: "Voice note",
  icon: "Mic",
  iconPath: "M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z M7 11a5 5 0 0010 0 M12 16v4 M9 20h6",
  behavior: {
    // a click drops a recording card and claims it for this client to capture
    up(ctx) {
      const id = ctx.uid();
      const x = ctx.start.x, y = ctx.start.y;
      pending = id;
      ctx.change((items) => items.push({ id, kind: "voice", x: x - 140, y: y - 75, w: 280, h: 150, text: "", url: null, recording: true, rotation: 0 }));
    },
  },
};

export const voicePlugin = {
  type: "newspace:brush",
  id: "voice",
  name: "Voice note",
  icon: "Mic",
  async load() {
    return VoiceBrush;
  },
};
