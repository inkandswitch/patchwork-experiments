import "./styles.css";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  stringifyAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
  type Repo,
} from "@automerge/automerge-repo/slim";
import { subscribe } from "@inkandswitch/patchwork-providers-solid";
import {
  createPatch,
  isPathPatch,
  markPatch,
  patchHighlights,
  textPatch,
  type PatchHighlight,
  type PatchEntry,
  type PathPatch,
} from "./layers/index.js";

import { PatchCard } from "./Card.js";
import { coverage, Fields } from "./Fields.js";
import { FOLDER_SELECTOR, type PatchFolder, type PatchLink } from "./folder.js";
import { useDoc, useHandles } from "./reactive.js";
import {
  colourOf,
  nameOf,
  plain,
  samePath,
  type Entry,
  type Path,
  type Titled,
} from "./util.js";

export function PatchesPanel(props: { element: HTMLElement & { repo: Repo } }) {
  // Patch docs and their folder live in the realm's own repo, unremapped. The
  // document itself is read twice: as it really is (`root`), and as views
  // beneath the provider see it (`element.repo`), patches and all.
  const root = window.repo as Repo;

  const selected = subscribe<AutomergeUrl[]>(
    props.element,
    { type: "patchwork:selected-doc" },
    []
  );
  const docUrl = createMemo(() => {
    const url = selected()[0];
    if (!url || !isValidAutomergeUrl(url)) return undefined;
    return stringifyAutomergeUrl({
      documentId: parseAutomergeUrl(url).documentId,
    });
  });
  const folderUrl = subscribe<AutomergeUrl>(props.element, {
    type: FOLDER_SELECTOR,
  });

  const [base, baseHandle] = useDoc<unknown>(root, docUrl);
  const [shown, shownHandle] = useDoc<unknown>(props.element.repo, docUrl);
  const [folder, folderHandle] = useDoc<PatchFolder>(root, folderUrl);

  // The folder's patches, back first. Switching one off doesn't move it.
  const links = createMemo(() =>
    (folder()?.docs ?? []).filter(
      (l) => l?.type === "patch" && isValidAutomergeUrl(l.url)
    )
  );
  const patchHandles = useHandles<Titled>(root, () =>
    links().map((l) => l.url)
  );

  // Folders from before `off` kept switched-off patches in a separate list.
  createEffect(() => {
    if (!folder()?.shelved?.length) return;
    folderHandle()?.change((f) => {
      for (const l of f.shelved ?? []) {
        f.docs.push({ name: l.name, type: "patch", url: l.url, off: true });
      }
      delete f.shelved;
    });
  });

  // This document's patches, front first. An entry that hasn't changed is
  // handed back as the same object, so its card (and the box being typed in)
  // isn't rebuilt on every keypress.
  const entries = createMemo<Entry[]>((prev) => {
    const url = docUrl();
    if (!url) return [];
    const { documentId } = parseAutomergeUrl(url);
    const handles = patchHandles();
    const out: Entry[] = [];
    for (const link of [...links()].reverse()) {
      const handle = handles.get(link.url);
      const on = handle?.doc()?.on;
      if (!on || !isValidAutomergeUrl(on)) continue;
      if (parseAutomergeUrl(on).documentId !== documentId) continue;
      const laid = !link.off;
      const same = prev.find(
        (e) => e.link.url === link.url && e.laid === laid && e.handle === handle
      );
      out.push(same ?? { link, laid, handle: handle! });
    }
    return out;
  }, []);

  // The patch that the tree and Record write into.
  const [activeUrl, setActiveUrl] = createSignal<AutomergeUrl>();
  const active = () =>
    entries().find((e) => e.link.url === activeUrl()) ??
    entries().find((e) => e.laid);
  // Reading `patchHandles()` follows every patch doc's changes.
  const recording = () => (
    patchHandles(), entries().find((e) => e.laid && e.handle.doc()?.record)
  );
  const [opsUrl, setOpsUrl] = createSignal<AutomergeUrl>();

  const editFolder = (fn: (f: PatchFolder) => void) =>
    folderHandle()?.change((f) => {
      f.docs ??= [];
      fn(f);
    });

  const newPatch = () => {
    const target = baseHandle();
    if (!target) return undefined;
    const name = `Patch ${entries().length + 1}`;
    const patch = createPatch(root, target) as DocHandle<Titled>;
    patch.change((d) => {
      d.title = name;
    });
    editFolder((f) => f.docs.push({ name, type: "patch", url: patch.url }));
    setActiveUrl(patch.url);
    return patch;
  };

  const lay = (handle: DocHandle<Titled>) =>
    editFolder((f) => {
      const link = f.docs.find((l) => l.url === handle.url);
      if (link?.off) delete link.off;
    });

  const into = () => active()?.handle ?? newPatch();

  const addToPatch = (path: Path, value: unknown, remove: boolean) => {
    const handle = into();
    const target = baseHandle();
    if (!handle || !target) return;
    const at = target.heads();
    const next: PathPatch = remove
      ? { path, at }
      : { path, value: plain(value), at };
    handle.change((d) => {
      const i = d.patches.findIndex(
        (p) => isPathPatch(p) && samePath(p.path, path)
      );
      if (i >= 0) d.patches.splice(i, 1, next);
      else d.patches.push(next);
    });
    // Writing into a patch that's off is what turning it on means.
    lay(handle);
  };

  // The runs of a string that text entries add, as it's shown. The picker
  // selects in shown positions; these turn them into the document's own, or
  // into offsets in a patch's added text.
  const runsAt = (path: Path): PatchHighlight[] => {
    const h = shownHandle();
    if (!h) return [];
    return patchHighlights(h, path).filter((r) => !r.whole && r.base);
  };
  const toBase = (runs: PatchHighlight[], pos: number) => {
    let delta = 0;
    for (const r of runs) {
      if (pos <= r.start) break;
      delta = r.end - r.base!.end;
    }
    return pos - delta;
  };
  const touchesPatched = (path: Path, start: number, end: number) =>
    runsAt(path).some((r) => r.start < end && start < r.end) ||
    patchHighlights(shownHandle(), path).some((r) => r.whole);

  const addText = (path: Path, start: number, end: number) => {
    const handle = into();
    const target = baseHandle();
    if (!handle || !target || touchesPatched(path, start, end)) return;
    const runs = runsAt(path);
    const bs = toBase(runs, start);
    const be = toBase(runs, end);
    const text = String(readAt(target.doc(), path) ?? "");
    const entry = textPatch(target, path, bs, be, text.slice(bs, be));
    handle.change((d) => void d.patches.push(entry));
    lay(handle);
  };

  const addMark = (path: Path, start: number, end: number, name: string) => {
    const handle = into();
    const target = baseHandle();
    if (!handle || !target) return;
    const value = name === "highlight" ? "yellow" : true;
    const runs = runsAt(path).sort((a, b) => a.start - b.start);
    const marks: PatchEntry[] = [];
    let at = start;
    const own = (s: number, e: number) => {
      const bs = toBase(runs, s);
      const be = toBase(runs, e);
      if (be > bs) marks.push(markPatch(target, path, bs, be, name, value));
    };
    for (const r of runs) {
      if (at >= end) break;
      if (r.end <= at) continue;
      if (r.start > at) own(at, Math.min(r.start, end));
      const s = Math.max(at, r.start);
      const e = Math.min(end, r.end);
      if (e > s) {
        // Text a patch adds: the mark holds offsets into it, by its id.
        const id = idOf(r);
        if (id) {
          marks.push({
            path,
            at: target.heads(),
            mark: { name, value, within: id, start: s - r.start, end: e - r.start },
          });
        }
      }
      at = Math.max(at, r.end);
    }
    if (at < end) own(at, end);
    if (marks.length === 0) return;
    handle.change((d) => void d.patches.push(...marks));
    lay(handle);
  };

  // A text entry's id, giving it one if it was made before entries had ids.
  const idOf = (run: PatchHighlight): string | undefined => {
    if (run.id) return run.id;
    const owner = entries().find((e) => e.link.url === run.patch);
    if (!owner || run.index === undefined) return undefined;
    const id = Math.random().toString(36).slice(2, 10);
    owner.handle.change((d) => {
      const e = d.patches[run.index!];
      if (e && "text" in e) (e.text as { id?: string }).id = id;
    });
    return id;
  };

  // Take one entry out of a patch and put it in another (or a new one). It
  // keeps the heads it was measured from, so it's no more or less stale.
  const moveEntry = (from: Entry, index: number, to: AutomergeUrl | "new") => {
    const source = from.handle.doc();
    const entry = source?.patches[index];
    if (!source || !entry) return;
    const copy = plain(entry) as PatchEntry;
    copy.at ??= plain(source.at) as PatchEntry["at"];
    const target =
      to === "new" ? newPatch() : entries().find((e) => e.link.url === to)?.handle;
    if (!target || target === from.handle) return;
    target.change((d) => {
      const same =
        isPathPatch(copy) &&
        d.patches.findIndex((p) => isPathPatch(p) && samePath(p.path, copy.path));
      if (typeof same === "number" && same >= 0) d.patches.splice(same, 1, copy);
      else d.patches.push(copy);
    });
    from.handle.change((d) => void d.patches.splice(index, 1));
  };

  const toggle = (entry: Entry) => {
    // A patch switched off stops recording: it can't show what it records.
    if (entry.laid && entry.handle.doc()?.record) {
      entry.handle.change((d) => void delete d.record);
    }
    editFolder((f) => {
      const link = f.docs.find((l) => l.url === entry.link.url);
      if (!link) return;
      if (entry.laid) link.off = true;
      else delete link.off;
    });
  };

  // Marks on the text an entry added go with it.
  const dropMarksWithin = (ids: string[]) => {
    if (ids.length === 0) return;
    for (const e of entries()) {
      const doc = e.handle.doc();
      const doomed = (doc?.patches ?? [])
        .map((p, i) => [p, i] as const)
        .filter(([p]) => "mark" in p && ids.includes((p.mark as { within?: string }).within ?? ""))
        .map(([, i]) => i);
      if (doomed.length === 0) continue;
      e.handle.change((d) => {
        for (const i of doomed.reverse()) d.patches.splice(i, 1);
      });
    }
  };

  // Marks other patches put on a landed patch's text now mark the
  // document's own text there.
  const followLanded = (landed: Map<string, number>) => {
    const target = baseHandle();
    if (!target || landed.size === 0) return;
    for (const e of entries()) {
      const doc = e.handle.doc();
      const moves = (doc?.patches ?? []).flatMap((p, i) => {
        if (!("mark" in p)) return [];
        const m = p.mark as { within?: string; start?: number; end?: number; name: string; value: string | number | boolean | null };
        const at = m.within === undefined ? undefined : landed.get(m.within);
        if (at === undefined) return [];
        const entry = markPatch(target, [...p.path], at + (m.start ?? 0), at + (m.end ?? 0), m.name, m.value);
        return [[i, entry] as const];
      });
      if (moves.length === 0) continue;
      e.handle.change((d) => {
        for (const [i, entry] of moves) d.patches[i] = entry;
      });
    }
  };

  // Every entry on this document, in every patch: where a mark on another
  // patch's added text finds that text.
  const allEntries = () => (
    patchHandles(), entries().flatMap((e) => e.handle.doc()?.patches ?? [])
  );

  const remove = (entry: Entry) =>
    editFolder((f) => {
      const i = f.docs.findIndex((l) => l.url === entry.link.url);
      if (i >= 0) f.docs.splice(i, 1);
    });

  const rename = (entry: Entry, name: string) => {
    entry.handle.change((d) => {
      d.title = name;
    });
    editFolder((f) => {
      for (const link of f.docs) {
        if (link.url === entry.link.url) link.name = name;
      }
    });
  };

  // Put `url` at `to` in this document's stack (front first). The folder may
  // hold other documents' patches too: this document's keep their slots.
  const reorder = (url: AutomergeUrl, to: number) => {
    const order = entries().map((e) => e.link.url);
    const from = order.indexOf(url);
    if (from < 0 || to < 0 || to >= order.length || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, url);
    const backFirst = [...order].reverse();
    editFolder((f) => {
      const mine = new Set(backFirst);
      const slots: number[] = [];
      f.docs.forEach((l, i) => mine.has(l.url) && slots.push(i));
      const byUrl = new Map(
        f.docs.map((l) => [l.url, plain(l) as PatchLink] as const)
      );
      slots.forEach((slot, k) => {
        f.docs[slot] = byUrl.get(backFirst[k])!;
      });
    });
  };
  const [dragging, setDragging] = createSignal<AutomergeUrl>();

  const startRecording = () => {
    const handle = into();
    if (!handle) return;
    for (const e of entries()) {
      if (e.handle !== handle && e.handle.doc()?.record) {
        e.handle.change((d) => void delete d.record);
      }
    }
    handle.change((d) => {
      d.record = true;
    });
    lay(handle);
  };
  const stopRecording = () => {
    for (const e of entries()) {
      if (e.handle.doc()?.record) e.handle.change((d) => void delete d.record);
    }
  };

  const writeOps = () => {
    const handle = into();
    if (!handle) return;
    lay(handle);
    setOpsUrl(handle.url);
  };

  const covers = coverage(() => (patchHandles(), entries()));
  const frontUrl = () => entries().find((e) => e.laid)?.link.url;

  return (
    <div
      class="patches-panel"
      classList={{ "patches-panel--recording": !!recording() }}
    >
      <Show
        when={folderUrl()}
        fallback={
          <p class="patches-empty">
            Patch layers aren't laid here: there's no patch-layers provider
            above this panel.
          </p>
        }
      >
        <Show
          when={docUrl()}
          fallback={<p class="patches-empty">Open a document to patch it.</p>}
        >
          <header class="patches-header">
            <span class="patches-header-note">
              <Show
                when={recording()}
                fallback={
                  <Show when={entries().length}>front first · the top one wins</Show>
                }
              >
                {(r) => (
                  <span class="patches-recording" role="status">
                    <span class="patches-rec-dot" aria-hidden="true" />
                    recording into <strong>{nameOf(r())}</strong>
                  </span>
                )}
              </Show>
            </span>
            <Show
              when={recording()}
              fallback={
                <button type="button" class="patches-record" onClick={startRecording}>
                  <span class="patches-rec-dot" aria-hidden="true" />
                  Record
                </button>
              }
            >
              <button
                type="button"
                class="patches-record patches-record--on"
                aria-pressed="true"
                onClick={stopRecording}
              >
                <span class="patches-stop" aria-hidden="true" />
                Stop
              </button>
            </Show>
            <button
              type="button"
              class="patches-highlight"
              aria-pressed={!!folder()?.highlight}
              title="Highlight what the patches change, in the document"
              onClick={() =>
                editFolder((f) => {
                  if (f.highlight) delete f.highlight;
                  else f.highlight = true;
                })
              }
            >
              Highlight
            </button>
            <button type="button" onClick={() => newPatch()}>
              New patch
            </button>
          </header>

          <Show
            when={entries().length}
            fallback={
              <div class="patches-first">
                <div class="patches-first-art" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <strong>No patches on this document</strong>
                <p>
                  A patch changes what you see here without writing on the
                  document. Switch it off and the document is back as it was.
                </p>
                <div class="patches-first-actions">
                  <button type="button" class="patches-primary" onClick={startRecording}>
                    <span class="patches-rec-dot" aria-hidden="true" />
                    Record a patch
                  </button>
                  <button type="button" onClick={writeOps}>
                    Write ops
                  </button>
                </div>
                <p class="patches-hint">
                  Or pick a value below, or open a string and select some of
                  it.
                </p>
              </div>
            }
          >
            <ol class="patches-stack">
              <For each={entries()}>
                {(entry, i) => (
                  <PatchCard
                    entry={entry}
                    front={entry.link.url === frontUrl()}
                    active={active()?.handle === entry.handle}
                    ops={opsUrl() === entry.link.url}
                    base={base}
                    baseHandle={baseHandle}
                    patches={patchHandles}
                    allEntries={allEntries}
                    onDropText={dropMarksWithin}
                    onLanded={followLanded}
                    others={() =>
                      entries()
                        .filter((e) => e !== entry)
                        .map((e) => ({ url: e.link.url, name: nameOf(e) }))
                    }
                    onMoveEntry={(index, to) => moveEntry(entry, index, to)}
                    onSelect={() => setActiveUrl(entry.link.url)}
                    onToggle={() => toggle(entry)}
                    onRemove={() => remove(entry)}
                    onRename={(name) => rename(entry, name)}
                    onOps={(open) => setOpsUrl(open ? entry.link.url : undefined)}
                    onMove={(by) => reorder(entry.link.url, i() + by)}
                    onDragStart={() => setDragging(entry.link.url)}
                    onDrop={() => {
                      const from = dragging();
                      if (from) reorder(from, i());
                      setDragging(undefined);
                    }}
                  />
                )}
              </For>
            </ol>
          </Show>

          <section class="patches-fields">
            <div class="patches-fields-head">
              <span class="patches-section-label">Fields</span>
              <Show when={active()}>
                {(a) => (
                  <span class="patches-into">
                    click a value to patch it into{" "}
                    <span
                      class="patches-into-name"
                      style={{ background: colourOf(a().link.url).wash }}
                    >
                      {nameOf(a())}
                    </span>
                  </span>
                )}
              </Show>
            </div>
            <Show when={shown()} fallback={<p class="patches-empty">Loading…</p>}>
              <Fields
                value={shown()}
                base={base()}
                path={[]}
                coverage={covers}
                onPatch={(path, value) => addToPatch(path, value, false)}
                onHide={(path) => addToPatch(path, undefined, true)}
                onPatchText={addText}
                onMarkText={addMark}
                isPatched={touchesPatched}
              />
            </Show>
            <p class="patches-hint">
              A square in a patch's colour: that patch decides something there.
              Dashed: the patch is off.
            </p>
          </section>
        </Show>
      </Show>
    </div>
  );
}

function readAt(root: unknown, path: Path): unknown {
  let at: unknown = root;
  for (const k of path) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string | number, unknown>)[k];
  }
  return at;
}
