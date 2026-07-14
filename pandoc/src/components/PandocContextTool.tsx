import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";
import { render } from "solid-js/web";
import { useDocument } from "@automerge/automerge-repo-solid-primitives";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import type { PatchworkViewElement } from "@inkandswitch/patchwork-elements";

import type {
  AccountDocShape,
  FileDocShape,
  PandocContextDoc,
  PandocSourceSettings,
} from "../types";
import { contextStyles } from "../context-styles";
import { loadEngine, onLoadProgress, type LoadProgress } from "../pandoc/engine";
import { runConversion, type ConversionResult } from "../pandoc/convert";
import {
  FALLBACK_INPUT_FORMATS,
  FALLBACK_OUTPUT_FORMATS,
  autoOutputFormat,
  formatLabel,
  mimeByExtension,
} from "../pandoc/formats";
import { isFileLikeDoc } from "../files";
import { focusName, resolveFocused, type FocusResolution } from "../resolveFocused";
import { selectedDocUrl } from "../lib/selected-doc";
import { DocPicker, type DocPickSelection } from "./DocPicker";

type OutputContent = {
  content: string | Uint8Array;
  filename: string;
  ext: string;
  mime: string;
  to: string;
};

function documentIdOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.replace(/^automerge:/, "").split(/[?#/]/)[0] || undefined;
}

/** Strip any heads/query so we read (and convert) the live document. */
function toPlainUrl(url: string | undefined): AutomergeUrl | undefined {
  const id = documentIdOf(url);
  return id ? (`automerge:${id}` as AutomergeUrl) : undefined;
}

/** Compact format label for the header selects: drops the "(…)" qualifier. */
function shortLabel(fmt: string): string {
  return formatLabel(fmt).replace(/\s*\([^)]*\)\s*$/, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function previewHtml(res: ConversionResult): string {
  const text = res.text ?? "";
  if (/<html[\s>]/i.test(text)) return text;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        margin: 1.25rem; line-height: 1.6; color: #1c1c1e; }
      img { max-width: 100%; }
      pre { background: #f4f4f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
      blockquote { border-left: 3px solid #d4d4d8; margin-left: 0; padding-left: 1em; color: #52525b; }
      table { border-collapse: collapse; } td, th { border: 1px solid #e4e4e7; padding: 4px 10px; }
    </style></head><body>${text}</body></html>`;
}

export function PandocContextTool(
  handle: DocHandle<AccountDocShape>,
  element: PatchworkViewElement
) {
  const dispose = render(
    () => <PandocContextEditor handle={handle} element={element} />,
    element
  );
  return () => dispose();
}

function PandocContextEditor(props: {
  handle: DocHandle<AccountDocShape>;
  element: PatchworkViewElement;
}) {
  const repo = props.element.repo as unknown as Repo;
  const account = props.handle;

  // ─── focused document ───
  const rawUrl = selectedDocUrl(props.element);
  const sourceId = createMemo(() => documentIdOf(rawUrl()));
  const focusedUrl = createMemo(() => toPlainUrl(rawUrl()));
  const [focusedDoc] = useDocument<FileDocShape>(() => focusedUrl(), { repo });

  // ─── account-scoped settings (remembers output format per source) ───
  const [settingsUrl] = createResource(
    () => account.url,
    async () => {
      const existing = account.doc()?.pandocContextUrl;
      if (existing) return existing;
      const h = repo.create<PandocContextDoc>();
      h.change((d) => {
        d["@patchwork"] = { type: "pandoc-context" };
        d.title = "Pandoc conversions";
        d.sources = {};
      });
      account.change((d) => {
        d.pandocContextUrl = h.url;
      });
      return h.url;
    }
  );
  const [settingsDoc, settingsHandleRes] = useDocument<PandocContextDoc>(
    () => settingsUrl(),
    { repo }
  );
  const settingsHandle = () => settingsHandleRes();

  const sourceSettings = createMemo<PandocSourceSettings>(() => {
    const id = sourceId();
    if (!id) return {};
    return settingsDoc()?.sources?.[id] ?? {};
  });

  function updateSource(patch: Partial<PandocSourceSettings>) {
    const id = sourceId();
    const h = settingsHandle();
    if (!id || !h) return;
    h.change((d) => {
      if (!d.sources) d.sources = {};
      const cur = d.sources[id] ?? (d.sources[id] = {});
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (cur as Record<string, unknown>)[k];
        else (cur as Record<string, unknown>)[k] = v;
      }
    });
  }

  // ─── engine (lazy: only download once something convertible is focused) ───
  const [engineState, setEngineState] = createSignal<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [engineError, setEngineError] = createSignal("");
  const [progress, setProgress] = createSignal<LoadProgress | null>(null);
  const [inputFormats, setInputFormats] = createSignal<string[]>(
    FALLBACK_INPUT_FORMATS
  );
  const [outputFormats, setOutputFormats] = createSignal<string[]>(
    FALLBACK_OUTPUT_FORMATS
  );

  let engineStarted = false;
  function ensureEngine() {
    if (engineStarted) return;
    engineStarted = true;
    setEngineState("loading");
    const unsub = onLoadProgress(setProgress);
    loadEngine()
      .then((engine) => {
        if (engine.info.inputFormats.length > 0)
          setInputFormats(engine.info.inputFormats);
        if (engine.info.outputFormats.length > 0) {
          const outputs = engine.info.outputFormats;
          setOutputFormats(
            outputs.includes("pdf") ? outputs : [...outputs, "pdf"]
          );
        }
        setEngineState("ready");
      })
      .catch((err) => {
        engineStarted = false;
        setEngineError(String((err as Error)?.message ?? err));
        setEngineState("error");
      })
      .finally(() => unsub());
  }

  // ─── resolution + formats ───
  const resolution = createMemo<FocusResolution>(() => {
    const d = focusedDoc();
    if (!d) return { status: "empty" };
    return resolveFocused(d, {
      name: focusName(d, "document"),
      settings: sourceSettings(),
    });
  });

  const effectiveFrom = createMemo(() => {
    const r = resolution();
    return r.status === "ok" ? r.from : "markdown";
  });
  const effectiveTo = createMemo(() => {
    const s = sourceSettings();
    return s.to || autoOutputFormat(effectiveFrom());
  });

  const isStructured = createMemo(() => {
    const d = focusedDoc();
    return !!d && !isFileLikeDoc(d);
  });
  const fieldLabel = createMemo(() => {
    const r = resolution();
    return r.status === "ok" ? r.fieldLabel : "choose field";
  });

  // start downloading the engine as soon as we have something to convert
  createEffect(() => {
    if (resolution().status === "ok") ensureEngine();
  });

  // ─── conversion ───
  const [busy, setBusy] = createSignal(false);
  const [result, setResult] = createSignal<ConversionResult | null>(null);
  const [convError, setConvError] = createSignal("");
  const [tab, setTab] = createSignal<"preview" | "source">("preview");

  let runId = 0;
  async function convertNow() {
    const r = resolution();
    if (r.status !== "ok") {
      setResult(null);
      setConvError("");
      return;
    }
    ensureEngine();
    const id = ++runId;
    setBusy(true);
    try {
      const res = await runConversion({
        inputs: [r.input],
        mainIndex: 0,
        from: effectiveFrom(),
        to: effectiveTo(),
        standalone: true,
      });
      if (id !== runId) return;
      setResult(res);
      setConvError("");
    } catch (err) {
      if (id !== runId) return;
      setConvError(String((err as Error)?.message ?? err));
    } finally {
      if (id === runId) setBusy(false);
    }
  }

  // drop stale preview whenever the focused document changes
  createEffect(
    on(sourceId, () => {
      setResult(null);
      setConvError("");
    })
  );

  // auto-convert (debounced) on focus / content / settings change
  const convKey = createMemo(() => {
    const r = resolution();
    if (r.status !== "ok") return null;
    const c = r.input.content;
    const sig = typeof c === "string" ? c : `bin:${c.byteLength}`;
    return [sourceId(), r.input.name, effectiveFrom(), effectiveTo(), sig].join(
      "\u0000"
    );
  });
  let debounce: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const key = convKey();
    if (key === null) return;
    if (engineState() !== "ready") return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void convertNow(), 300);
  });
  onCleanup(() => clearTimeout(debounce));

  // ─── object URL for inline PDF preview ───
  const [pdfUrl, setPdfUrl] = createSignal<string | undefined>();
  createEffect(() => {
    const res = result();
    const prev = untrack(pdfUrl);
    if (prev) URL.revokeObjectURL(prev);
    setPdfUrl(
      res?.pdfPreview && res.blob ? URL.createObjectURL(res.blob) : undefined
    );
  });
  onCleanup(() => {
    const url = pdfUrl();
    if (url) URL.revokeObjectURL(url);
  });

  // ─── precomputed output so drag/download are instant (no await on drag) ───
  const [output, setOutput] = createSignal<OutputContent | null>(null);
  createEffect(() => {
    const res = result();
    if (!res) {
      setOutput(null);
      return;
    }
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    const ext = res.filename.split(".").pop() ?? "";
    const mime =
      mimeByExtension[ext] ||
      (res.kind === "binary" ? "application/octet-stream" : "text/plain");
    void (async () => {
      const content =
        res.kind === "binary"
          ? new Uint8Array(await res.blob!.arrayBuffer())
          : (res.text ?? "");
      if (!cancelled)
        setOutput({ content, filename: res.filename, ext, mime, to: res.to });
    })();
  });

  function onOutputDragStart(e: DragEvent) {
    const out = output();
    if (!out || !e.dataTransfer) {
      e.preventDefault();
      return;
    }
    const handle = repo.create<FileDocShape>({
      "@patchwork": { type: "file" },
      name: out.filename,
      extension: out.ext,
      mimeType: out.mime,
      content: out.content,
    });
    const url = handle.url;
    e.dataTransfer.setData("text/x-patchwork-urls", JSON.stringify([url]));
    e.dataTransfer.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({
        source: "pandoc",
        items: [{ url, name: out.filename, type: "file" }],
      })
    );
    e.dataTransfer.setData("text/plain", url);
    // Let the OS accept this drag straight to the desktop/Finder. The file doc
    // is served as its raw content (with mime type) by the patchwork service
    // worker at `/<encoded automerge url>/`. Chromium-only (`DownloadURL`), but
    // a harmless no-op elsewhere.
    try {
      const swUrl = new URL(
        `/${encodeURIComponent(url)}/`,
        location.origin
      ).href;
      e.dataTransfer.setData(
        "DownloadURL",
        `${out.mime}:${out.filename}:${swUrl}`
      );
    } catch {
      // location/URL construction can fail in exotic embeds — skip OS export.
    }
    // The Patchwork sideboard/sidebar sets dropEffect="move" on dragover; a
    // source restricted to "copy" makes the browser reject the drop entirely
    // (the drop event never fires). Allow both so every drop target accepts it.
    e.dataTransfer.effectAllowed = "copyMove";
  }

  function downloadOutput() {
    const out = output();
    if (!out) return;
    const blob = new Blob([out.content as BlobPart], { type: out.mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = out.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  // ─── field picker (structured docs) ───
  const [pickerOpen, setPickerOpen] = createSignal(false);
  function resolvePick(selection: DocPickSelection | null) {
    setPickerOpen(false);
    if (!selection) return;
    if (selection.kind === "whole") updateSource({ whole: true, path: undefined });
    else updateSource({ path: selection.path, whole: undefined });
  }

  function loadingText(): string {
    if (engineState() === "error")
      return `Couldn't load the converter: ${engineError()}`;
    if (engineState() === "loading") {
      const p = progress();
      if (!p || p.phase === "starting") return "Starting converter…";
      const loaded = formatBytes(p.loaded);
      return p.total
        ? `Downloading converter… ${loaded} / ${formatBytes(p.total)}`
        : `Downloading converter… ${loaded}`;
    }
    return "Converting…";
  }

  const sortedInputFormats = createMemo(() => [...inputFormats()].sort());
  const sortedOutputFormats = createMemo(() => [...outputFormats()].sort());
  const focusTitle = () => {
    const d = focusedDoc();
    return d ? focusName(d, "Untitled") : "document";
  };

  return (
    <div class="pandoc-ctx">
      <style>{contextStyles}</style>

      {/* ─── header: formats + draggable output + download, one line ─── */}
      <Show when={resolution().status === "ok"}>
        <div class="header cluster">
          <div class="formats cluster">
            <select
              class="select"
              title={`Source format: ${formatLabel(effectiveFrom())}`}
              onChange={(e) => updateSource({ from: e.currentTarget.value })}
            >
              <For each={sortedInputFormats()}>
                {(f) => (
                  <option value={f} selected={effectiveFrom() === f}>
                    {shortLabel(f)}
                  </option>
                )}
              </For>
            </select>

            <span class="arrow" aria-hidden="true">
              →
            </span>

            <select
              class="select"
              title={`Output format: ${formatLabel(effectiveTo())}`}
              onChange={(e) => updateSource({ to: e.currentTarget.value })}
            >
              <For each={sortedOutputFormats()}>
                {(f) => (
                  <option value={f} selected={effectiveTo() === f}>
                    {shortLabel(f)}
                  </option>
                )}
              </For>
            </select>
          </div>

          <Show when={isStructured()}>
            <button
              class="link"
              title="Choose which field to convert"
              onClick={() => setPickerOpen(true)}
            >
              {fieldLabel()}
            </button>
          </Show>

          <span class="spacer" />

          <Show when={result()}>
            {(r) => (
              <>
                {/* the converted document itself, as a draggable handle */}
                <div
                  class="doc-handle"
                  draggable={!!output()}
                  onDragStart={onOutputDragStart}
                  title={`Drag ${r().filename} into Patchwork`}
                >
                  <span class="grip" aria-hidden="true">
                    ⠿
                  </span>
                  <span class="doc-name">{r().filename}</span>
                </div>
                <button
                  class="icon-btn"
                  title={`Download ${r().filename}`}
                  disabled={!output()}
                  onClick={() => downloadOutput()}
                >
                  ↓
                </button>
              </>
            )}
          </Show>
        </div>
      </Show>

      {/* ─── preview ─── */}
      <div class="viewer">
        <Show when={result()}>
          {(r) => (
            <Show when={r().htmlPreview}>
              <div class="toolbar cluster">
                <div class="tabs cluster">
                  <button
                    class="tab"
                    data-active={tab() === "preview" ? "" : undefined}
                    onClick={() => setTab("preview")}
                  >
                    Preview
                  </button>
                  <button
                    class="tab"
                    data-active={tab() === "source" ? "" : undefined}
                    onClick={() => setTab("source")}
                  >
                    Source
                  </button>
                </div>
              </div>
            </Show>
          )}
        </Show>

        <div class="viewer-main">
          <Show
            when={!convError()}
            fallback={<div class="error">{convError()}</div>}
          >
            <Show
              when={result()}
              fallback={
                <div class="placeholder flow">
                  <Switch>
                    <Match when={resolution().status === "empty"}>
                      <div class="glyph" aria-hidden="true">
                        ⇱
                      </div>
                      <div>Focus a document to preview and convert it.</div>
                    </Match>
                    <Match when={resolution().status === "pick"}>
                      <div class="glyph" aria-hidden="true">
                        ◲
                      </div>
                      <div>This document has no obvious text to convert.</div>
                      <button class="btn" onClick={() => setPickerOpen(true)}>
                        Choose a field…
                      </button>
                    </Match>
                    <Match when={engineState() === "error"}>
                      <div class="glyph" aria-hidden="true">
                        ⚠
                      </div>
                      <div>{loadingText()}</div>
                    </Match>
                    <Match when={true}>
                      <span class="spinner" />
                      <div>{loadingText()}</div>
                      <Show
                        when={
                          progress()?.phase === "downloading" &&
                          progress()?.total
                        }
                      >
                        <div class="progress">
                          <div
                            style={{
                              width: `${Math.round(
                                (progress()!.loaded / progress()!.total!) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </Show>
                    </Match>
                  </Switch>
                </div>
              }
            >
              {(r) => (
                <Show
                  when={r().kind === "text"}
                  fallback={
                    <Show
                      when={r().pdfPreview && pdfUrl()}
                      fallback={
                        <div
                          class="binary-card flow"
                          draggable={!!output()}
                          onDragStart={onOutputDragStart}
                        >
                          <div class="glyph" aria-hidden="true">
                            ⭳
                          </div>
                          <div class="filename">{r().filename}</div>
                          <div class="muted">
                            {formatBytes(r().blob?.size ?? 0)} ·{" "}
                            {formatLabel(r().to)}
                          </div>
                          <div class="muted">Drag out or download above.</div>
                        </div>
                      }
                    >
                      <iframe class="frame" src={pdfUrl()} />
                    </Show>
                  }
                >
                  <Show
                    when={r().htmlPreview && tab() === "preview"}
                    fallback={
                      <pre
                        class="source"
                        draggable={!!output()}
                        onDragStart={onOutputDragStart}
                      >
                        {r().text}
                      </pre>
                    }
                  >
                    <iframe
                      class="frame"
                      sandbox="allow-same-origin"
                      srcdoc={previewHtml(r())}
                    />
                  </Show>
                </Show>
              )}
            </Show>

            <Show when={busy() && result()}>
              <div class="reconvert">
                <span class="spinner" />
              </div>
            </Show>
          </Show>
        </div>

        <Show when={(result()?.warnings.length ?? 0) > 0}>
          <div class="warnings">
            <For each={result()!.warnings}>{(w) => <div>{w}</div>}</For>
          </div>
        </Show>
      </div>

      <Show when={pickerOpen() && focusedDoc()}>
        <DocPicker
          title={focusTitle()}
          doc={focusedDoc()}
          onPick={(selection) => resolvePick(selection)}
          onCancel={() => resolvePick(null)}
        />
      </Show>
    </div>
  );
}
