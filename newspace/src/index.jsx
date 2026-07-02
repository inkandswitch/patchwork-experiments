import { stringSchema, anySchema, numberSchema, fileSchema, audioSchema, imageSchema, pixelsSchema, pointSchema, streamSchema } from "./opstreams.js";
import { templateInlets } from "./template-doc.js"; // tiny sync parser; the mount stays lazy
import { llmInlets, llmOutlets } from "./llm-inlets.js"; // sync: {{var}} → inlets, @out → outlets
import { layerPlugins } from "./registry/layers.js";
import { coreBrushPlugins, contributedBrushPlugins } from "./registry/brushes.js";
import { contributedNodePlugins } from "./registry/contributed-nodes.js";
import { layoutPlugins, sketchyToolPlugins } from "./registry/layout-tools.js";
import { mediaLensPlugins, wireLensPlugins } from "./registry/lenses.js";
import { log } from "./log.js";

export const plugins = [
  ...layerPlugins,
  ...coreBrushPlugins,
  ...contributedBrushPlugins,
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
  ...mediaLensPlugins,
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
  // sandbox — a box that IS an iframe boundary: JS from the `code` inlet runs in a
  // sandboxed iframe (allow-scripts only, never the host realm) with `input` (a live
  // mirror of `in`, op-rebased over a MessagePort), `output(v)` → `out`, and the in
  // stream's complement across the boundary (capabilities as async stubs, drops listed).
  // New code tears the iframe down and boots a fresh realm.
  {
    type: "sketchy:window",
    id: "sandbox",
    name: "Sandbox",
    icon: "Shield",
    inlets: [
      { name: "code", type: "text", schema: stringSchema() }, // JS source — each new value reboots the iframe
      { name: "in", type: "json", schema: anySchema() },      // mirrored into the iframe as `input`
    ],
    outlets: [{ name: "out", type: "json", schema: anySchema() }],
    async load() { return (await import("./sandbox-box.js")).mountSandbox; },
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
  ...wireLensPlugins,
  ...layoutPlugins,
  ...contributedNodePlugins,
  ...sketchyToolPlugins,
];

log.debug("plugin loaded");
