/**
 * Chat Tool - Enhanced Patchwork Chat
 *
 * Features:
 * - Emoji reactions (any emoji via picker)
 * - Presence & typing indicators
 * - Image paste, voice notes, replies
 * - User fonts, colors, avatars from contact doc
 * - Cat ears on avatar click
 * - GIF selfie mode (inline camera toggle left of input)
 * - IRC/Discord-style layout
 * - Themeable via single oklch base color + CSS variables
 */

// ============================================================================
// Datatype
// ============================================================================

export const ChatDatatype = {
  init(doc) {
    doc.title = "Chat";
    doc.messages = [];
    doc.docs = [];
  },
  getTitle(doc) { return doc.title || "Chat"; },
  setTitle(doc, title) { doc.title = title; },
  markCopy(doc) { doc.title = "Copy of " + this.getTitle(doc); },
};

// ============================================================================
// Helpers
// ============================================================================

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  return m + ":" + Math.floor(s % 60).toString().padStart(2, "0");
}

// ============================================================================
// Styles with CSS custom properties derived from a single theme color
// ============================================================================

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    /* ================================================================
       THEME SYSTEM
       Everything derives from --theme, a single oklch color.
       --theme-fg uses contrast-color (with fallback).
       ================================================================ */
    .chat-root {
      /* All theme variables are set dynamically by setTheme() in JS.
         These are just fallback defaults. */
      --theme: oklch(0.55 0.18 270);
      --bg-darkest:  oklch(0.12 0.02 270);
      --bg-dark:     oklch(0.15 0.03 270);
      --bg-mid:      oklch(0.19 0.03 270);
      --bg-hover:    oklch(0.22 0.04 270);
      --bg-input:    oklch(0.17 0.03 270);
      --border:      oklch(0.28 0.05 270);
      --accent:      oklch(0.55 0.18 270);
      --accent-hover: oklch(0.45 0.15 270);
      --accent-soft: oklch(0.55 0.18 270 / 0.15);
      --accent-fg:   oklch(1 0 0);
      --text-primary:   oklch(0.93 0.01 0);
      --text-secondary: oklch(0.68 0.01 0);
      --text-muted:     oklch(0.55 0.01 0);
    }

    /* ---- Reset ---- */
    .chat-root {
      display:flex; flex-direction:column;
      position:absolute; inset:0;
      font-family:system-ui,-apple-system,sans-serif;
      background:var(--bg-dark); color:var(--text-primary);
      box-sizing:border-box; font-size:15px;
      overflow:hidden;
    }
    .chat-root *, .chat-root *::before, .chat-root *::after { box-sizing:border-box; }

    /* Theme button */
    .chat-theme-btn {
      background:none; border:none; color:var(--text-secondary); cursor:pointer;
      font-size:16px; padding:2px 6px; border-radius:4px; position:relative; margin-left:auto;
    }
    .chat-theme-btn:hover { background:var(--bg-hover); color:var(--text-primary); }

    /* Theme picker popover */
    .chat-theme-popover {
      display:none; position:absolute; top:100%; right:0; margin-top:4px;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:8px;
      padding:12px; z-index:50; min-width:200px;
      box-shadow:0 4px 20px rgba(0,0,0,0.4);
    }
    .chat-theme-popover.show { display:block; }
    .chat-theme-popover label { font-size:13px; color:var(--text-secondary); display:block; margin-bottom:6px; }
    .chat-theme-presets { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .chat-theme-preset {
      width:28px; height:28px; border-radius:50%; border:2px solid transparent; cursor:pointer;
      transition: border-color 0.15s;
    }
    .chat-theme-preset:hover, .chat-theme-preset.active { border-color:var(--text-primary); }
    .chat-theme-hue-row { display:flex; align-items:center; gap:8px; }
    .chat-theme-hue-row input[type=range] { flex:1; accent-color:var(--accent); }
    .chat-theme-hue-row input[type=number] { width:50px; background:var(--bg-input); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; padding:2px 4px; font-size:13px; }

    /* ---- Presence bar ---- */
    .chat-presence-bar {
      padding:4px 16px; background:var(--bg-darkest);
      border-bottom:1px solid var(--border);
      display:flex; gap:8px; align-items:center; flex-shrink:0; min-height:24px;
    }
    .chat-presence-user { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text-secondary); transition:opacity 0.2s; }
    .chat-presence-user.away { opacity:0.9; }
    .chat-presence-avatar {
      width:18px; height:18px; border-radius:50%; overflow:hidden; flex-shrink:0;
      background:var(--bg-hover); display:flex; align-items:center; justify-content:center;
      font-size:10px; color:var(--text-muted);
    }
    .chat-presence-avatar img { width:100%; height:100%; object-fit:cover; }

    /* ---- Messages ---- */
    .chat-messages { flex:1; overflow-y:auto; padding:8px 0; display:flex; flex-direction:column; min-height:0; }

    .chat-msg-group { padding:2px 16px; display:flex; gap:12px; position:relative; }
    .chat-msg-group:hover { background:var(--bg-hover); }

    /* Avatar */
    .chat-avatar-col { width:40px; flex-shrink:0; padding-top:2px; }
    .chat-avatar {
      width:40px; height:40px; border-radius:50%; background:var(--accent);
      display:flex; align-items:center; justify-content:center;
      font-size:18px; font-weight:700; color:var(--accent-fg);
      overflow:hidden; cursor:pointer; position:relative; user-select:none;
    }
    .chat-avatar img { width:100%; height:100%; object-fit:cover; }
    .chat-avatar.gif-selfie { border-radius:4px; }
    .chat-avatar.gif-selfie img { border-radius:4px; }
    .chat-avatar.cat-ears::before {
      content:""; position:absolute; top:-6px; left:2px;
      border-left:8px solid transparent; border-right:8px solid transparent;
      border-bottom:12px solid var(--accent); z-index:2;
    }
    .chat-avatar.cat-ears::after {
      content:""; position:absolute; top:-6px; right:2px;
      border-left:8px solid transparent; border-right:8px solid transparent;
      border-bottom:12px solid var(--accent); z-index:2;
    }

    /* Message body */
    .chat-msg-body { flex:1; min-width:0; }
    .chat-msg-header { display:flex; align-items:baseline; gap:8px; }
    .chat-msg-name { font-weight:600; font-size:15px; color:var(--text-primary); cursor:pointer; }
    .chat-msg-name:hover { text-decoration:underline; }
    .chat-msg-time { font-size:11px; color:var(--text-muted); }
    .chat-msg-text { color:var(--text-primary); line-height:1.45; margin-top:2px; white-space:pre-wrap; word-wrap:break-word; }

    /* Continuation messages */
    .chat-msg-continuation { padding:0 16px 0 68px; position:relative; }
    .chat-msg-continuation.has-gif { padding-left:16px; display:flex; gap:12px; align-items:flex-start; }
    .chat-msg-continuation:hover { background:var(--bg-hover); }
    .chat-msg-inline-time {
      font-size:10px; color:var(--text-muted);
      position:absolute; top:100%; right:0; white-space:nowrap;
      margin-top:2px; pointer-events:none;
    }

    /* GIF selfie shown inline in continuation */
    .chat-msg-gif-inline {
      width:40px; height:40px; border-radius:4px; object-fit:cover;
      border:none; display:block; margin-right:6px; flex-shrink:0;
    }

    /* Reply ref */
    .chat-msg-reply-ref {
      display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted);
      margin-bottom:2px; padding-left:36px; cursor:pointer; position:relative;
    }
    .chat-msg-reply-ref::before {
      content:""; position:absolute; left:20px; top:50%; width:12px; height:12px;
      border-left:2px solid var(--border); border-top:2px solid var(--border);
      border-radius:6px 0 0 0; transform:translateY(-20%);
    }
    .chat-msg-reply-ref:hover { color:var(--text-primary); }
    .chat-msg-reply-ref-avatar { width:16px; height:16px; border-radius:50%; overflow:hidden; flex-shrink:0; }
    .chat-msg-reply-ref-avatar img { width:100%; height:100%; object-fit:cover; }
    .chat-msg-reply-ref-name { font-weight:600; color:var(--text-primary); }
    .chat-msg-reply-ref-text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }

    /* Images */
    .chat-msg-image-wrap {
      position:relative; display:inline-block; margin-top:4px; max-width:100%;
    }
    .chat-msg-image {
      display:block; border-radius:8px; cursor:pointer; width:100%; height:100%; object-fit:cover;
    }

    /* Patchwork doc embed */
    .chat-msg-embed {
      margin-top:6px; border:1px solid var(--border); border-radius:8px;
      overflow:hidden; width:100%; height:300px; position:relative;
      background:var(--bg-surface);
    }
    .chat-msg-embed patchwork-view { width:100%; height:100%; display:block; }
    .chat-msg-embed-title {
      position:absolute; bottom:0; left:0; right:0; padding:4px 8px;
      font-size:11px; color:var(--text-secondary); background:var(--bg-darkest);
      border-top:1px solid var(--border); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }

    /* Resize handle */
    .chat-resize-handle {
      position:absolute; bottom:0; right:0; width:16px; height:16px; cursor:nwse-resize;
      display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.15s;
      z-index:5;
    }
    .chat-msg-image-wrap:hover .chat-resize-handle,
    .chat-msg-embed:hover .chat-resize-handle { opacity:0.6; }
    .chat-resize-handle:hover { opacity:1 !important; }
    .chat-resize-handle svg { width:10px; height:10px; color:var(--text-muted); }

    /* Voice note */
    .chat-voice-note {
      display:flex; align-items:center; gap:8px; margin-top:4px; padding:8px 12px;
      background:var(--bg-darkest); border-radius:8px; max-width:300px;
    }
    .chat-voice-play-btn {
      width:32px; height:32px; border-radius:50%; background:var(--accent); color:var(--accent-fg);
      border:none; font-size:14px; cursor:pointer; display:flex; align-items:center;
      justify-content:center; flex-shrink:0;
    }
    .chat-voice-play-btn:hover { background:var(--accent-hover); }
    .chat-voice-waveform { flex:1; height:24px; display:flex; align-items:center; gap:2px; }
    .chat-voice-bar { width:3px; background:var(--accent); border-radius:2px; min-height:3px; }
    .chat-voice-duration { font-size:12px; color:var(--text-muted); flex-shrink:0; }

    /* Reactions */
    .chat-reactions { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
    .chat-reaction {
      display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:8px;
      border:1px solid var(--border); background:var(--bg-dark); font-size:15px;
      cursor:pointer; user-select:none; transition:all 0.1s;
    }
    .chat-reaction:hover { border-color:var(--accent); background:var(--bg-hover); }
    .chat-reaction.mine { border-color:var(--accent); background:var(--accent-soft); }
    .chat-reaction-count { font-size:12px; color:var(--text-secondary); font-weight:500; }
    .chat-reaction-add {
      display:inline-flex; align-items:center; justify-content:center;
      width:28px; height:28px; border-radius:8px; border:1px dashed var(--border);
      background:transparent; font-size:16px; cursor:pointer; color:var(--text-muted); transition:all 0.1s;
    }
    .chat-reaction-add:hover { border-color:var(--accent); color:var(--text-primary); background:var(--bg-hover); }

    /* Message hover actions */
    .chat-msg-actions {
      position:absolute; top:-14px; right:16px; display:none;
      background:var(--bg-darkest); border:1px solid var(--border);
      border-radius:4px; z-index:10;
    }
    .chat-msg-group:hover .chat-msg-actions,
    .chat-msg-continuation:hover .chat-msg-actions { display:flex; }
    .chat-msg-action-btn {
      background:none; border:none; color:var(--text-secondary);
      padding:6px 8px; cursor:pointer; font-size:16px;
    }
    .chat-msg-action-btn:hover { background:var(--bg-hover); color:var(--text-primary); }

    /* Emoji picker overlay */
    .chat-emoji-picker-overlay {
      position:fixed; top:0; left:0; right:0; bottom:0; z-index:100; display:none;
    }
    .chat-emoji-picker-overlay.show { display:block; }
    .chat-emoji-picker {
      position:absolute; background:var(--bg-darkest); border:1px solid var(--border);
      border-radius:8px; padding:8px; box-shadow:0 4px 20px rgba(0,0,0,0.3);
      z-index:101; max-width:280px; width:280px; display:flex; flex-direction:column;
      max-height:320px;
    }
    .chat-emoji-grid {
      display:flex; flex-wrap:wrap; gap:2px; max-height:200px; overflow-y:auto; min-height:0;
      overscroll-behavior:contain;
    }
    .chat-emoji-grid button {
      background:none; border:none; font-size:22px; cursor:pointer; padding:4px;
      border-radius:4px; width:36px; height:36px; display:flex; align-items:center; justify-content:center;
    }
    .chat-emoji-grid button:hover { background:var(--bg-hover); }
    .chat-emoji-picker-search {
      width:100%; padding:6px 10px; background:var(--bg-input); border:1px solid var(--border);
      border-radius:4px; color:var(--text-primary); font-size:14px; margin-bottom:6px; outline:none;
      flex-shrink:0;
    }
    .chat-emoji-picker-search:focus { border-color:var(--accent); }

    /* Message context menu (... button) */
    .chat-msg-menu-wrap { position:relative; }
    .chat-msg-menu {
      display:none; position:absolute; top:100%; right:0; margin-top:2px;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:6px;
      padding:4px 0; min-width:120px; z-index:20;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
    }
    .chat-msg-menu.show { display:block; }
    .chat-msg-menu-item {
      display:flex; align-items:center; gap:8px; width:100%; padding:6px 12px;
      background:none; border:none; color:var(--text-primary); font-size:13px;
      cursor:pointer; text-align:left;
    }
    .chat-msg-menu-item:hover { background:var(--bg-hover); }
    .chat-msg-menu-item.danger { color:#ed4245; }
    .chat-msg-menu-item.danger:hover { background:rgba(237,66,69,0.1); }

    /* ---- Bottom area ---- */
    .chat-typing-bar {
      padding:0 16px; min-height:22px; font-size:12px;
      color:var(--text-muted); font-style:italic; flex-shrink:0;
    }
    .chat-input-wrapper { flex-shrink:0; padding:0 16px 16px; }

    .chat-reply-bar {
      display:none; padding:8px 12px; background:var(--bg-mid);
      border-radius:8px 8px 0 0; border-left:3px solid var(--accent);
      align-items:center; gap:8px; font-size:13px; color:var(--text-secondary);
    }
    .chat-reply-bar.show { display:flex; }
    .chat-reply-bar-text { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .chat-reply-bar-close { background:none; border:none; font-size:16px; cursor:pointer; color:var(--text-secondary); }
    .chat-reply-bar-close:hover { color:var(--text-primary); }

    .chat-paste-preview {
      display:none; padding:8px 12px; background:var(--bg-mid); align-items:center; gap:8px;
    }
    .chat-paste-preview.show { display:flex; }
    .chat-paste-preview img { max-height:50px; border-radius:4px; }
    .chat-paste-preview-close { background:none; border:none; font-size:16px; cursor:pointer; color:var(--text-secondary); margin-left:auto; }

    .chat-input-row {
      display:flex; gap:0; background:var(--bg-input); border-radius:8px;
      padding:4px; align-items:flex-end;
    }
    .chat-input {
      flex:1; padding:8px 12px; border:none; font-size:15px; outline:none;
      background:transparent; color:var(--text-primary);
      font-family:inherit; resize:none; max-height:120px; min-height:24px; line-height:1.4;
    }
    .chat-input::placeholder { color:var(--text-muted); }

    .chat-input-btn {
      width:36px; height:36px; background:none; border:none; color:var(--text-secondary);
      cursor:pointer; font-size:20px; border-radius:4px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
    }
    .chat-input-btn:hover { color:var(--text-primary); }
    .chat-input-btn.recording { color:#ed4245; animation:pulse 1s infinite; }
    @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }

    /* Voice recording bar (replaces input row while recording) */
    .chat-recording-bar {
      display:flex; align-items:center; gap:10px; background:var(--bg-input); border-radius:8px;
      padding:8px 12px; animation:fadeIn 0.15s ease;
    }
    @keyframes fadeIn { from{opacity:0;transform:scale(0.98)} to{opacity:1;transform:scale(1)} }
    .chat-recording-dot {
      width:10px; height:10px; border-radius:50%; background:#ed4245; flex-shrink:0;
      animation:recPulse 1s ease-in-out infinite;
    }
    @keyframes recPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
    .chat-recording-time { font-size:14px; color:var(--text-primary); font-variant-numeric:tabular-nums; min-width:40px; }
    .chat-recording-viz {
      flex:1; height:24px; display:flex; align-items:center; gap:2px; overflow:hidden;
    }
    .chat-recording-viz-bar {
      width:3px; border-radius:2px; background:var(--accent); min-height:3px;
      transition:height 0.1s ease;
    }
    .chat-recording-cancel {
      background:none; border:none; color:var(--text-muted); cursor:pointer;
      font-size:13px; padding:4px 10px; border-radius:4px;
    }
    .chat-recording-cancel:hover { color:var(--text-primary); background:var(--bg-hover); }
    .chat-recording-send {
      background:var(--accent); color:var(--accent-fg); border:none; cursor:pointer;
      padding:6px 14px; border-radius:6px; font-size:13px; font-weight:600;
    }
    .chat-recording-send:hover { background:var(--accent-hover); }

    /* GIF camera toggle (left of input) */
    .chat-gif-toggle {
      width:36px; height:36px; border:none; cursor:pointer; border-radius:4px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
      background:none; color:var(--text-secondary); font-size:20px; position:relative;
      overflow:hidden;
    }
    .chat-gif-toggle:hover { color:var(--text-primary); }
    .chat-gif-toggle.active { color:var(--accent); }
    .chat-gif-toggle video {
      position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:4px;
      display:none;
    }
    .chat-gif-toggle.active video { display:block; }
    .chat-gif-toggle.active .chat-gif-icon { display:none; }
    
    /* GIF recording/processing feedback */
    .chat-gif-toggle.recording {
      pointer-events:none; position:relative;
    }
    .chat-gif-toggle.recording::after {
      content:""; position:absolute; top:2px; right:2px; width:12px; height:12px;
      border:2px solid var(--accent); border-top:2px solid transparent; border-radius:50%;
      animation:spin 1s linear infinite; z-index:10;
    }
    @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
    
    .chat-input-row.processing .chat-input,
    .chat-input-row.processing .chat-input-btn { opacity:0.5; pointer-events:none; }

    .chat-empty {
      flex:1; display:flex; align-items:center; justify-content:center;
      color:var(--text-muted); font-size:16px;
    }
  `;
  return style;
}

// ============================================================================
// Emoji data — loaded from unicode-emoji-json via esm.sh
// ============================================================================
let EMOJI_DATA = []; // [{emoji, name, group}]
let EMOJI_LOADED = false;

// Fallback while loading
const FALLBACK_EMOJIS = [
  "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","😉","😊","😇","🥰","😍","🤩",
  "😘","😋","😛","😜","🤪","😝","🤗","🤭","🤫","🤔","😐","😏","🙄","😬","😌",
  "😴","🤮","🥵","🥶","🤯","🤠","🥳","😎","🤓","😢","😭","😱","😤","😡","😈",
  "💀","💩","🤡","👻","👽","🤖","❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔",
  "👍","👎","👊","✊","🤞","✌️","🤟","🤘","👌","👋","💪","🙏",
  "🎉","🎊","🏆","🔥","⭐","✨","⚡","💥","💯","🎵","🎶",
];

const QUICK_EMOJIS = ["👍","❤️","😂","😮","😢","🎉","🔥","👀"];

// Load full emoji catalog async
import("https://esm.sh/unicode-emoji-json@0.6.0").then(mod => {
  const data = mod.default;
  EMOJI_DATA = Object.entries(data).map(([emoji, info]) => ({
    emoji,
    name: info.name || "",
    group: info.group || "",
  }));
  EMOJI_LOADED = true;
}).catch(e => console.warn("[Chat] emoji load failed, using fallback:", e));

// ============================================================================
// GIF Encoder
// ============================================================================
class SimpleGIFEncoder {
  constructor(w, h) { this.width = w; this.height = h; this.frames = []; }

  addFrame(canvas, delay = 100) {
    const ctx = canvas.getContext("2d");
    this.frames.push({ data: ctx.getImageData(0, 0, this.width, this.height).data, delay });
  }

  _quantize(pixels) {
    const m = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
      const k = ((pixels[i]>>3)<<10)|((pixels[i+1]>>3)<<5)|(pixels[i+2]>>3);
      m.set(k, (m.get(k)||0)+1);
    }
    const s = [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,256);
    const p = s.map(([k])=>[(k>>10&0x1f)<<3,(k>>5&0x1f)<<3,(k&0x1f)<<3]);
    while(p.length<256) p.push([0,0,0]);
    return p;
  }

  _closest(p,r,g,b) {
    let best=0,bd=Infinity;
    for(let i=0;i<p.length;i++){const dr=r-p[i][0],dg=g-p[i][1],db=b-p[i][2],d=dr*dr+dg*dg+db*db;if(d<bd){bd=d;best=i;}}
    return best;
  }

  encode() {
    if(!this.frames.length) return null;
    const pal=this._quantize(this.frames[0].data), bytes=[];
    const wb=(b)=>bytes.push(b&0xff), ws=(s)=>{wb(s);wb(s>>8);}, wr=(s)=>{for(let i=0;i<s.length;i++)wb(s.charCodeAt(i));};

    wr("GIF89a"); ws(this.width); ws(this.height); wb(0xf7); wb(0); wb(0);
    for(const[r,g,b] of pal){wb(r);wb(g);wb(b);}
    wb(0x21);wb(0xff);wb(11);wr("NETSCAPE2.0");wb(3);wb(1);ws(0);wb(0);

    for(const frame of this.frames){
      wb(0x21);wb(0xf9);wb(4);wb(0x04);ws(Math.round(frame.delay/10));wb(0);wb(0);
      wb(0x2c);ws(0);ws(0);ws(this.width);ws(this.height);wb(0);
      const mcs=8; wb(mcs);
      const w=this.width,h=this.height,px=frame.data,idx=new Uint8Array(w*h);
      for(let i=0;i<w*h;i++) idx[i]=this._closest(pal,px[i*4],px[i*4+1],px[i*4+2]);
      const lzw=this._lzw(mcs,idx);
      let pos=0;
      while(pos<lzw.length){const c=Math.min(255,lzw.length-pos);wb(c);for(let i=0;i<c;i++)bytes.push(lzw[pos++]);}
      wb(0);
    }
    wb(0x3b);
    return new Uint8Array(bytes);
  }

  _lzw(mcs, pixels) {
    const cc=1<<mcs, eoi=cc+1; let cs=mcs+1, nc=eoi+1;
    const tbl=new Map(), out=[];
    let buf=0, bb=0;
    const emit=(c)=>{buf|=c<<bb;bb+=cs;while(bb>=8){out.push(buf&0xff);buf>>=8;bb-=8;}};
    const reset=()=>{tbl.clear();for(let i=0;i<cc;i++)tbl.set(String(i),i);nc=eoi+1;cs=mcs+1;};
    emit(cc); reset();
    if(!pixels.length){emit(eoi);if(bb>0)out.push(buf&0xff);return out;}
    let cur=String(pixels[0]);
    for(let i=1;i<pixels.length;i++){
      const nx=cur+","+pixels[i];
      if(tbl.has(nx)){cur=nx;}else{
        emit(tbl.get(cur));
        if(nc<4096){tbl.set(nx,nc++);if(nc>(1<<cs)&&cs<12)cs++;}else{emit(cc);reset();}
        cur=String(pixels[i]);
      }
    }
    emit(tbl.get(cur)); emit(eoi); if(bb>0)out.push(buf&0xff); return out;
  }
}

// ============================================================================
// Theme presets
// ============================================================================
const THEME_PRESETS = [
  { name: "Indigo",      color: "oklch(0.55 0.18 270)" },
  { name: "Rose",        color: "oklch(0.55 0.18 350)" },
  { name: "Emerald",     color: "oklch(0.55 0.18 155)" },
  { name: "Cyan",        color: "oklch(0.75 0.30 200)" },
  { name: "Yellow",      color: "oklch(0.90 0.35 95)" },
  { name: "Neon Mint",   color: "oklch(0.85 0.30 160)" },
  { name: "Purple",      color: "oklch(0.50 0.20 300)" },
  { name: "Light Pink",  color: "oklch(0.80 0.12 350)" },
  { name: "Light Blue",  color: "oklch(0.80 0.10 240)" },
  { name: "Lavender",    color: "oklch(0.75 0.14 300)" },
  { name: "Slate",       color: "oklch(0.45 0.02 260)" },
  { name: "White",       color: "oklch(1.00 0 0)" },
  { name: "Black",       color: "oklch(0.15 0 0)" },
];

// ============================================================================
// Tool
// ============================================================================


// SVG Icons
const SVG_ICONS = {
  reply: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
  react: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  micStop: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  camera: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12v12H4z"/><path d="M16 6l4-3v18l-4-3"/><circle cx="10" cy="12" r="2.5"/><text x="6" y="22" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="system-ui">GIF</text></svg>',
  theme: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.1 2.5-.3a1 1 0 0 0 .7-1.1l-.5-3a1 1 0 0 1 1-1.2h2.8a1 1 0 0 0 1-1.1A10 10 0 0 0 12 2z"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
};

export function Tool(handle, element, options) {
  const style = createStyles();
  element.appendChild(style);

  // Ensure the host element is a positioning context for the absolute root
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  const root = document.createElement("div");
  root.className = "chat-root";
  element.appendChild(root);

  // Prevent tldraw (or other parent tools) from eating pointer events on our
  // interactive elements. tldraw calls stopPropagation on pointerdown which
  // prevents click events from ever firing. We stop pointerdown propagation
  // on the root so our clicks work. Per patchwork rules: only stopPropagation
  // on pointerDown/pointerUp, never on click.
  root.addEventListener("pointerdown", (e) => { e.stopPropagation(); });
  root.addEventListener("pointerup", (e) => { e.stopPropagation(); });
  // Prevent parent tools (tldraw etc.) from intercepting scroll/wheel events
  root.addEventListener("wheel", (e) => { e.stopPropagation(); }, { passive: true });
  root.addEventListener("touchstart", (e) => { e.stopPropagation(); }, { passive: true });
  root.addEventListener("touchmove", (e) => { e.stopPropagation(); }, { passive: true });

  let myName = "Anonymous";
  let myFont = null;
  let myAvatarUrl = null;
  let myColor = null;
  let myAvatarBlobUrl = null;
  let replyToId = null;
  let pastedImageData = null;
  let isRecording = false;
  let mediaRecorder = null;
  let recordingChunks = [];
  let recordingStartTime = 0;
  let gifModeEnabled = false;
  let gifStream = null;
  let catEarsSet = new Set();
  const avatarCache = new Map();

  const PRESENCE_TIMEOUT = 30000;
  const TYPING_TIMEOUT = 3000;
  let presenceInterval = null;
  const presenceMap = new Map();

  // Saved theme is applied after setTheme is defined (see below)

  // ---- Resolve account ----
  async function resolveAccountName() {
    try {
      const repo = window.repo; if (!repo) return;
      const adh = window.accountDocHandle; if (!adh) return;
      const ad = adh.doc(); if (!ad?.contactUrl) return;
      const ch = await repo.find(ad.contactUrl);
      const cd = ch.doc(); if (!cd) return;
      if (cd.name) myName = cd.name;
      if (cd.chat?.font) {
        myFont = cd.chat.font;
        input.style.fontFamily = myFont;
      }
      if (cd.avatarUrl) {
        myAvatarUrl = cd.avatarUrl;
        myAvatarBlobUrl = await loadBlobUrl(cd.avatarUrl);
      }
      if (cd.color) myColor = cd.color;
      render();
      broadcastPresence();
    } catch (e) { console.warn("[Chat] resolve account:", e); }
  }
  resolveAccountName();

  // ---- Ephemeral presence ----
  let isFocused = document.hasFocus();
  document.addEventListener("visibilitychange", () => {
    isFocused = !document.hidden;
    broadcastPresence(false);
  });
  window.addEventListener("focus", () => { isFocused = true; broadcastPresence(false); });
  window.addEventListener("blur", () => { isFocused = false; broadcastPresence(false); });

  function broadcastPresence(typing) {
    try {
      handle.broadcast({ type:"presence", name:myName, typing:!!typing, avatarUrl:myAvatarUrl, color:myColor, active:isFocused, timestamp:Date.now() });
    } catch(e) {}
  }

  handle.on("ephemeral-message", (data) => {
    const msg = data.message;
    if (msg?.type === "presence") {
      presenceMap.set(msg.name, { timestamp:msg.timestamp, typing:msg.typing, avatarUrl:msg.avatarUrl, color:msg.color, active:msg.active });
      renderPresence();
      renderTyping();
    }
  });

  presenceInterval = setInterval(() => {
    broadcastPresence(false);
    const now = Date.now();
    for (const [n, info] of presenceMap) { if (now - info.timestamp > PRESENCE_TIMEOUT) presenceMap.delete(n); }
    renderPresence(); renderTyping();
  }, 10000);

  // ============================================================
  // UI Construction
  // ============================================================

  // ---- Theme button ----
  const themeBtn = document.createElement("button");
  themeBtn.className = "chat-theme-btn";
  themeBtn.title = "Theme";
  themeBtn.innerHTML = SVG_ICONS.theme;
  themeBtn.style.position = "relative";

  const themePopover = document.createElement("div");
  themePopover.className = "chat-theme-popover";

  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Theme Color";
  themePopover.appendChild(themeLabel);

  const presetRow = document.createElement("div");
  presetRow.className = "chat-theme-presets";
  for (const preset of THEME_PRESETS) {
    const dot = document.createElement("button");
    dot.className = "chat-theme-preset";
    dot.style.background = preset.color;
    dot.title = preset.name;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = preset.color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
      if (m) {
        themeL = parseFloat(m[1]); themeC = parseFloat(m[2]); themeH = parseFloat(m[3]);
        hueSlider.value = String(themeH); hueNumber.value = String(themeH);
        lumSlider.value = String(Math.round(themeL * 100)); lumNumber.value = String(Math.round(themeL * 100));
        chromaSlider.value = String(Math.round(themeC * 100)); chromaNumber.value = String(Math.round(themeC * 100));
      }
      setTheme(preset.color);
    });
    presetRow.appendChild(dot);
  }
  themePopover.appendChild(presetRow);

  // Theme sliders state
  let themeL = 0.55, themeC = 0.18, themeH = 270;

  // Try to parse saved theme
  try {
    const saved = localStorage.getItem("chat-theme-color");
    if (saved) {
      const m = saved.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
      if (m) { themeL = parseFloat(m[1]); themeC = parseFloat(m[2]); themeH = parseFloat(m[3]); }
    }
  } catch(e) {}

  function updateThemeFromSliders() {
    setTheme("oklch(" + themeL + " " + themeC + " " + themeH + ")");
  }

  // Hue
  const hueLabel = document.createElement("label");
  hueLabel.textContent = "Hue";
  themePopover.appendChild(hueLabel);

  const hueRow = document.createElement("div");
  hueRow.className = "chat-theme-hue-row";
  const hueSlider = document.createElement("input");
  hueSlider.type = "range"; hueSlider.min = "0"; hueSlider.max = "360"; hueSlider.value = String(themeH);
  const hueNumber = document.createElement("input");
  hueNumber.type = "number"; hueNumber.min = "0"; hueNumber.max = "360"; hueNumber.value = String(themeH);

  hueSlider.addEventListener("input", () => {
    themeH = parseFloat(hueSlider.value); hueNumber.value = hueSlider.value;
    updateThemeFromSliders();
  });
  hueNumber.addEventListener("input", () => {
    themeH = parseFloat(hueNumber.value); hueSlider.value = hueNumber.value;
    updateThemeFromSliders();
  });
  hueRow.appendChild(hueSlider);
  hueRow.appendChild(hueNumber);
  themePopover.appendChild(hueRow);

  // Luminosity
  const lumLabel = document.createElement("label");
  lumLabel.textContent = "Luminosity";
  themePopover.appendChild(lumLabel);

  const lumRow = document.createElement("div");
  lumRow.className = "chat-theme-hue-row";
  const lumSlider = document.createElement("input");
  lumSlider.type = "range"; lumSlider.min = "0"; lumSlider.max = "100"; lumSlider.value = String(Math.round(themeL * 100));
  const lumNumber = document.createElement("input");
  lumNumber.type = "number"; lumNumber.min = "0"; lumNumber.max = "100"; lumNumber.value = String(Math.round(themeL * 100));

  lumSlider.addEventListener("input", () => {
    themeL = parseFloat(lumSlider.value) / 100; lumNumber.value = lumSlider.value;
    updateThemeFromSliders();
  });
  lumNumber.addEventListener("input", () => {
    themeL = parseFloat(lumNumber.value) / 100; lumSlider.value = lumNumber.value;
    updateThemeFromSliders();
  });
  lumRow.appendChild(lumSlider);
  lumRow.appendChild(lumNumber);
  themePopover.appendChild(lumRow);

  // Chroma
  const chromaLabel = document.createElement("label");
  chromaLabel.textContent = "Chroma";
  themePopover.appendChild(chromaLabel);

  const chromaRow = document.createElement("div");
  chromaRow.className = "chat-theme-hue-row";
  const chromaSlider = document.createElement("input");
  chromaSlider.type = "range"; chromaSlider.min = "0"; chromaSlider.max = "40"; chromaSlider.value = String(Math.round(themeC * 100));
  const chromaNumber = document.createElement("input");
  chromaNumber.type = "number"; chromaNumber.min = "0"; chromaNumber.max = "40"; chromaNumber.value = String(Math.round(themeC * 100));

  chromaSlider.addEventListener("input", () => {
    themeC = parseFloat(chromaSlider.value) / 100; chromaNumber.value = chromaSlider.value;
    updateThemeFromSliders();
  });
  chromaNumber.addEventListener("input", () => {
    themeC = parseFloat(chromaNumber.value) / 100; chromaSlider.value = chromaNumber.value;
    updateThemeFromSliders();
  });
  chromaRow.appendChild(chromaSlider);
  chromaRow.appendChild(chromaNumber);
  themePopover.appendChild(chromaRow);

  themeBtn.appendChild(themePopover);
  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    themePopover.classList.toggle("show");
  });

  function setTheme(color) {
    root.style.setProperty("--theme", color);

    // Parse L, C, H from the oklch color
    const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
    const L = m ? parseFloat(m[1]) : 0.55;
    const C = m ? parseFloat(m[2]) : 0.18;
    const H = m ? parseFloat(m[3]) : 270;

    // Use L to smoothly interpolate between dark and light surfaces.
    // t=0 means fully dark surfaces, t=1 means fully light surfaces.
    // Smooth transition centred around L=0.5
    const t = Math.max(0, Math.min(1, (L - 0.3) / 0.4));

    // Surface lightness: lerp between dark (0.08-0.25) and light (0.88-0.97)
    const lerp = (a, b) => a + (b - a) * t;
    // Surface chroma: scale down from theme chroma
    const sc = C * 0.3;

    const set = (k, v) => root.style.setProperty(k, v);
    const oklch = (l, c, h) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h})`;

    // Surface lightness lerps between dark and light extremes.
    // At L=1,C=0 the lerp should produce pure white (1.0).
    set("--bg-darkest",  oklch(lerp(0.08, 1.00), sc, H));
    set("--bg-dark",     oklch(lerp(0.11, 0.98), sc, H));
    set("--bg-mid",      oklch(lerp(0.15, 0.95), sc, H));
    set("--bg-hover",    oklch(lerp(0.18, 0.92), sc, H));
    set("--bg-input",    oklch(lerp(0.13, 1.00), sc, H));
    set("--border",      oklch(lerp(0.25, 0.85), sc * 1.3, H));

    // Text: always pure black or white for maximum contrast.
    // bg-dark lightness determines which to use.
    const bgL = lerp(0.11, 0.98);
    const lightBg = bgL > 0.55;
    set("--text-primary",   lightBg ? "black" : "white");
    set("--text-secondary", oklch(lightBg ? 0.35 : 0.68, 0, 0));
    set("--text-muted",     oklch(lightBg ? 0.50 : 0.50, 0, 0));

    // Accent: ensure it contrasts with the background.
    // When chroma is very low OR luminosity is very low, the raw theme color
    // would be invisible against the background.
    const darkBg = L < 0.32;  // very dark background
    if (C < 0.04) {
      // Near-grayscale: use a contrasting neutral
      const accentL = darkBg || t < 0.5 ? 0.75 : 0.25;
      set("--accent",       oklch(accentL, 0, H));
      set("--accent-hover", oklch(accentL + (accentL > 0.5 ? -0.1 : 0.1), 0, H));
      set("--accent-fg",    oklch(accentL > 0.5 ? 0.10 : 0.95, 0, 0));
    } else if (darkBg) {
      // Dark bg with chroma: lighten the accent so it's visible
      set("--accent",       oklch(Math.max(L + 0.35, 0.55), C, H));
      set("--accent-hover", oklch(Math.max(L + 0.45, 0.65), C, H));
      set("--accent-fg",    oklch(0.10, 0, 0));
    } else {
      set("--accent",       color);
      set("--accent-hover", oklch(L + (t > 0.5 ? -0.1 : 0.1), C, H));
      set("--accent-fg",    oklch(L > 0.6 ? 0.10 : 0.97, 0, 0));
    }
    set("--accent-soft", `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H} / 0.15)`);

    try { localStorage.setItem("chat-theme-color", color); } catch(e) {}
  }

  // Apply saved theme now that setTheme is defined
  try {
    const saved = localStorage.getItem("chat-theme-color");
    if (saved) setTheme(saved);
  } catch(e) {}

  // Close popover on outside click
  themePopover.addEventListener("click", (e) => { e.stopPropagation(); });
  root.addEventListener("click", () => { themePopover.classList.remove("show"); });

  // ---- Presence bar (with theme button) ----
  const presenceBar = document.createElement("div");
  presenceBar.className = "chat-presence-bar";
  presenceBar.appendChild(themeBtn);
  root.appendChild(presenceBar);

  // ---- Messages area ----
  const messagesArea = document.createElement("div");
  messagesArea.className = "chat-messages";
  root.appendChild(messagesArea);

  // ---- Typing bar (at the bottom, above input) ----
  const typingBar = document.createElement("div");
  typingBar.className = "chat-typing-bar";
  root.appendChild(typingBar);

  // ---- Input wrapper ----
  const inputWrapper = document.createElement("div");
  inputWrapper.className = "chat-input-wrapper";
  root.appendChild(inputWrapper);

  // Reply bar
  const replyBar = document.createElement("div");
  replyBar.className = "chat-reply-bar";
  const replyBarLabel = document.createElement("span");
  replyBarLabel.textContent = "Replying to ";
  const replyBarText = document.createElement("span");
  replyBarText.className = "chat-reply-bar-text";
  const replyBarClose = document.createElement("button");
  replyBarClose.className = "chat-reply-bar-close";
  replyBarClose.innerHTML = SVG_ICONS.close;
  replyBarClose.addEventListener("click", () => { replyToId = null; replyBar.classList.remove("show"); });
  replyBar.appendChild(replyBarLabel);
  replyBar.appendChild(replyBarText);
  replyBar.appendChild(replyBarClose);
  inputWrapper.appendChild(replyBar);

  // Paste preview
  const pastePreview = document.createElement("div");
  pastePreview.className = "chat-paste-preview";
  const pasteImg = document.createElement("img");
  const pasteName = document.createElement("span");
  pasteName.style.color = "var(--text-secondary)";
  const pasteClose = document.createElement("button");
  pasteClose.className = "chat-paste-preview-close";
  pasteClose.innerHTML = SVG_ICONS.close;
  pasteClose.addEventListener("click", clearPaste);
  pastePreview.appendChild(pasteImg);
  pastePreview.appendChild(pasteName);
  pastePreview.appendChild(pasteClose);
  inputWrapper.appendChild(pastePreview);

  // Input row
  const inputRow = document.createElement("div");
  inputRow.className = "chat-input-row";
  inputWrapper.appendChild(inputRow);

  // GIF camera toggle (left side of input bar)
  const gifToggle = document.createElement("button");
  gifToggle.className = "chat-gif-toggle";
  gifToggle.title = "Toggle GIF selfie mode";
  const gifIcon = document.createElement("span");
  gifIcon.className = "chat-gif-icon";
  gifIcon.innerHTML = SVG_ICONS.camera;
  const gifVideo = document.createElement("video");
  gifVideo.autoplay = true; gifVideo.muted = true; gifVideo.playsInline = true;
  gifToggle.appendChild(gifIcon);
  gifToggle.appendChild(gifVideo);
  inputRow.appendChild(gifToggle);

  const gifCanvas = document.createElement("canvas");
  gifCanvas.width = 80; gifCanvas.height = 80;
  gifCanvas.style.display = "none";
  inputRow.appendChild(gifCanvas);

  gifToggle.addEventListener("click", () => {
    gifModeEnabled = !gifModeEnabled;
    gifToggle.classList.toggle("active", gifModeEnabled);
    if (gifModeEnabled) startGifCamera();
    else stopGifCamera();
  });

  // Text input
  const input = document.createElement("textarea");
  input.className = "chat-input";
  input.rows = 1;
  input.placeholder = "Message #Chat";
  inputRow.appendChild(input);

  // Mic button
  const micBtn = document.createElement("button");
  micBtn.className = "chat-input-btn";
  micBtn.innerHTML = SVG_ICONS.mic;
  micBtn.title = "Record voice note";
  inputRow.appendChild(micBtn);

  // Send button
  const sendBtn = document.createElement("button");
  sendBtn.className = "chat-input-btn";
  sendBtn.innerHTML = SVG_ICONS.send;
  sendBtn.title = "Send";
  inputRow.appendChild(sendBtn);

  // ---- Emoji picker overlay ----
  const emojiOverlay = document.createElement("div");
  emojiOverlay.className = "chat-emoji-picker-overlay";
  const emojiPicker = document.createElement("div");
  emojiPicker.className = "chat-emoji-picker";
  emojiOverlay.appendChild(emojiPicker);
  root.appendChild(emojiOverlay);

  let emojiPickerTarget = null;

  function openEmojiPicker(msgIndex, anchorEl) {
    emojiPickerTarget = { msgIndex };
    renderEmojiPicker();
    emojiOverlay.classList.add("show");

    const rect = anchorEl.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const pickerWidth = 280;
    const pickerHeight = Math.min(emojiPicker.scrollHeight, 320);

    // Horizontal: center on anchor, clamp within root
    let left = (rect.left + rect.width / 2) - rootRect.left - pickerWidth / 2;
    if (left + pickerWidth > rootRect.width - 8) left = rootRect.width - pickerWidth - 8;
    if (left < 8) left = 8;

    // Vertical: prefer above anchor, fall back to below if not enough space
    const spaceAbove = rect.top - rootRect.top;
    const spaceBelow = rootRect.bottom - rect.bottom;
    if (spaceAbove >= pickerHeight + 4) {
      emojiPicker.style.bottom = (rootRect.bottom - rect.top + 4) + "px";
      emojiPicker.style.top = "auto";
    } else {
      emojiPicker.style.top = (rect.bottom - rootRect.top + 4) + "px";
      emojiPicker.style.bottom = "auto";
    }
    emojiPicker.style.left = left + "px";
    emojiPicker.style.right = "auto";
  }

  function renderEmojiPicker(filter) {
    emojiPicker.innerHTML = "";
    const search = document.createElement("input");
    search.className = "chat-emoji-picker-search";
    search.placeholder = "Search emoji by name...";
    search.value = filter || "";
    search.addEventListener("input", () => renderEmojiPicker(search.value));
    emojiPicker.appendChild(search);
    setTimeout(() => search.focus(), 0);

    const grid = document.createElement("div");
    grid.className = "chat-emoji-grid";
    grid.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    grid.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
    emojiPicker.appendChild(grid);

    let emojis;
    if (EMOJI_LOADED) {
      const q = (filter || "").toLowerCase();
      emojis = q
        ? EMOJI_DATA.filter(e => e.name.includes(q) || e.emoji === q)
        : EMOJI_DATA;
    } else {
      emojis = (filter
        ? FALLBACK_EMOJIS.filter(e => e.includes(filter))
        : FALLBACK_EMOJIS
      ).map(e => ({ emoji: e, name: "" }));
    }

    for (const entry of emojis) {
      const btn = document.createElement("button");
      btn.textContent = entry.emoji;
      if (entry.name) btn.title = entry.name;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (emojiPickerTarget) toggleReaction(emojiPickerTarget.msgIndex, entry.emoji);
        closeEmojiPicker();
      });
      grid.appendChild(btn);
    }
  }

  function closeEmojiPicker() { emojiOverlay.classList.remove("show"); emojiPickerTarget = null; }
  emojiOverlay.addEventListener("click", (e) => { if (e.target === emojiOverlay) closeEmojiPicker(); });

  // ---- Auto-resize textarea ----
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    broadcastPresence(true);
  });

  // ---- Paste image ----
  input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        const ext = item.type.split("/")[1] || "png";
        const name = "image-" + Date.now() + "." + ext;
        const reader = new FileReader();
        reader.onload = () => {
          pastedImageData = { blob, dataUrl: reader.result, name, mimeType: item.type };
          pasteImg.src = reader.result;
          pasteName.textContent = name;
          pastePreview.classList.add("show");
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  });

  function clearPaste() { pastedImageData = null; pastePreview.classList.remove("show"); pasteImg.src = ""; }

  // ---- File/recording creation ----
  async function createFileDoc(blob) {
    const repo = window.repo; if (!repo) throw new Error("No repo");
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const fh = await repo.create2({ content: u8, "@patchwork": { type: "file" } });
    return fh.url;
  }

  async function createRecordingDoc(audioBlob, duration) {
    const repo = window.repo; if (!repo) throw new Error("No repo");
    const u8 = new Uint8Array(await audioBlob.arrayBuffer());
    const ah = await repo.create2({ content: u8 });
    const rh = await repo.create2({
      title: "Voice Note", audio: ah.url, duration: duration,
      "@patchwork": { type: "recording", suggestedImportUrl: "automerge:2a5Rkw9LkqXfBAQZbcBWjTcf15Mc" },
    });
    return { url: rh.url };
  }

  // ---- GIF camera ----
  async function startGifCamera() {
    try {
      gifStream = await navigator.mediaDevices.getUserMedia({ video: { width:80, height:80, facingMode:"user" } });
      gifVideo.srcObject = gifStream;
    } catch(e) { console.warn("[Chat] camera:", e); gifModeEnabled = false; gifToggle.classList.remove("active"); }
  }

  function stopGifCamera() {
    if (gifStream) { gifStream.getTracks().forEach(t => t.stop()); gifStream = null; }
    gifVideo.srcObject = null;
  }

  async function captureGif() {
    if (!gifStream || !gifVideo.videoWidth) return null;
    
    // Show recording feedback
    gifToggle.classList.add("recording");
    inputRow.classList.add("processing");
    
    try {
      const size = 80;
      gifCanvas.width = size; gifCanvas.height = size;
      const ctx = gifCanvas.getContext("2d");
      const encoder = new SimpleGIFEncoder(size, size);
      const frameCount = 10, frameDelay = 200;
      
      for (let i = 0; i < frameCount; i++) {
        ctx.drawImage(gifVideo, 0, 0, size, size);
        encoder.addFrame(gifCanvas, frameDelay);
        if (i < frameCount - 1) await new Promise(r => setTimeout(r, frameDelay));
      }
      
      const data = encoder.encode();
      if (!data) return null;
      const blob = new Blob([data], { type: "image/gif" });
      const url = await createFileDoc(blob);
      handle.change((d) => { if (!d.docs) d.docs = []; d.docs.push({ url, type:"file", name:"selfie-"+Date.now()+".gif" }); });
      return url;
    } finally {
      // Remove recording feedback
      gifToggle.classList.remove("recording");
      inputRow.classList.remove("processing");
    }
  }

  // ---- Voice recording ----
  let recTimerInterval = null;
  let recAnalyser = null;
  let recAnimFrame = null;
  let recSendOnStop = false; // true = send, false = cancelled
  let recordingBar = null;

  micBtn.addEventListener("click", () => { isRecording ? stopAndSendRec() : startRec(); });

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mime = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mime)) { mime = "audio/webm"; if (!MediaRecorder.isTypeSupported(mime)) mime = undefined; }
      recordingChunks = [];
      recSendOnStop = false;
      mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordingChunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        cleanupRecordingUI();
        const dur = (Date.now() - recordingStartTime) / 1000;
        if (!recSendOnStop || dur < 0.5) {
          isRecording = false;
          return;
        }
        const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        try {
          const { url } = await createRecordingDoc(blob, dur);
          handle.change((d) => { if (!d.docs) d.docs = []; d.docs.push({ url, type:"recording", name:"voice-"+Date.now() }); });
          sendMsg(null, null, null, url, dur);
        } catch(e) { console.error("[Chat] voice:", e); }
        isRecording = false;
      };

      // Set up audio analyser for waveform visualization
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        recAnalyser = audioCtx.createAnalyser();
        recAnalyser.fftSize = 64;
        source.connect(recAnalyser);
      } catch(e) { recAnalyser = null; }

      recordingStartTime = Date.now();
      mediaRecorder.start(100);
      isRecording = true;
      showRecordingUI();
    } catch(e) { console.error("[Chat] mic:", e); }
  }

  function stopAndSendRec() {
    recSendOnStop = true;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  function cancelRec() {
    recSendOnStop = false;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  function showRecordingUI() {
    // Hide the normal input row, show recording bar
    inputRow.style.display = "none";

    recordingBar = document.createElement("div");
    recordingBar.className = "chat-recording-bar";

    const dot = document.createElement("div");
    dot.className = "chat-recording-dot";
    recordingBar.appendChild(dot);

    const timeEl = document.createElement("span");
    timeEl.className = "chat-recording-time";
    timeEl.textContent = "0:00";
    recordingBar.appendChild(timeEl);

    // Live waveform visualization
    const viz = document.createElement("div");
    viz.className = "chat-recording-viz";
    const vizBars = [];
    for (let i = 0; i < 32; i++) {
      const bar = document.createElement("div");
      bar.className = "chat-recording-viz-bar";
      bar.style.height = "3px";
      viz.appendChild(bar);
      vizBars.push(bar);
    }
    recordingBar.appendChild(viz);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "chat-recording-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", cancelRec);
    recordingBar.appendChild(cancelBtn);

    const sendRecBtn = document.createElement("button");
    sendRecBtn.className = "chat-recording-send";
    sendRecBtn.innerHTML = SVG_ICONS.send;
    sendRecBtn.addEventListener("click", stopAndSendRec);
    recordingBar.appendChild(sendRecBtn);

    inputWrapper.appendChild(recordingBar);

    // Update timer every second
    recTimerInterval = setInterval(() => {
      const elapsed = (Date.now() - recordingStartTime) / 1000;
      timeEl.textContent = formatDuration(elapsed);
    }, 500);

    // Animate waveform from analyser
    function animateViz() {
      if (!isRecording) return;
      if (recAnalyser) {
        const data = new Uint8Array(recAnalyser.frequencyBinCount);
        recAnalyser.getByteFrequencyData(data);
        for (let i = 0; i < vizBars.length; i++) {
          const val = data[i] || 0;
          vizBars[i].style.height = Math.max(3, (val / 255) * 22) + "px";
        }
      }
      recAnimFrame = requestAnimationFrame(animateViz);
    }
    animateViz();
  }

  function cleanupRecordingUI() {
    if (recTimerInterval) { clearInterval(recTimerInterval); recTimerInterval = null; }
    if (recAnimFrame) { cancelAnimationFrame(recAnimFrame); recAnimFrame = null; }
    recAnalyser = null;
    if (recordingBar) { recordingBar.remove(); recordingBar = null; }
    inputRow.style.display = "";
  }

  // ---- Patchwork URL parsing ----
  const TINY_PW_RE = /https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/g;
  function parsePatchworkLinks(text) {
    const links = [];
    let match;
    while ((match = TINY_PW_RE.exec(text)) !== null) {
      try {
        const parsed = new URL(match[0]);
        if (parsed.hash) {
          const params = new URLSearchParams(parsed.hash.slice(1));
          const docId = params.get("doc");
          if (docId) {
            links.push({
              docUrl: "automerge:" + docId,
              title: params.get("title") ? decodeURIComponent(params.get("title").replace(/\+/g, " ")) : "",
              type: params.get("type") || "",
              originalUrl: match[0],
            });
          }
        }
      } catch(e) {}
    }
    TINY_PW_RE.lastIndex = 0;
    return links;
  }

  // ---- Send ----
  async function sendMessage() {
    const text = input.value.trim();
    let imageUrl = null, imageName = null;
    if (pastedImageData) {
      try {
        imageUrl = await createFileDoc(pastedImageData.blob);
        imageName = pastedImageData.name;
        handle.change((d) => { if (!d.docs) d.docs = []; d.docs.push({ url:imageUrl, type:"file", name:imageName }); });
      } catch(e) { console.error("[Chat] image:", e); }
      clearPaste();
    }
    // Extract patchwork doc links from text
    const patchworkLinks = parsePatchworkLinks(text);
    // Strip the URLs from the displayed text
    let cleanText = text;
    for (const link of patchworkLinks) {
      cleanText = cleanText.replace(link.originalUrl, "").trim();
    }

    if (!cleanText && !imageUrl && patchworkLinks.length === 0) return;

    let gifUrl = null;
    if (gifModeEnabled) {
      try { gifUrl = await captureGif(); } catch(e) { console.warn("[Chat] gif:", e); }
    }

    try {
      await sendMsg(cleanText, imageUrl, imageName, null, null, gifUrl, patchworkLinks.length > 0 ? patchworkLinks : null);
    } catch(e) { console.error("[Chat] sendMsg:", e); }
    input.value = "";
    input.style.height = "auto";
    input.focus();
  }

  // ---- Message doc cache ----
  const msgDocCache = new Map(); // url -> { data, handle }
  const msgDocSubscribed = new Set(); // urls we're listening to

  async function resolveMessageDoc(url) {
    if (msgDocCache.has(url)) return msgDocCache.get(url);
    try {
      const repo = window.repo; if (!repo) return null;
      const mh = await repo.find(url);
      const data = mh.doc();
      if (data) msgDocCache.set(url, { data, handle: mh });
      // Subscribe to changes on this message doc
      if (!msgDocSubscribed.has(url)) {
        msgDocSubscribed.add(url);
        mh.on("change", () => {
          const updated = mh.doc();
          if (updated) msgDocCache.set(url, { data: updated, handle: mh });
          render();
        });
      }
      return msgDocCache.get(url);
    } catch(e) { console.warn("[Chat] resolve msg doc:", e); return null; }
  }

  // Kick off loading for any unresolved message refs
  function ensureMessageDocsLoaded(entries) {
    let needsRerender = false;
    for (const entry of entries) {
      if (entry.ref && entry.url && !msgDocCache.has(entry.url)) {
        needsRerender = true;
        resolveMessageDoc(entry.url); // async, will trigger render on resolve
      }
    }
  }

  async function sendMsg(text, imageUrl, imageName, voiceUrl, voiceDuration, gifSelfieUrl, embeds) {
    const repo = window.repo;
    const msgData = { id: generateId(), name: myName, text: text || "", timestamp: Date.now() };
    if (myFont) msgData.font = myFont;
    if (myAvatarUrl) msgData.avatarUrl = myAvatarUrl;
    if (replyToId) msgData.replyTo = replyToId;
    if (imageUrl) { msgData.imageUrl = imageUrl; msgData.imageName = imageName; }
    if (voiceUrl) { msgData.voiceUrl = voiceUrl; msgData.voiceDuration = voiceDuration; }
    if (gifSelfieUrl) msgData.gifSelfieUrl = gifSelfieUrl;
    if (embeds) msgData.embeds = embeds;

    // Create individual message doc
    const msgHandle = await repo.create2(msgData);
    const msgUrl = msgHandle.url;

    // Cache it immediately
    msgDocCache.set(msgUrl, { data: msgData, handle: msgHandle });
    if (!msgDocSubscribed.has(msgUrl)) {
      msgDocSubscribed.add(msgUrl);
      msgHandle.on("change", () => {
        const updated = msgHandle.doc();
        if (updated) msgDocCache.set(msgUrl, { data: updated, handle: msgHandle });
        render();
      });
    }

    // Add reference to chat doc
    handle.change((d) => {
      if (!d.messages) d.messages = [];
      d.messages.push({ ref: true, url: msgUrl, timestamp: msgData.timestamp });
    });

    replyToId = null;
    replyBar.classList.remove("show");
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });

  // ---- Reactions ----
  function toggleReaction(idx, emoji) {
    const doc = handle.doc();
    const entry = doc?.messages?.[idx];
    if (!entry) return;

    if (entry.ref && entry.url) {
      // Ref message: change the message's own doc
      const cached = msgDocCache.get(entry.url);
      if (!cached) return;
      cached.handle.change((d) => {
        if (!d.reactions) d.reactions = {};
        if (!d.reactions[emoji]) d.reactions[emoji] = [];
        const arr = d.reactions[emoji];
        const i = arr.indexOf(myName);
        if (i >= 0) { arr.splice(i, 1); if (arr.length === 0) delete d.reactions[emoji]; }
        else arr.push(myName);
      });
    } else {
      // Inline (legacy) message
      handle.change((d) => {
        const msg = d.messages[idx]; if (!msg) return;
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
        const arr = msg.reactions[emoji];
        const i = arr.indexOf(myName);
        if (i >= 0) { arr.splice(i, 1); if (arr.length === 0) delete msg.reactions[emoji]; }
        else arr.push(myName);
      });
    }
  }

  // ---- Reply ----
  function setReply(msgId) {
    replyToId = msgId;
    // Find message data - could be inline or ref
    const doc = handle.doc();
    let msg = null;
    for (const entry of (doc.messages || [])) {
      if (entry.ref && entry.url) {
        const cached = msgDocCache.get(entry.url);
        if (cached && cached.data.id === msgId) { msg = cached.data; break; }
      } else if (entry.id === msgId) { msg = entry; break; }
    }
    if (msg) replyBarText.textContent = msg.name + ": " + (msg.text || "(attachment)");
    replyBar.classList.add("show");
    input.focus();
  }

  // ---- Load blobs ----
  async function loadBlobUrl(automergeUrl) {
    if (!automergeUrl) return null;
    if (avatarCache.has(automergeUrl)) return avatarCache.get(automergeUrl);
    try {
      const repo = window.repo; if (!repo) return null;
      const fh = await repo.find(automergeUrl);
      const doc = fh.doc();
      if (doc?.content) {
        const bytes = doc.content instanceof Uint8Array ? doc.content : new Uint8Array(doc.content);
        const url = URL.createObjectURL(new Blob([bytes]));
        avatarCache.set(automergeUrl, url);
        return url;
      }
    } catch(e) {}
    return null;
  }

  async function loadAudioUrl(automergeUrl) {
    try {
      const repo = window.repo; if (!repo) return null;
      const rh = await repo.find(automergeUrl); const rd = rh.doc();
      if (!rd?.audio) return null;
      const ah = await repo.find(rd.audio); const ad = ah.doc();
      if (ad?.content) {
        const bytes = ad.content instanceof Uint8Array ? ad.content : new Uint8Array(ad.content);
        return URL.createObjectURL(new Blob([bytes], { type:"audio/webm;codecs=opus" }));
      }
    } catch(e) {}
    return null;
  }

  // ---- Render presence ----
  function renderPresence() {
    const now = Date.now();
    presenceBar.innerHTML = "";

    // Show self first
    if (myName) {
      const el = document.createElement("div");
      el.className = "chat-presence-user" + (!isFocused ? " away" : "");
      const av = document.createElement("span");
      av.className = "chat-presence-avatar";
      if (myAvatarBlobUrl) {
        av.innerHTML = '<img src="'+myAvatarBlobUrl+'">';
      } else {
        av.textContent = (myName || "?")[0].toUpperCase();
      }
      el.appendChild(av);
      const lbl = document.createElement("span");
      lbl.textContent = myName;
      el.appendChild(lbl);
      presenceBar.appendChild(el);
    }

    for (const [name, info] of presenceMap) {
      if (name === myName) continue;
      if (now - info.timestamp > PRESENCE_TIMEOUT) continue;
      const el = document.createElement("div");
      el.className = "chat-presence-user" + (!info.active ? " away" : "");
      const av = document.createElement("span");
      av.className = "chat-presence-avatar";
      if (info.avatarUrl) {
        loadBlobUrl(info.avatarUrl).then(u => { if (u) av.innerHTML = '<img src="'+u+'">'; });
      } else {
        av.textContent = (name || "?")[0].toUpperCase();
      }
      el.appendChild(av);
      const lbl = document.createElement("span");
      lbl.textContent = name;
      el.appendChild(lbl);
      presenceBar.appendChild(el);
    }

    // Re-append theme button (innerHTML cleared it)
    presenceBar.appendChild(themeBtn);
  }

  function renderTyping() {
    const now = Date.now();
    const typers = [];
    for (const [name, info] of presenceMap) {
      if (name === myName) continue;
      if (info.typing && now - info.timestamp < TYPING_TIMEOUT) typers.push(name);
    }
    typingBar.textContent = typers.length > 0
      ? typers.join(", ") + (typers.length === 1 ? " is" : " are") + " typing..."
      : "";
  }

  // ---- Render messages ----
  function render() {
    const doc = handle.doc();
    if (!doc) return;

    input.placeholder = "Message " + (doc.title || "chat");

    const rawEntries = doc.messages || [];

    // Kick off loading for any unresolved ref messages
    ensureMessageDocsLoaded(rawEntries);

    // Resolve entries: inline messages pass through, ref messages resolve from cache
    // Each resolved item tracks its rawIndex for mutations (reactions, delete)
    const messages = [];
    for (let ri = 0; ri < rawEntries.length; ri++) {
      const entry = rawEntries[ri];
      if (entry.ref && entry.url) {
        const cached = msgDocCache.get(entry.url);
        if (cached) {
          messages.push({ ...cached.data, _rawIdx: ri, _ref: entry });
        }
        // If not cached yet, skip — will re-render when loaded
      } else {
        messages.push({ ...entry, _rawIdx: ri });
      }
    }

    const msgMap = new Map();
    for (const m of messages) if (m.id) msgMap.set(m.id, m);

    // Remember scroll position to decide if we should auto-scroll
    const wasAtBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 40;

    messagesArea.innerHTML = "";

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "No messages yet. Say hello! 👋";
      messagesArea.appendChild(empty);
      return;
    }

    let prevName = null, prevTime = 0;

    messages.forEach((msg) => {
      const rawIdx = msg._rawIdx;
      const isMine = msg.name === myName;
      const sameAuthor = msg.name === prevName;
      const closeInTime = msg.timestamp - prevTime < 300000;
      const isContinuation = sameAuthor && closeInTime && !msg.replyTo;
      const hasGifSelfie = !!msg.gifSelfieUrl;

      // Reply reference (always before the message)
      if (msg.replyTo && msgMap.has(msg.replyTo)) {
        const orig = msgMap.get(msg.replyTo);
        const ref = document.createElement("div");
        ref.className = "chat-msg-reply-ref";
        const refAvatar = document.createElement("span");
        refAvatar.className = "chat-msg-reply-ref-avatar";
        if (orig.avatarUrl) loadBlobUrl(orig.avatarUrl).then(u => { if (u) refAvatar.innerHTML = '<img src="'+u+'">'; });
        ref.appendChild(refAvatar);
        const refName = document.createElement("span");
        refName.className = "chat-msg-reply-ref-name";
        refName.textContent = orig.name;
        ref.appendChild(refName);
        const refText = document.createElement("span");
        refText.className = "chat-msg-reply-ref-text";
        refText.textContent = orig.text || "(attachment)";
        ref.appendChild(refText);
        ref.addEventListener("click", () => {
          const el = messagesArea.querySelector('[data-msg-id="'+msg.replyTo+'"]');
          if (el) { el.scrollIntoView({ behavior:"smooth", block:"center" }); el.style.background="var(--bg-hover)"; setTimeout(()=>el.style.background="",1500); }
        });
        messagesArea.appendChild(ref);
      }

      if (!isContinuation) {
        // Full message row with avatar
        const row = document.createElement("div");
        row.className = "chat-msg-group";
        row.dataset.msgId = msg.id || "";

        buildActions(row, msg, rawIdx);

        // Avatar
        const avatarCol = document.createElement("div");
        avatarCol.className = "chat-avatar-col";
        const avatar = document.createElement("div");
        avatar.className = "chat-avatar";
        if (catEarsSet.has(msg.name)) avatar.classList.add("cat-ears");

        const avatarSrc = msg.gifSelfieUrl || msg.avatarUrl;
        if (msg.gifSelfieUrl) avatar.classList.add("gif-selfie");
        if (avatarSrc) {
          loadBlobUrl(avatarSrc).then(u => { if (u) avatar.innerHTML = '<img src="'+u+'">'; });
        } else {
          avatar.textContent = (msg.name || "?")[0].toUpperCase();
        }
        avatar.addEventListener("click", () => {
          if (catEarsSet.has(msg.name)) catEarsSet.delete(msg.name);
          else catEarsSet.add(msg.name);
          render();
        });
        avatarCol.appendChild(avatar);
        row.appendChild(avatarCol);

        // Body
        const body = document.createElement("div");
        body.className = "chat-msg-body";

        const hdr = document.createElement("div");
        hdr.className = "chat-msg-header";
        const nameEl = document.createElement("span");
        nameEl.className = "chat-msg-name";
        nameEl.textContent = msg.name;
        hdr.appendChild(nameEl);
        const timeEl = document.createElement("span");
        timeEl.className = "chat-msg-time";
        timeEl.textContent = formatTime(msg.timestamp);
        hdr.appendChild(timeEl);
        body.appendChild(hdr);

        if (msg.text) {
          const textEl = document.createElement("div");
          textEl.className = "chat-msg-text";
          textEl.textContent = msg.text;
          if (msg.font) textEl.style.fontFamily = msg.font;
          body.appendChild(textEl);
        }

        renderAttachments(body, msg);
        renderReactions(body, msg, rawIdx);
        row.appendChild(body);
        messagesArea.appendChild(row);

      } else {
        // Continuation message
        const row = document.createElement("div");
        row.className = "chat-msg-continuation" + (hasGifSelfie ? " has-gif" : "");
        row.dataset.msgId = msg.id || "";

        buildActions(row, msg, rawIdx);

        // If this continuation has a GIF selfie, show it aligned with the avatar column
        if (hasGifSelfie) {
          const gifCol = document.createElement("div");
          gifCol.className = "chat-avatar-col";
          const gifInline = document.createElement("img");
          gifInline.className = "chat-msg-gif-inline";
          gifInline.alt = "selfie";
          loadBlobUrl(msg.gifSelfieUrl).then(u => { if (u) gifInline.src = u; });
          gifCol.appendChild(gifInline);
          row.appendChild(gifCol);
        }

        const contBody = document.createElement("div");
        contBody.className = "chat-msg-body";

        if (msg.text) {
          const textEl = document.createElement("div");
          textEl.className = "chat-msg-text";
          textEl.textContent = msg.text;
          if (msg.font) textEl.style.fontFamily = msg.font;
          contBody.appendChild(textEl);
        }

        renderAttachments(contBody, msg);
        renderReactions(contBody, msg, rawIdx);
        row.appendChild(contBody);
        messagesArea.appendChild(row);
      }

      prevName = msg.name;
      prevTime = msg.timestamp;
    });

    // Scroll to bottom reliably
    if (wasAtBottom || messagesArea.children.length <= 1) {
      requestAnimationFrame(() => {
        messagesArea.scrollTop = messagesArea.scrollHeight;
      });
    }

    renderPresence();
    renderTyping();
  }

  function deleteMessage(idx) {
    handle.change((d) => {
      if (!d.messages || idx < 0 || idx >= d.messages.length) return;
      const entry = d.messages[idx];
      // Clean up cache if it was a ref
      if (entry.ref && entry.url) {
        msgDocCache.delete(entry.url);
        msgDocSubscribed.delete(entry.url);
      }
      d.messages.splice(idx, 1);
    });
  }

  function buildActions(row, msg, idx) {
    const actions = document.createElement("div");
    actions.className = "chat-msg-actions";

    const replyBtn = document.createElement("button");
    replyBtn.className = "chat-msg-action-btn";
    replyBtn.innerHTML = SVG_ICONS.reply;
    replyBtn.title = "Reply";
    replyBtn.addEventListener("click", (e) => { e.stopPropagation(); setReply(msg.id); });
    actions.appendChild(replyBtn);

    const reactBtn = document.createElement("button");
    reactBtn.className = "chat-msg-action-btn";
    reactBtn.innerHTML = SVG_ICONS.react;
    reactBtn.title = "Add reaction";
    reactBtn.addEventListener("click", (e) => { e.stopPropagation(); openEmojiPicker(idx, reactBtn); });
    actions.appendChild(reactBtn);

    // "..." menu with delete
    const menuWrap = document.createElement("div");
    menuWrap.className = "chat-msg-menu-wrap";
    const moreBtn = document.createElement("button");
    moreBtn.className = "chat-msg-action-btn";
    moreBtn.innerHTML = SVG_ICONS.more;
    moreBtn.title = "More";
    const menu = document.createElement("div");
    menu.className = "chat-msg-menu";

    const deleteItem = document.createElement("button");
    deleteItem.className = "chat-msg-menu-item danger";
    deleteItem.innerHTML = SVG_ICONS.trash + " Delete";
    deleteItem.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.remove("show");
      deleteMessage(idx);
    });
    menu.appendChild(deleteItem);

    moreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any other open menus
      root.querySelectorAll(".chat-msg-menu.show").forEach(m => { if (m !== menu) m.classList.remove("show"); });
      menu.classList.toggle("show");
    });

    // Close menu on outside click
    const closeMenu = (e) => {
      if (!menuWrap.contains(e.target)) menu.classList.remove("show");
    };
    root.addEventListener("click", closeMenu);

    menuWrap.appendChild(moreBtn);
    menuWrap.appendChild(menu);
    actions.appendChild(menuWrap);

    const inlineTime = document.createElement("span");
    inlineTime.className = "chat-msg-inline-time";
    inlineTime.textContent = formatTime(msg.timestamp);
    actions.appendChild(inlineTime);

    row.appendChild(actions);
  }

  function makeResizable(container, msg, key) {
    const grip = document.createElement("div");
    grip.className = "chat-resize-handle";
    grip.innerHTML = '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1L1 9M9 5L5 9M9 8L8 9"/></svg>';
    container.appendChild(grip);

    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const startW = container.offsetWidth, startH = container.offsetHeight;
      const onMove = (ev) => {
        const w = Math.max(100, startW + ev.clientX - startX);
        const h = Math.max(60, startH + ev.clientY - startY);
        container.style.width = w + "px";
        container.style.height = h + "px";
      };
      const onUp = (ev) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        const w = container.offsetWidth, h = container.offsetHeight;
        // Save dimensions to message doc
        const rawIdx = msg._rawIdx;
        const ref = msg._ref;
        if (ref && ref.url) {
          const cached = msgDocCache.get(ref.url);
          if (cached) cached.handle.change((d) => { d[key + "Width"] = w; d[key + "Height"] = h; });
        } else {
          handle.change((d) => {
            const m = d.messages?.[rawIdx]; if (!m) return;
            m[key + "Width"] = w; m[key + "Height"] = h;
          });
        }
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function renderAttachments(parent, msg) {
    if (msg.imageUrl) {
      const wrap = document.createElement("div");
      wrap.className = "chat-msg-image-wrap";
      if (msg.imageWidth) wrap.style.width = msg.imageWidth + "px";
      else wrap.style.width = "350px";
      if (msg.imageHeight) wrap.style.height = msg.imageHeight + "px";
      else wrap.style.height = "auto";
      const img = document.createElement("img");
      img.className = "chat-msg-image";
      img.alt = msg.imageName || "image";
      img.loading = "lazy";
      loadBlobUrl(msg.imageUrl).then(u => { if (u) img.src = u; });
      wrap.appendChild(img);
      makeResizable(wrap, msg, "image");
      parent.appendChild(wrap);
    }
    if (msg.voiceUrl) {
      const vn = document.createElement("div");
      vn.className = "chat-voice-note";
      const playBtn = document.createElement("button");
      playBtn.className = "chat-voice-play-btn";
      playBtn.innerHTML = SVG_ICONS.play;
      const waveform = document.createElement("div");
      waveform.className = "chat-voice-waveform";
      for (let i = 0; i < 24; i++) {
        const bar = document.createElement("div");
        bar.className = "chat-voice-bar";
        bar.style.height = (3 + Math.random() * 18) + "px";
        waveform.appendChild(bar);
      }
      const dur = document.createElement("span");
      dur.className = "chat-voice-duration";
      dur.textContent = msg.voiceDuration ? formatDuration(msg.voiceDuration) : "0:00";
      let audio = null, loaded = false;
      playBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!loaded) {
          const u = await loadAudioUrl(msg.voiceUrl);
          if (u) { audio = new Audio(u); audio.onended = () => { playBtn.innerHTML = SVG_ICONS.play; }; loaded = true; }
        }
        if (audio) {
          if (audio.paused) { audio.play(); playBtn.innerHTML = SVG_ICONS.pause; }
          else { audio.pause(); playBtn.innerHTML = SVG_ICONS.play; }
        }
      });
      vn.appendChild(playBtn); vn.appendChild(waveform); vn.appendChild(dur);
      parent.appendChild(vn);
    }
    if (msg.embeds) {
      for (let ei = 0; ei < msg.embeds.length; ei++) {
        const embed = msg.embeds[ei];
        const wrap = document.createElement("div");
        wrap.className = "chat-msg-embed";
        if (msg["embedWidth_" + ei]) wrap.style.width = msg["embedWidth_" + ei] + "px";
        if (msg["embedHeight_" + ei]) wrap.style.height = msg["embedHeight_" + ei] + "px";
        const pv = document.createElement("patchwork-view");
        pv.setAttribute("doc-url", embed.docUrl);
        wrap.appendChild(pv);
        if (embed.title) {
          const titleEl = document.createElement("div");
          titleEl.className = "chat-msg-embed-title";
          titleEl.textContent = embed.title;
          wrap.appendChild(titleEl);
        }
        makeResizable(wrap, msg, "embed_" + ei);
        parent.appendChild(wrap);
      }
    }
  }

  function renderReactions(parent, msg, idx) {
    if (!msg.reactions || Object.keys(msg.reactions).length === 0) return;
    const container = document.createElement("div");
    container.className = "chat-reactions";
    for (const [emoji, names] of Object.entries(msg.reactions)) {
      if (!names || names.length === 0) continue;
      const el = document.createElement("span");
      el.className = "chat-reaction" + (names.includes(myName) ? " mine" : "");
      el.title = names.join(", ");
      el.appendChild(document.createTextNode(emoji + " "));
      const count = document.createElement("span");
      count.className = "chat-reaction-count";
      count.textContent = names.length;
      el.appendChild(count);
      el.addEventListener("click", (e) => { e.stopPropagation(); toggleReaction(idx, emoji); });
      container.appendChild(el);
    }
    const addBtn = document.createElement("button");
    addBtn.className = "chat-reaction-add";
    addBtn.innerHTML = SVG_ICONS.plus;
    addBtn.addEventListener("click", (e) => { e.stopPropagation(); openEmojiPicker(idx, addBtn); });
    container.appendChild(addBtn);
    parent.appendChild(container);
  }

  render();
  handle.on("change", render);
  setTimeout(() => broadcastPresence(false), 500);

  return () => {
    handle.off("change", render);
    if (presenceInterval) clearInterval(presenceInterval);
    if (mediaRecorder && mediaRecorder.state !== "inactive") { recSendOnStop = false; mediaRecorder.stop(); }
    cleanupRecordingUI();
    stopGifCamera();
    root.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:datatype",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    async load() { return ChatDatatype; },
  },
  {
    type: "patchwork:tool",
    id: "chat",
    name: "Chat",
    icon: "MessageCircle",
    supportedDatatypes: ["chat"],
    async load() { return Tool; },
  },
];
