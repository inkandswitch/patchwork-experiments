import { NewspaceDatatype } from "./datatype.js";
import { stringSchema, anySchema, numberSchema, fileSchema, audioSchema, imageSchema, pixelsSchema, pointSchema, streamSchema } from "./opstreams.js";
import { templateInlets } from "./template-doc.js"; // tiny sync parser; the mount stays lazy
import { rleEncode, rleDecode } from "./rle.js"; // run-length codec for the RLE lenses
import { llmInlets, llmOutlets } from "./llm-inlets.js"; // sync: {{var}} → inlets, @out → outlets
// self-contained node/lens plugins (each its own file + tests)
import { plugin as mathOpPlugin } from "./math-op-node.js";
import { plugin as rangeMapPlugin } from "./range-map-node.js";
import { plugin as splitJoinPlugin } from "./split-join-node.js";
import { plugin as mapListPlugin } from "./map-list-node.js";
import { plugin as batteryPlugin } from "./battery-source.js";
import { plugin as clipboardPlugin } from "./clipboard-source.js";
import { plugin as orientationPlugin } from "./orientation-source.js";
import { plugin as motionPlugin } from "./motion-source.js";
import { plugin as gatePlugin } from "./gate-node.js";
import { plugin as combinePlugin } from "./combine-node.js";
import { plugin as switchPlugin } from "./switch-node.js";
import { plugin as bufferPlugin } from "./buffer-node.js";
import { plugin as delayPlugin } from "./delay-node.js";
import { plugin as clampPlugin } from "./clamp-node.js";
import { plugin as roundPlugin } from "./round-node.js";
import { plugin as jsonPrettyLens } from "./json-pretty-lens.js";
import { plugin as throttlePlugin } from "./throttle-node.js";
import { plugin as pointerLockPlugin } from "./pointerlock-source.js";
import { plugin as magnifierPlugin } from "./llm-magnifier.js";
import { plugin as shareTrayPlugin } from "./share-tray.js";
import { markerPlugin } from "./marker-brush.js";
import { inkPenPlugin } from "./ink-pen-brush.js";
import { plugin as crayonPlugin } from "./crayon-brush.js";
import { plugin as charcoalPlugin } from "./charcoal-brush.js";

// write a cased view back to its source, keeping the source's ORIGINAL case for any
// character that's unchanged (matches case-insensitively); new/edited chars take the
// view's case. (`cased` is "toUpperCase" | "toLowerCase")
function recase(view, src, cased) {
  if (typeof view !== "string") return undefined;
  const orig = typeof src === "string" ? src : "";
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const oc = orig[i];
    out += oc && oc[cased]() === view[i] ? oc : view[i];
  }
  return out;
}

