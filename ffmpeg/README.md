# FFmpeg

Audio, video, and image conversion for Patchwork, running entirely in the
browser via [ffmpeg](https://ffmpeg.org) compiled to WebAssembly
([ffmpeg.wasm](https://ffmpegwasm.netlify.app)).

## How it works

- The ~31MB single-threaded `@ffmpeg/core` binary is **not** bundled with the
  module. It is downloaded from a CDN (unpkg, pinned version) on first use,
  with a progress bar, and cached in the browser Cache API so subsequent
  loads are instant.
- The `@ffmpeg/ffmpeg` wrapper runs ffmpeg in its own **Web Worker**, so
  conversions never block the UI. Conversion progress is reported live.
- Inputs can be uploaded files, uploaded folders, or existing Patchwork
  documents — all of them can also be dragged and dropped onto the tool
  (including docs dragged from the sidebar). Each OS file becomes a regular
  Patchwork file doc; the ffmpeg doc only stores references.
- Dropping a Patchwork doc that isn't a plain file doc opens an outline of
  the document structure so you can pick which value to use as input (e.g.
  a bytes field holding a recording).
- One input is the *main* file (click a row to choose); the rest are
  available to ffmpeg by name for use in extra args (overlays, subtitles,
  audio tracks...).
- The target format is picked from a curated list (containers/codecs the
  bundled core encodes well) and defaults sensibly when an input is added.
  An **extra args** field passes anything else straight to ffmpeg, e.g.
  `-vf scale=640:-2 -an` or `-ss 3 -t 5`.
- Conversion runs on demand (button press) — media transcodes can be heavy,
  so nothing re-runs automatically.
- Results preview inline (`<video>`, `<audio>`, or `<img>`), with a Log tab
  showing ffmpeg's output, and can be downloaded or saved back into
  Patchwork as a file doc (the "Saved" chips are draggable into the sidebar).

## Develop

```bash
pnpm install
pnpm build            # build dist/
```

## Sync to Patchwork

```bash
pushwork init .       # first time only
pnpm push             # build + pushwork sync
pnpm register         # register module (needs $MODULE_SETTINGS_DOC_URL)
```
