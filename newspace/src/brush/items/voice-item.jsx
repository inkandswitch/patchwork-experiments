// A voice note — records on the creating client, then plays back. The card chrome
// is gone: it's just a small play/stop button + status, and the transcript BELOW it
// rendered like ordinary text-tool text (same font/size/colour params), editable in
// place. The transcript element is ALWAYS present (not swapped on stop) so its text
// can never be dropped by a mount race.
import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { claimVoice, startVoiceStream, saveAudioFile } from "../../voice.js";
import { fontFamily, colorVar } from "../constants.js";

export function VoiceItem(props) {
  const it = props.it, ctx = props.ctx, surface = props.surface;
  const setItem = (fn) => surface.handle.change((d) => { const o = d.items.find((x) => x.id === it().id); if (o) fn(o); });
  const [interim, setInterim] = createSignal(""); // live (un-committed) words
  const [status, setStatus] = createSignal("");
  const [live, setLive] = createSignal(false); // true once OUR mic stream is open
  const [playing, setPlaying] = createSignal(false);
  const [progress, setProgress] = createSignal(0); // 0..1 playback position
  let session = null, recStart = 0, audioEl;
  let cancelled = false; // set on cleanup — an in-flight startVoiceStream must stop, not leak the mic
  let textEl; // the editable transcript element
  const fmtDur = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  // mirror the doc text into the editable element when it changes from OUTSIDE
  // (a final phrase landing, or a peer edit) — never while you're typing in it.
  // textEl is always mounted, so there's no swap race that could blank it.
  createEffect(() => {
    const t = it().text || "";
    if (textEl && document.activeElement !== textEl && textEl.innerText !== t) textEl.innerText = t;
  });

  onMount(async () => {
    if (!it().recording || !claimVoice(it().id)) return;
    try {
      const s = await startVoiceStream({
        onStatus: (m) => setStatus(m || ""),
        onReady: () => setStatus(""),
        onInterim: (t) => setInterim(t),
        onFinal: (t) => { setInterim(""); if (t) setItem((o) => { o.text = ((o.text || "") + " " + t).trim(); }); },
      });
      if (cancelled) { s.stop(); return; } // unmounted while the mic prompt/model load was pending
      session = s;
      recStart = Date.now();
      setLive(true);
    } catch (e) {
      console.warn("[voice] mic unavailable", e);
      if (!cancelled) ctx.removeItem(it().id);
    }
  });
  onCleanup(() => { cancelled = true; if (session) session.stop(); if (audioEl) audioEl.pause(); });

  // no stopPropagation on click — Solid delegates clicks to document (banned in this
  // repo); the buttons' pointerdown handlers already keep the canvas gesture out.
  async function stop() {
    const s = session; session = null; setLive(false);
    const dur = recStart ? (Date.now() - recStart) / 1000 : 0;
    const blob = s ? await s.stop() : null;
    setInterim("");
    const text = (it().text || "").trim();
    if (blob) {
      const url = await saveAudioFile(window.repo, blob, text); // file carries the transcript
      setItem((o) => { o.url = url; o.duration = dur; o.recording = false; });
    } else setItem((o) => { o.recording = false; });
  }
  function togglePlay() {
    if (!audioEl || !it().url) return;
    if (playing()) { audioEl.pause(); setPlaying(false); }
    else audioEl.play().then(() => setPlaying(true)).catch((err) => console.warn("[voice] play", err));
  }

  const textStyle = () => ({
    color: colorVar(it().color || "line"),
    "font-family": fontFamily(it().font || "hand"),
    "font-size": `${it().fontSize || 20}px`,
  });

  return (
    <div class="ns-mark ns-voice" style={props.baseStyle()}>
      {/* header: play/stop + status — the grab handle */}
      <div class="ns-voice-head" onPointerDown={props.down}>
        <Show when={it().recording} fallback={
          <button class="ns-voice-btn" title={playing() ? "pause" : "play"} onPointerDown={(e) => e.stopPropagation()} onClick={togglePlay}>{playing() ? "❚❚" : "▶"}</button>
        }>
          <button class="ns-voice-btn stop" title="stop" onPointerDown={(e) => e.stopPropagation()} onClick={stop}>■</button>
        </Show>
        <span class="ns-voice-status">
          <Show when={it().recording} fallback={<Show when={it().url}>{fmtDur(it().duration)}</Show>}>
            {live() ? (status() || "listening…") : "starting…"}
          </Show>
        </span>
        <Show when={playing() || progress() > 0}>
          <span class="ns-voice-bar"><span class="ns-voice-bar-fill" style={{ width: `${progress() * 100}%` }} /></span>
        </Show>
      </div>

      {/* transcript: looks like plain text-tool text, editable in place */}
      <div class="ns-voice-transcript" contenteditable="plaintext-only" ref={textEl} style={textStyle()}
        onPointerDown={(e) => e.stopPropagation()}
        onInput={() => setItem((o) => { o.text = textEl.innerText; })} />
      <Show when={interim()}><span class="ns-voice-interim" style={textStyle()}>{interim()}</span></Show>

      <audio ref={audioEl} preload="metadata" src={!it().recording && it().url ? ctx.serviceUrl(it().url) : undefined}
        onTimeUpdate={() => { if (audioEl && it().duration) setProgress(Math.min(1, audioEl.currentTime / it().duration)); }}
        onEnded={() => { setPlaying(false); setProgress(0); }} />
    </div>
  );
}