export const plugins = [
  // brushes live in their own modules, dynamically imported in load() so their
  // code is a separate chunk (not pulled into the main bundle eagerly)
  {
    type: "sketchy:brush",
    id: "highlighter",
    name: "Highlighter",
    icon: "Highlighter",
    async load() {
      return (await import("./highlighter.js")).HighlighterBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "constraint",
    name: "Constraint sketch",
    icon: "Ruler",
    async load() {
      return (await import("./constraint.js")).ConstraintBrush;
    },
  },
  {
    type: "sketchy:brush",
    id: "voice",
    name: "Voice note",
    icon: "Mic",
    async load() {
      return (await import("./voice.js")).VoiceBrush;
    },
  },
  shareTrayPlugin, // a tray tool showing the live WebRTC share-session
  // contributed stroke brushes (each a self-contained sketchy:brush plugin with params)
  markerPlugin,
  inkPenPlugin,
  crayonPlugin,
  charcoalPlugin,
  // sketchy:editor — a node with typed inlets/outlets carrying opstreams. inlets/
  // outlets are declared inline (readable without loading the editor); load()
  // returns the heavy mount fn. See src/editors.js for the contract.
  {
    type: "sketchy:window",
    id: "codemirror",
    name: "Text editor",
    icon: "FileCode",
    supportedDatatypes: ["file", "*"],
    inlets: [
      { name: "content", type: "text", schema: stringSchema() }, // optional: unwired ⇒ codemirror is a source (authors its own text)
      { name: "language", type: "language" },
    ],
    outlets: [{ name: "text", type: "text", schema: stringSchema() }], // provides: string
    async load() {
      return (await import("./codemirror/sketchy-editor.js")).mountCodemirror;
    },
  },
  // an HTML box: sets its innerHTML to whatever its `html` inlet carries (a sink).
  {
    type: "sketchy:window",
    id: "html",
    name: "HTML",
    icon: "Code",
    inlets: [{ name: "html", type: "text", schema: anySchema() }], // optional: shows cached html when unwired
    outlets: [],
    async load() { return (await import("./html-box.js")).mountHtml; },
  },
  // a generic inspector: shows a wired stream's live value (any shape) as JSON.
  // registered AFTER codemirror so text streams still prefer codemirror; non-text
  // (pointer/camera/selection/…) land here.
  {
    type: "sketchy:window",
    id: "inspector",
    name: "Inspector",
    icon: "Eye",
    inlets: [{ name: "value", type: "json", schema: anySchema(), required: true }], // accepts: anything
    outlets: [],
    async load() {
      return (await import("./inspector-editor.js")).mountInspector;
    },
  },
  // ── SOURCES (no inlets — they PRODUCE a stream from the platform) ────────────
  // the `file` source: pick a local file (File System Access API) and emit a
  // read-only File snapshot, WATCHED so it reflects on-disk changes. Compose with a
  // File→text / File→JSON lens. (To EDIT a file in place, use "Edit file" below.)
  {
    type: "sketchy:window",
    id: "file",
    name: "File",
    icon: "FileInput",
    inlets: [],
    outlets: [
      { name: "text", type: "text", schema: stringSchema() }, // editable + saveable
      { name: "bytes", type: "bytes" },
      { name: "file", type: "file", schema: fileSchema() },   // {name,size,…,text} snapshot
    ],
    async load() { return (await import("./source-nodes.js")).mountFileSource; },
  },
  {
    type: "sketchy:window",
    id: "clock",
    name: "Clock",
    icon: "Clock",
    inlets: [],
    outlets: [{ name: "time", type: "number", schema: numberSchema() }], // provides: epoch ms
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { clockSource } = await import("./sources.js");
      return makeSourceMount({ start: () => clockSource(), outlet: "time", label: "clock" });
    },
  },
  // the canvas CONTEXT as placeable source nodes (replacing the old bottom chips):
  // camera (viewport), pointer, tool, brush, selection — each switchable 👤 own ⟷ 📡 mine.
  ...[
    { id: "ctx-camera", name: "Viewport", icon: "Frame", out: "camera", schema: pointSchema() }, // {x,y,z}
    { id: "ctx-pointer", name: "Pointer position", icon: "MousePointer", out: "pointer", schema: pointSchema() },
    { id: "ctx-brush", name: "Active brush", icon: "Brush", out: "brush", schema: anySchema() }, // brush config + the current tool
    { id: "ctx-selection", name: "Selection", icon: "BoxSelect", out: "selection", schema: anySchema() }, // array of ids
  ].map((c) => ({
    type: "sketchy:window", id: c.id, name: c.name, icon: c.icon, inlets: [],
    outlets: [{ name: c.out, type: "json", schema: c.schema }],
    async load() { const { makeSourceMount, contextStart } = await import("./source-nodes.js"); return makeSourceMount({ start: contextStart(c.out), outlet: c.out, label: c.name.toLowerCase() }); },
  })),
  {
    type: "sketchy:window",
    id: "gamepad",
    name: "Gamepad",
    icon: "Gamepad2",
    inlets: [],
    outlets: [{ name: "gamepad", type: "json", schema: anySchema() }],
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { gamepadSource } = await import("./sources.js");
      return makeSourceMount({ start: () => gamepadSource(), outlet: "gamepad", label: "gamepad" });
    },
  },
  {
    type: "sketchy:window",
    id: "geolocation",
    name: "Geolocation",
    icon: "MapPin",
    inlets: [],
    outlets: [{ name: "position", type: "json", schema: anySchema() }],
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { geolocationSource } = await import("./sources.js");
      return makeSourceMount({ start: () => geolocationSource(), outlet: "position", label: "location", gated: true });
    },
  },
  {
    type: "sketchy:window",
    id: "midi",
    name: "MIDI",
    icon: "Piano",
    inlets: [],
    outlets: [{ name: "midi", type: "json", schema: anySchema() }],
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { midiSource } = await import("./sources.js");
      return makeSourceMount({ start: () => midiSource(), outlet: "midi", label: "midi", gated: true });
    },
  },
  // CAMERA — live preview; provides `video` (a MediaStream) and `image` (frame data-URL)
  {
    type: "sketchy:window",
    id: "camera",
    name: "Camera",
    icon: "Camera",
    role: "source", // grouped as a source even though it has an optional bang inlet
    inlets: [{ name: "bang", type: "bang" }], // capture a frame per bang (else ~10fps auto)
    outlets: [{ name: "video", type: "json", schema: streamSchema() }, { name: "image", type: "image", schema: imageSchema() }],
    async load() { return (await import("./media-nodes.js")).mountCamera; },
  },
  // IMAGE display — paints a wired frame (ImageData / ImageBitmap / url) to a canvas
  {
    type: "sketchy:window",
    id: "image",
    name: "Image",
    icon: "Image",
    inlets: [{ name: "image", type: "image", schema: imageSchema() }],
    outlets: [],
    async load() { return (await import("./media-nodes.js")).mountImage; },
  },
  // image → data URL: a frame (ImageData) as a PNG data-url string (for an <img src> /
  // the HTML box). The canonical frame is ImageData; this is the opt-in base64 adapter.
  {
    type: "sketchy:lens", id: "image-to-dataurl", name: "image → data URL", icon: "Link",
    inlet: { name: "in", type: "image", schema: imageSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (img) => {
      if (typeof img === "string") return img;
      if (typeof document === "undefined" || typeof ImageData === "undefined" || !(img instanceof ImageData)) return "";
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      c.getContext("2d").putImageData(img, 0, 0);
      try { return c.toDataURL("image/png"); } catch { return ""; }
    },
  },
  // PIXELS display — paint a raw Float32/typed-array pixel buffer to a canvas (the
  // "display float32 pixel data" node). Set w/h/channels for a bare array; ImageData
  // or {data,width,height} carry their own dims. Floats auto-normalise to 0..255.
  {
    type: "sketchy:window",
    id: "pixels",
    name: "Pixels",
    icon: "Grid2x2",
    inlets: [{ name: "pixels", type: "pixels", schema: pixelsSchema() }],
    outlets: [],
    async load() { return (await import("./media-nodes.js")).mountPixels; },
  },
  // VIDEO display — plays a wired MediaStream (or an image/video url)
  {
    type: "sketchy:window",
    id: "video",
    name: "Video",
    icon: "Monitor",
    inlets: [{ name: "video", type: "json", schema: anySchema() }],
    outlets: [],
    async load() { return (await import("./media-nodes.js")).mountVideo; },
  },
  // MIC — Web Audio input: live {rms,peak} levels + an AnalyserNode (in complement)
  {
    type: "sketchy:window",
    id: "mic",
    name: "Microphone",
    icon: "Mic",
    inlets: [],
    outlets: [{ name: "audio", type: "audio", schema: audioSchema() }],
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { micSource } = await import("./sources.js");
      return makeSourceMount({ start: () => micSource(), outlet: "audio", label: "mic", gated: true, stream: true });
    },
  },
  // AUDIO FILE — play a music file; provides {time,…} + an analyser (for the Scope)
  {
    type: "sketchy:window",
    id: "audio-file",
    name: "Audio file",
    icon: "Music",
    inlets: [],
    outlets: [{ name: "audio", type: "audio", schema: audioSchema() }],
    async load() { return (await import("./media-nodes.js")).mountAudioFile; },
  },
  // SPEAKER — play a wired audio source (mic, etc.) through the speakers
  {
    type: "sketchy:window",
    id: "speaker",
    name: "Speaker",
    icon: "Volume2",
    inlets: [{ name: "audio", type: "audio", schema: audioSchema(), required: true }],
    outlets: [],
    async load() { return (await import("./media-nodes.js")).mountSpeaker; },
  },
  // SCOPE — draws the live Float32 waveform of a wired audio source
  {
    type: "sketchy:window",
    id: "scope",
    name: "Scope",
    icon: "Activity",
    inlets: [{ name: "audio", type: "audio", schema: audioSchema() }],
    outlets: [],
    async load() { return (await import("./media-nodes.js")).mountScope; },
  },
  // RAF — a bang every animation frame (~60fps), for smooth visual loops
  {
    type: "sketchy:window",
    id: "raf",
    name: "RAF (60fps)",
    icon: "Activity",
    inlets: [],
    outlets: [{ name: "bang", type: "bang" }],
    async load() {
      const { makeSourceMount } = await import("./source-nodes.js");
      const { rafSource } = await import("./sources.js");
      return makeSourceMount({ start: () => rafSource(), outlet: "bang", label: "raf" });
    },
  },
  // BANG — a click-to-fire momentary trigger (PD/Max/Orca). Each fire is unique so it
  // always propagates. Wire it to a triggerable inlet (e.g. the LLM's `bang`).
  {
    type: "sketchy:window",
    id: "bang",
    name: "Bang",
    icon: "Zap",
    inlets: [],
    outlets: [{ name: "bang", type: "bang" }],
    async load() { return (await import("./source-nodes.js")).mountBang; },
  },
  // TIMER — fires a bang on an interval (a metronome). Interval persisted.
  {
    type: "sketchy:window",
    id: "timer",
    name: "Timer",
    icon: "Timer",
    inlets: [],
    outlets: [{ name: "bang", type: "bang" }],
    async load() { return (await import("./source-nodes.js")).mountTimer; },
  },
  // COUNTER — counts bangs (0,1,2,…). Wire a bang/timer into it.
  {
    type: "sketchy:window",
    id: "counter",
    name: "Counter",
    icon: "Plus",
    inlets: [{ name: "+", type: "bang" }, { name: "-", type: "bang" }, { name: "reset", type: "bang" }],
    outlets: [{ name: "count", type: "number", schema: numberSchema() }],
    async load() { return (await import("./flow-nodes.js")).mountCounter; },
  },
  // SAMPLE & HOLD — on a bang at `trigger`, emit the current `value`.
  {
    type: "sketchy:window",
    id: "sample",
    name: "Sample & hold",
    icon: "Crosshair",
    inlets: [
      { name: "value", type: "json", schema: anySchema() },
      { name: "trigger", type: "bang" },
    ],
    outlets: [{ name: "out", type: "json", schema: anySchema() }],
    async load() { return (await import("./flow-nodes.js")).mountSample; },
  },
  // LLM (powered by @chee/patchwork-llm): transform `in` → `out` guided by a prompt
  // (editable in the UI AND wireable via the optional `prompt` inlet). With no `in`
  // wired it generates from the prompt — so it doubles as a standalone generator.
  {
    type: "sketchy:window",
    id: "llm",
    name: "LLM",
    icon: "Sparkles",
    inlets: [
      { name: "in", type: "json", schema: anySchema() },          // any value to process
      { name: "prompt", type: "text", schema: stringSchema() },   // the prompt (param-as-inlet)
      { name: "bang", type: "bang" },                              // fire to run on demand
    ],
    outlets: [{ name: "out", type: "json", schema: anySchema() }], // any result (static fallback)
    dynamicInlets: llmInlets,   // {{var}} in the prompt → text inlets
    dynamicOutlets: llmOutlets, // out + think + one per `@out name`
    async load() { return (await import("./llm-node.js")).mountLlm; },
  },
  // an LLM SOURCE: no input — generate from the (UI) prompt alone.
  {
    type: "sketchy:window",
    id: "llm-source",
    name: "LLM source",
    icon: "Sparkles",
    inlets: [],
    outlets: [{ name: "out", type: "json", schema: anySchema() }],
    dynamicInlets: llmInlets,
    dynamicOutlets: llmOutlets,
    async load() { return (await import("./llm-node.js")).mountLlm; },
  },
  // a raw value source: type a literal (text/number/boolean/json) → emit it. The
  // universal constant you can feed into any inlet. Persisted in the doc.
  {
    type: "sketchy:window",
    id: "value",
    name: "Raw value",
    icon: "Pencil",
    inlets: [],
    outlets: [{ name: "value", type: "json", schema: anySchema() }],
    async load() { return (await import("./source-nodes.js")).mountRawValue; },
  },
  // the automerge source: a URL → the doc as an opstream (pulls REAL Patchwork docs
  // into the wiring system). Wire `doc` into json-path / inspector / a patchwork-tool.
  {
    type: "sketchy:window",
    id: "automerge",
    name: "Automerge doc",
    icon: "Database",
    inlets: [],
    outlets: [{ name: "doc", type: "json", schema: anySchema() }],
    async load() { return (await import("./source-nodes.js")).mountAutomergeSource; },
  },
  // TEMPLATE DOC — write a JSON template and punch wireable holes with `<…>`. Each
  // hole becomes a DYNAMIC inlet (named by its path); the `doc` outlet is the template
  // filled from the wired streams. Builds an automerge-doc-shaped value out of opstreams.
  {
    type: "sketchy:window",
    id: "template",
    name: "Template doc",
    icon: "Braces",
    inlets: [], // DYNAMIC — derived from the template text (see dynamicInlets)
    outlets: [{ name: "doc", type: "json", schema: anySchema() }],
    dynamicInlets: templateInlets, // sync: template text → inlet defs
    async load() { return (await import("./template-doc.js")).mountTemplateDoc; },
  },
  // an EMPTY tool: no doc until you wire one into `doc` (from an automerge source, or
  // a doc dragged from the sidebar). Renders a live <patchwork-view> for that doc.
  {
    type: "sketchy:window",
    id: "patchwork-tool",
    name: "Tool",
    icon: "AppWindow",
    inlets: [{ name: "doc", type: "json", schema: anySchema(), required: true }],
    outlets: [],
    async load() { return (await import("./patchwork-tool.js")).mountPatchworkTool; },
  },
  // an EDIT-a-file editor: pick a local file and edit it in CodeMirror with Save,
  // now WATCHED (reloads from disk unless you have unsaved edits).
  {
    type: "sketchy:window",
    id: "file-edit",
    name: "Edit file",
    icon: "FolderOpen",
    inlets: [],
    outlets: [{ name: "text", type: "text", schema: stringSchema() }],
    async load() { return (await import("./codemirror/file-editor.js")).mountFileEditor; },
  },
  // ── LENSES & lens-with-UI nodes (TRANSFORM a stream) ─────────────────────────
  // a jq-ish JSON narrowing node — a LENS WITH UI (a text field for the path), so
  // it's a node, not a bare sketchy:lens. number/text/json in → narrowed value out.
  {
    type: "sketchy:window",
    id: "json-path",
    name: "JSON path",
    icon: "Filter",
    inlets: [{ name: "json", type: "json", schema: anySchema(), required: true }],
    outlets: [{ name: "value", type: "json", schema: anySchema() }],
    async load() { return (await import("./json-path.js")).mountJsonPath; },
  },
  // JS — write a JavaScript transform: `(x)=>y` (one-way) or `{get,set}` (bidi).
  // Defaults to passthrough. The lens-with-UI you hand-write.
  {
    type: "sketchy:window",
    id: "js",
    name: "JS",
    icon: "Braces",
    inlets: [{ name: "in", type: "json", schema: anySchema() }],
    outlets: [{ name: "out", type: "json", schema: anySchema() }],
    async load() { return (await import("./js-node.js")).mountJs; },
  },
  // json-set — the WRITE counterpart: wire a value + a target doc, give a path, and
  // it writes the value into that field. A sink (no outlet). The target must be
  // editable (its opstream has `apply`).
  {
    type: "sketchy:window",
    id: "json-set",
    name: "JSON set",
    icon: "FilePen",
    inlets: [
      { name: "value", type: "json", schema: anySchema(), required: true }, // the value to write
      { name: "into", type: "json", schema: anySchema(), required: true },  // the target opstream
    ],
    outlets: [],
    async load() { return (await import("./json-path.js")).mountJsonSet; },
  },
  // sketchy:lens — a node that sits ON a wire: one stream in, one derived stream
  // out (read-only, complement passes through). See src/lenses.js.
  {
    type: "sketchy:lens",
    id: "number-to-string",
    name: "number → string",
    icon: "Type",
    inlet: { name: "in", type: "number", schema: numberSchema() }, // accepts: a number
    outlet: { name: "out", type: "text", schema: stringSchema() }, // provides: a string
    project: (v) => (v == null ? "" : String(v)),
    // bidirectional: edit the text → parse back to a number (when valid) and write
    // it to the source. An invalid number is ignored (keeps the last good value).
    unproject: (str) => { const n = Number(str); return Number.isFinite(n) ? n : undefined; },
  },
  // JSON parse: a string → its parsed value (bidirectional — editing the parsed
  // value stringifies back, so `text → JSON parse → inspector/json-path` round-trips).
  {
    type: "sketchy:lens",
    id: "json-parse",
    name: "JSON parse",
    icon: "Braces",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (s) => { if (typeof s !== "string") return s ?? null; try { return JSON.parse(s); } catch { return null; } },
    unproject: (v) => { try { return JSON.stringify(v, null, 2); } catch { return undefined; } },
  },
  // File → text: the file's bytes as a string (for codemirror, etc.)
  {
    type: "sketchy:lens",
    id: "file-to-text",
    name: "File → text",
    icon: "FileText",
    inlet: { name: "in", type: "file", schema: fileSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (f) => (f && typeof f.text === "string" ? f.text : ""),
  },
  // File → JSON: parse the file's text (for the inspector / json-path)
  {
    type: "sketchy:lens",
    id: "file-to-json",
    name: "File → JSON",
    icon: "Braces",
    inlet: { name: "in", type: "file", schema: fileSchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (f) => { if (!f || typeof f.text !== "string") return null; try { return JSON.parse(f.text); } catch { return null; } },
  },
  // ── small general-purpose lenses (modular building blocks) ───────────────────
  // string → number (bidirectional: parse forward, String back)
  {
    type: "sketchy:lens", id: "string-to-number", name: "string → number", icon: "Hash",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "number", schema: numberSchema() },
    project: (s) => { const n = Number(s); return Number.isFinite(n) ? n : 0; },
    unproject: (n) => String(n),
  },
  // JSON stringify (bidirectional: stringify forward, parse back — inverse of JSON parse)
  {
    type: "sketchy:lens", id: "json-stringify", name: "JSON stringify", icon: "Braces",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } },
    unproject: (s) => { try { return JSON.parse(s); } catch { return undefined; } },
  },
  // uppercase / lowercase — BIDIRECTIONAL: editing the cased output writes back to the
  // source, KEEPING the source's original case for characters that didn't change (only
  // genuinely new/edited characters take the cased form). The original rides in via the
  // unproject's `src` arg — that's the complement at work.
  {
    type: "sketchy:lens", id: "uppercase", name: "UPPERCASE", icon: "CaseUpper",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (s) => (typeof s === "string" ? s.toUpperCase() : ""),
    unproject: (view, src) => recase(view, src, "toUpperCase"),
  },
  {
    type: "sketchy:lens", id: "lowercase", name: "lowercase", icon: "CaseLower",
    inlet: { name: "in", type: "text", schema: stringSchema() },
    outlet: { name: "out", type: "text", schema: stringSchema() },
    project: (s) => (typeof s === "string" ? s.toLowerCase() : ""),
    unproject: (view, src) => recase(view, src, "toLowerCase"),
  },
  // length — string/array length, or object key count
  {
    type: "sketchy:lens", id: "length", name: "length", icon: "Ruler",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "number", schema: numberSchema() },
    project: (v) => (v == null ? 0 : typeof v === "string" || Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 0),
  },
  // keys — an object's keys as an array
  {
    type: "sketchy:lens", id: "keys", name: "keys", icon: "KeyRound",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: (v) => (v && typeof v === "object" ? Object.keys(v) : []),
  },
  // RLE — compress repetitive data crossing a wire. A bidirectional lens: forward COMPRESSES
  // (runs collapse to [value,count]); writing the compressed form back DECOMPRESSES. Pair the
  // two (encode → … → decode) to ship a compact form through the opstream and restore it.
  {
    type: "sketchy:lens", id: "rle", name: "RLE encode", icon: "Minimize2",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: rleEncode, unproject: rleDecode,
  },
  {
    type: "sketchy:lens", id: "unrle", name: "RLE decode", icon: "Maximize2",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project: rleDecode, unproject: rleEncode,
  },
  // sketchy:layout descriptors — a folder rendered through a lens. Each points at the
  // patchwork:tool that renders it; the layout switcher re-opens the folder with that
  // tool (same docs, different lens). See LAYOUTS.md.
  {
    type: "sketchy:layout", id: "canvas", name: "Canvas", icon: "PenTool",
    toolId: "sketchy", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy" }; },
  },
  {
    type: "sketchy:layout", id: "list", name: "List", icon: "List",
    toolId: "sketchy:list", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy:list" }; },
  },
  {
    type: "sketchy:layout", id: "grid", name: "Grid", icon: "LayoutGrid",
    toolId: "sketchy:grid", supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return { toolId: "sketchy:grid" }; },
  },
  {
    type: "patchwork:tool", id: "sketchy:grid", name: "Grid", icon: "LayoutGrid",
    unlisted: true, supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() { return (await import("./grid-tool.jsx")).GridTool; },
  },
  // a LIST layout for a folder — same docs as the canvas, different lens; surfaces
  // the canvas complement ("what you're not seeing"). See LAYOUTS.md.
  {
    type: "patchwork:tool",
    id: "sketchy:list",
    name: "List",
    icon: "List",
    unlisted: true,
    supportedDatatypes: ["folder", "newspace", "sketch"],
    async load() {
      return (await import("./list-tool.jsx")).ListTool;
    },
  },
  // a simple form whose inputs are draggable PORTS (one per doc field)
  {
    type: "patchwork:tool",
    id: "form",
    name: "Fields",
    icon: "TextCursorInput",
    supportedDatatypes: ["*"],
    unlisted: true,
    async load() {
      return (await import("./form-tool.jsx")).FormTool;
    },
  },
  {
    type: "patchwork:datatype",
    id: "sketch",
    name: "Sketch",
    icon: "PenTool",
    async load() {
      return NewspaceDatatype;
    },
  },
  // the REUSABLE canvas as a first-class component. A patchwork:tool is "the component
  // + a default layout (opts)". Build your OWN tool over it: makeNewspaceTool({...opts}).
  // Registered so it's discoverable/introspectable (api.describe("sketchy-canvas")).
  {
    // the patchwork:COMPONENT (id "sketchy", same as the tool — ids are per-type) is where
    // the canvas lives: a `(element) => cleanup` that subscribes to the layout config + the
    // shapes/items the enclosing patchwork:tool provides, and renders the malleable canvas.
    type: "patchwork:component",
    id: "sketchy",
    name: "Sketchy",
    icon: "PenTool",
    async load() {
      return (await import("./component.js")).SketchyComponent;
    },
  },
  // the per-user "top layer" doc (floating inspectors + your movable chrome), lives
  // in your account, keyed by the folder you're viewing.
  {
    type: "patchwork:datatype",
    id: "sketchy:layer:top",
    name: "Sketchy top layer",
    icon: "Layers",
    unlisted: true,
    async load() {
      return {
        init(doc) { doc.floats = []; },
        getTitle() { return "Top layer"; },
        setTitle() {},
      };
    },
  },
  // contributed transform nodes/lenses (fanned out as self-contained plugin modules)
  mathOpPlugin,
  rangeMapPlugin,
  splitJoinPlugin,
  mapListPlugin,
  // contributed gated device sources
  batteryPlugin,
  clipboardPlugin,
  orientationPlugin,
  motionPlugin,
  // contributed utility dataflow nodes (gate=run-on-bang, combine=lensN fan-in, switch, buffer)
  gatePlugin,
  combinePlugin,
  switchPlugin,
  bufferPlugin,
  delayPlugin,
  clampPlugin,
  roundPlugin,
  jsonPrettyLens,
  throttlePlugin,
  pointerLockPlugin,
  magnifierPlugin, // LLM magnifying glass — describes what's under it on the board
  {
    type: "patchwork:tool",
    id: "sketchy",
    name: "Sketchy",
    icon: "PenTool",
    // its own datatype, the legacy `newspace` datatype, and any plain folder
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { NewspaceTool } = await import("./tool.jsx");
      return NewspaceTool;
    },
  },
  // SKETCHIER — the same canvas, but as the THIN/component shape: this tool only acquires
  // the docs and provides them (as opstreams) to a <patchwork-view component="sketchy">. The
  // canvas runs entirely off the provided streams. Same picture, fully decomposed tool↔component.
  {
    type: "patchwork:tool",
    id: "sketchier",
    name: "Sketchier",
    icon: "PenTool",
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { SketchyTool } = await import("./tool.jsx");
      return SketchyTool;
    },
  },
  // a stripped-down variant of the SAME canvas: only the pencil, no minimap.
  {
    type: "patchwork:tool",
    id: "sketchy:pencil",
    name: "Pencil",
    icon: "Pencil",
    unlisted: true,
    supportedDatatypes: ["sketch", "newspace", "folder"],
    async load() {
      const { SketchpadTool } = await import("./tool.jsx");
      return SketchpadTool;
    },
  },
];

console.log("sketchy plugin loaded");
