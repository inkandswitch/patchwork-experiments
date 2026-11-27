import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  Show,
  Switch,
  type Accessor,
} from "solid-js";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo/slim";
import {
  fromAutomergePatches,
  isPathPatch,
  isRunPatch,
  isTextPatch,
  landPatch,
  readEntry,
  type AutomergeOp,
  type EntryReading,
  type PatchEntry,
} from "./layers/index.js";

import {
  colourOf,
  formatOps,
  formatPath,
  KIND_LABEL,
  kindOf,
  nameOf,
  putOf,
  show,
  toOps,
  type Entry,
} from "./util.js";

export type CardProps = {
  entry: Entry;
  front: boolean;
  active: boolean;
  ops: boolean;
  base: Accessor<unknown>;
  baseHandle: Accessor<DocHandle<unknown> | undefined>;
  /** Changes whenever any patch doc does. */
  patches: Accessor<unknown>;
  /** Every entry on this document, in every patch. */
  allEntries: Accessor<PatchEntry[]>;
  /** Text entries with these ids are gone: their marks should go too. */
  onDropText: (ids: string[]) => void;
  /** This patch landed; its text entries' text now starts at these. */
  onLanded: (landed: Map<string, number>) => void;
  /** This document's other patches, which an entry can be moved into. */
  others: Accessor<{ url: AutomergeUrl; name: string }[]>;
  onMoveEntry: (index: number, to: AutomergeUrl | "new") => void;
  onSelect: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onOps: (open: boolean) => void;
  onMove: (by: number) => void;
  onDragStart: () => void;
  onDrop: () => void;
};

export function PatchCard(props: CardProps) {
  const colour = () => colourOf(props.entry.link.url);
  // Read through the base doc and the patch docs, so readings follow both.
  const doc = () => (props.base(), props.patches(), props.entry.handle.doc());
  const readings = createMemo(() => {
    const target = props.baseHandle();
    const d = doc();
    if (!target || !d) return [];
    // A mark on added text may be on another patch's: look in all of them.
    const everywhere = { at: d.at, patches: props.allEntries() };
    return d.patches.map((e) =>
      readEntry(target, "mark" in e && e.mark?.within ? everywhere : d, e)
    );
  });
  const staleCount = () => readings().filter((r) => r.stale).length;
  const [open, setOpen] = createSignal(true);
  const [over, setOver] = createSignal(false);
  const expanded = () => props.entry.laid && open();

  const change = (fn: (d: PatchEntry[]) => void) =>
    props.entry.handle.change((d) => fn(d.patches));
  const keep = (i: number) => {
    const target = props.baseHandle();
    if (!target) return;
    const heads = target.heads();
    change((ps) => {
      if (ps[i]) ps[i].at = heads;
    });
  };
  const drop = (i: number) => {
    const entry = props.entry.handle.doc()?.patches[i];
    change((ps) => void ps.splice(i, 1));
    if (entry && isTextPatch(entry) && entry.text.id) props.onDropText([entry.text.id]);
  };
  const reanchor = () => {
    const target = props.baseHandle();
    if (!target) return;
    const heads = target.heads();
    props.entry.handle.change((d) => {
      d.at = heads;
      for (const p of d.patches) p.at = heads;
    });
  };

  return (
    <li
      class="patches-card"
      classList={{
        "patches-card--active": props.active,
        "patches-card--off": !props.entry.laid,
        "patches-card--over": over(),
      }}
      style={{
        "--patch": colour().fill,
        "--patch-ink": colour().ink,
        "--patch-wash": colour().wash,
      }}
      onClick={props.onSelect}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        props.onDrop();
      }}
    >
      <Show when={props.front && props.entry.laid}>
        <span class="patches-flag">front: a read takes this</span>
      </Show>
      <Show when={staleCount() && props.entry.laid}>
        <span class="patches-flag patches-flag--stale">stale</span>
      </Show>

      <div class="patches-card-head">
        <button
          type="button"
          class="patches-grip"
          draggable={true}
          aria-label={`Move ${nameOf(props.entry)}: drag, or use the arrow keys`}
          onDragStart={(e) => {
            e.dataTransfer?.setData("text/plain", props.entry.link.url);
            props.onDragStart();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") props.onMove(-1);
            else if (e.key === "ArrowDown") props.onMove(1);
            else return;
            e.preventDefault();
          }}
        >
          <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true">
            <circle cx="2" cy="2" r="1.2" />
            <circle cx="6" cy="2" r="1.2" />
            <circle cx="2" cy="7" r="1.2" />
            <circle cx="6" cy="7" r="1.2" />
            <circle cx="2" cy="12" r="1.2" />
            <circle cx="6" cy="12" r="1.2" />
          </svg>
        </button>
        <label class="patches-check">
          <input
            type="checkbox"
            checked={props.entry.laid}
            aria-label={`${nameOf(props.entry)} is ${props.entry.laid ? "on" : "off"}`}
            onClick={(e) => e.stopPropagation()}
            onChange={props.onToggle}
          />
        </label>
        <span class="patches-swatch" aria-hidden="true" />
        <Show
          when={props.entry.laid}
          fallback={
            <span class="patches-off-name">
              <strong>{nameOf(props.entry)}</strong>
              <span>
                off: kept here, not laid ·{" "}
                {(doc()?.patches ?? []).map((p) => formatPath(p.path)).join(", ") ||
                  "empty"}
              </span>
            </span>
          }
        >
          <input
            class="patches-title"
            aria-label="Patch name"
            value={nameOf(props.entry)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => props.onRename(e.currentTarget.value)}
          />
          <Show when={doc()?.record}>
            <span class="patches-rec" title="Recording into this patch">
              <span class="patches-rec-dot" />
              rec
            </span>
          </Show>
          <div class="patches-tabs" role="tablist" aria-label="Show this patch as">
            <button
              type="button"
              role="tab"
              aria-selected={!props.ops}
              onClick={(e) => {
                e.stopPropagation();
                props.onOps(false);
              }}
            >
              Fields
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={props.ops}
              onClick={(e) => {
                e.stopPropagation();
                props.onOps(true);
              }}
            >
              Ops
            </button>
          </div>
        </Show>
        <Show when={!props.entry.laid}>
          <button
            type="button"
            class="patches-icon"
            aria-label={open() ? "Hide its entries" : "Show its entries"}
            aria-expanded={open()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open() ? "▾" : "▸"}
          </button>
          <button
            type="button"
            class="patches-remove-off"
            title="Take this patch out of your patches folder"
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove();
            }}
          >
            Remove
          </button>
        </Show>
      </div>

      <Show when={props.entry.laid || open()}>
        <Show
          when={!props.ops || !props.entry.laid}
          fallback={
            <OpsEditor
              entry={props.entry}
              baseHandle={props.baseHandle}
              onDone={() => props.onOps(false)}
            />
          }
        >
          <Show when={staleCount() && expanded()}>
            <p class="patches-note">
              The document has changed since this was made:{" "}
              {staleCount() === 1
                ? "1 of the things it changes has"
                : `${staleCount()} of the things it changes have`}{" "}
              been changed there too.
            </p>
          </Show>

          <Show
            when={doc()?.patches.length}
            fallback={
              <p class="patches-card-empty">
                <Show
                  when={doc()?.landedAt}
                  fallback="Empty. Pick a value below, select some text, or record."
                >
                  Landed on the document.
                </Show>
              </p>
            }
          >
            <ul class="patches-entries">
              {/* By position: each change hands back new objects, and a row
                  keyed by those would be rebuilt (losing focus) on every
                  keypress. */}
              <Index each={doc()?.patches ?? []}>
                {(p, i) => (
                  <EntryRow
                    entry={p()}
                    reading={readings()[i]}
                    onValue={(v) =>
                      change((ps) => {
                        const e = ps[i];
                        if (e && isRunPatch(e)) {
                          if (Array.isArray(v)) e.values = v;
                        } else if (e && isPathPatch(e)) e.value = v;
                      })
                    }
                    onInsert={(text) =>
                      change((ps) => {
                        const e = ps[i];
                        if (e && isTextPatch(e)) e.text.insert = text;
                      })
                    }
                    onKeep={() => keep(i)}
                    onDrop={() => drop(i)}
                    targets={props.others()}
                    onMoveTo={(to) => props.onMoveEntry(i, to)}
                  />
                )}
              </Index>
            </ul>
          </Show>

          <Show when={props.entry.laid}>
            <div class="patches-actions">
              <Show when={doc()?.patches.length}>
                <button
                  type="button"
                  class="patches-land"
                  title="Write this patch onto the document for real, and empty it"
                  onClick={(e) => {
                    e.stopPropagation();
                    const target = props.baseHandle();
                    if (target) props.onLanded(landPatch(target, props.entry.handle));
                  }}
                >
                  Land
                </button>
              </Show>
              <Show when={staleCount()}>
                <button
                  type="button"
                  title="Keep everything this patch says, and measure it from the document as it is now"
                  onClick={(e) => {
                    e.stopPropagation();
                    reanchor();
                  }}
                >
                  Re-anchor to now
                </button>
              </Show>
              <button
                type="button"
                class="patches-quiet"
                title="Take this patch out of your patches folder"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove();
                }}
              >
                Remove
              </button>
            </div>
          </Show>
        </Show>
      </Show>
    </li>
  );
}

function EntryRow(props: {
  entry: PatchEntry;
  reading: EntryReading | undefined;
  onValue: (v: unknown) => void;
  onInsert: (text: string) => void;
  onKeep: () => void;
  onDrop: () => void;
  targets: { url: AutomergeUrl; name: string }[];
  onMoveTo: (to: AutomergeUrl | "new") => void;
}) {
  const kind = () => kindOf(props.entry);
  const r = () => props.reading;
  const value = () => putOf(props.entry);
  const insert = () =>
    isTextPatch(props.entry) ? String(props.entry.text.insert) : "";
  const markName = () =>
    "mark" in props.entry ? (props.entry as { mark: { name: string } }).mark.name : "";
  const differs = () => JSON.stringify(r()?.now) !== JSON.stringify(value());

  return (
    <li class="patches-entry" classList={{ "patches-entry--stale": !!r()?.stale }}>
      <div class="patches-entry-head">
        <Show when={kind() === "remove" || kind() === "mark" || kind() === "unmark"}>
          <span class={`patches-kind patches-kind--${kind()}`}>
            {KIND_LABEL[kind()]}
            {kind() === "mark" || kind() === "unmark" ? ` ${markName()}` : ""}
          </span>
        </Show>
        <Path
          path={props.entry.path}
          span={isRunPatch(props.entry) ? props.entry.values.length : undefined}
        />
        <Show when={r()?.stale}>
          <span class="patches-changed">changed under it</span>
        </Show>
        <select
          class="patches-move"
          aria-label={`Move ${formatPath(props.entry.path)} to another patch`}
          title="Move this to another patch"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const to = e.currentTarget.value;
            e.currentTarget.value = "";
            if (to) props.onMoveTo(to as AutomergeUrl | "new");
          }}
        >
          <option value="">Move…</option>
          <For each={props.targets}>
            {(t) => <option value={t.url}>{t.name}</option>}
          </For>
          <option value="new">New patch</option>
        </select>
        <button
          type="button"
          class="patches-icon"
          aria-label={`Stop patching ${formatPath(props.entry.path)}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onDrop();
          }}
        >
          ×
        </button>
      </div>

      <Switch>
        <Match when={kind() === "put" || kind() === "run"}>
          <div class="patches-stackvalue">
            <ValueEditor value={value()} onSave={props.onValue} />
            <Show when={differs()}>
              <div class="patches-under">
                <s>{show(r()?.now)}</s>
                <span>the document, underneath</span>
              </div>
            </Show>
          </div>
        </Match>
        <Match when={kind() === "remove"}>
          <div class="patches-stackvalue">
            <div class="patches-hidden">hidden</div>
            <Show when={r()?.now !== undefined}>
              <div class="patches-under">
                <s>{show(r()?.now)}</s>
                <span>the document, underneath</span>
              </div>
            </Show>
          </div>
        </Match>
        <Match when={kind() === "text" || kind() === "insert"}>
          <div class="patches-snippet">
            <Show when={r()?.before}>
              <span class="patches-ctx">
                {flat(r()!.before!).length > 12 ? "…" : ""}
                {flat(r()!.before!).slice(-12)}
              </span>
            </Show>
            <Show when={r()?.now}>
              <s>{String(r()!.now)}</s>
            </Show>
            <InlineText
              value={insert()}
              label={`New text for ${formatPath(props.entry.path)}`}
              onSave={props.onInsert}
            />
            <Show when={r()?.after}>
              <span class="patches-ctx">
                {flat(r()!.after!).slice(0, 12)}
                {flat(r()!.after!).length > 12 ? "…" : ""}
              </span>
            </Show>
          </div>
        </Match>
        <Match when={kind() === "mark" || kind() === "unmark"}>
          <div class="patches-snippet">
            <Show when={r()?.before}>
              <span class="patches-ctx">…{flat(r()!.before!).slice(-18)}</span>
            </Show>
            <span
              class="patches-marked"
              classList={{ "patches-marked--off": kind() === "unmark" }}
              data-mark={markName()}
            >
              {String(r()?.now ?? "")}
            </span>
            <Show when={r()?.after}>
              <span class="patches-ctx">{flat(r()!.after!).slice(0, 18)}…</span>
            </Show>
          </div>
        </Match>
      </Switch>

      <Show when={r()?.stale}>
        <StaleTable entry={props.entry} reading={r()!} />
        <div class="patches-stale-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onKeep();
            }}
          >
            Keep this
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onDrop();
            }}
          >
            Take the document's
          </button>
        </div>
      </Show>
    </li>
  );
}

function StaleTable(props: { entry: PatchEntry; reading: EntryReading }) {
  const shown = () =>
    isTextPatch(props.entry)
      ? props.entry.text.insert
      : "mark" in props.entry
        ? props.reading.now
        : putOf(props.entry);
  return (
    <table class="patches-diff">
      <thead>
        <tr>
          <th scope="col">it changed</th>
          <th scope="col">the document has now</th>
          <th scope="col">a read gets</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <s>{show(props.reading.then)}</s>
          </td>
          <td class="patches-diff-now">{show(props.reading.now) || "deleted"}</td>
          <td>
            <span class="patches-wash">{show(shown())}</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// Context either side of a run, on one line.
const flat = (text: string) => text.replace(/\s+/g, " ");

// The replacing text, typed in place in the line it changes. Like
// ValueEditor, it's the user's while it has focus.
function InlineText(props: {
  value: string;
  label: string;
  onSave: (text: string) => void;
}) {
  let box!: HTMLInputElement;
  let editing = false;
  createEffect(() => {
    const v = props.value;
    if (!editing) box.value = v;
  });
  return (
    <input
      ref={box}
      class="patches-inline"
      aria-label={props.label}
      spellcheck={false}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => (editing = true)}
      onBlur={() => {
        editing = false;
        box.value = props.value;
      }}
      onInput={(e) => props.onSave(e.currentTarget.value)}
    />
  );
}

export function Path(props: { path: readonly (string | number)[]; span?: number }) {
  const head = () => formatPath(props.path.slice(0, -1));
  const last = () => {
    const k = props.path[props.path.length - 1];
    if (k === undefined) return "";
    // A run: the items it puts, first to last.
    if (typeof k === "number" && props.span && props.span > 1) {
      return `[${k}–${k + props.span - 1}]`;
    }
    return typeof k === "number" ? `[${k}]` : props.path.length > 1 ? `.${k}` : k;
  };
  return (
    <code class="patches-path">
      {head()}
      <b>{last()}</b>
    </code>
  );
}

// Strings are edited as text; anything else as JSON. Saves on every keypress
// that leaves valid JSON. While it has focus the box is the user's: changes
// coming back don't rewrite it (that would re-format JSON under the cursor),
// and a JSON value typed into a string doesn't switch it to text.
export function ValueEditor(props: {
  value: unknown;
  onSave: (v: unknown) => void;
}) {
  let box!: HTMLTextAreaElement;
  let editing = false;
  let asText = typeof props.value === "string";
  const [bad, setBad] = createSignal(false);
  const fill = (v: unknown) => {
    asText = typeof v === "string";
    box.value = asText ? (v as string) : JSON.stringify(v);
    setBad(false);
  };
  createEffect(() => {
    const v = props.value;
    if (!editing) fill(v);
  });
  return (
    <textarea
      ref={box}
      class="patches-value"
      classList={{ "patches-value--bad": bad() }}
      rows={1}
      spellcheck={false}
      onClick={(e) => e.stopPropagation()}
      onFocus={() => (editing = true)}
      onBlur={() => {
        editing = false;
        fill(props.value);
      }}
      onInput={(e) => {
        const raw = e.currentTarget.value;
        if (asText) return props.onSave(raw);
        try {
          props.onSave(JSON.parse(raw));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

// The patch as Automerge ops, edited as JSON. What it would keep, and why it
// wouldn't keep the rest, shows as you type; Save replaces the patch's entries.
function OpsEditor(props: {
  entry: Entry;
  baseHandle: Accessor<DocHandle<unknown> | undefined>;
  onDone: () => void;
}) {
  const target = props.baseHandle();
  const patch = props.entry.handle.doc();
  const [text, setText] = createSignal(
    target && patch ? formatOps(toOps(target, patch)) : "[\n]"
  );
  const parsed = createMemo(() => {
    const t = props.baseHandle();
    if (!t) return { entries: [], errors: [], syntax: "no document" };
    let ops: AutomergeOp[];
    try {
      const value = JSON.parse(text());
      if (!Array.isArray(value)) throw new Error("expected a list of ops: [ … ]");
      ops = value;
    } catch (err) {
      return {
        entries: [],
        errors: [],
        syntax: err instanceof Error ? err.message : String(err),
        count: 0,
      };
    }
    const { entries, errors } = fromAutomergePatches(t, ops);
    return { entries, errors, syntax: undefined, count: ops.length };
  });
  const save = () => {
    const t = props.baseHandle();
    const p = parsed();
    if (!t || p.syntax) return;
    const heads = t.heads();
    props.entry.handle.change((d) => {
      d.at = heads;
      d.patches.splice(0, d.patches.length, ...(JSON.parse(JSON.stringify(p.entries)) as PatchEntry[]));
    });
    props.onDone();
  };

  return (
    <div class="patches-ops" onClick={(e) => e.stopPropagation()}>
      <p class="patches-hint">
        Automerge patches, as <code>A.applyPatches</code> takes them, one after
        another. Indexes count against the document as it is now.
      </p>
      <label class="patches-sr" for={`ops-${props.entry.link.url}`}>
        Patch ops
      </label>
      <textarea
        id={`ops-${props.entry.link.url}`}
        class="patches-ops-text"
        spellcheck={false}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      />
      <Show when={parsed().syntax}>
        <div class="patches-error" role="alert">
          <b>not JSON</b> · {parsed().syntax}
        </div>
      </Show>
      <For each={parsed().errors}>
        {(err) => (
          <div class="patches-error" role="alert">
            <b>{err.code}</b> · op {err.index + 1}: {err.message}
          </div>
        )}
      </For>

      <Show when={!parsed().syntax}>
        <div class="patches-kept">
          <span class="patches-section-label">Kept as</span>
          <Show
            when={parsed().entries.length}
            fallback={<p class="patches-card-empty">Nothing yet.</p>}
          >
            <For each={parsed().entries}>
              {(e) => <Slip entry={e} baseHandle={props.baseHandle} />}
            </For>
          </Show>
        </div>
      </Show>

      <div class="patches-actions">
        <button
          type="button"
          class="patches-save"
          disabled={!!parsed().syntax}
          onClick={save}
        >
          Save
          {parsed().errors.length
            ? `, leaving out ${parsed().errors.length} op${parsed().errors.length === 1 ? "" : "s"}`
            : ""}
        </button>
        <button type="button" onClick={props.onDone}>
          Cancel
        </button>
        <span class="patches-kbd">⌘↵ saves</span>
      </div>
    </div>
  );
}

function Slip(props: {
  entry: PatchEntry;
  baseHandle: Accessor<DocHandle<unknown> | undefined>;
}) {
  const kind = () => kindOf(props.entry);
  const reading = () => {
    const t = props.baseHandle();
    return t ? readEntry(t, { at: t.heads() }, props.entry) : undefined;
  };
  return (
    <div class={`patches-slip patches-slip--${kind()}`}>
      <div class="patches-slip-head">
        <b>{KIND_LABEL[kind()]}</b>
        <code>{formatPath(props.entry.path)}</code>
      </div>
      <Switch>
        <Match when={kind() === "put" || kind() === "run"}>
          <code>{show(putOf(props.entry))}</code>
        </Match>
        <Match when={kind() === "text" || kind() === "insert"}>
          <span>
            <Show when={reading()?.now}>
              <s>{String(reading()!.now)}</s> →{" "}
            </Show>
            <span class="patches-wash">
              {isTextPatch(props.entry) ? props.entry.text.insert : ""}
            </span>
          </span>
        </Match>
        <Match when={kind() === "mark" || kind() === "unmark"}>
          <span class="patches-marked">{String(reading()?.now ?? "")}</span>
        </Match>
      </Switch>
    </div>
  );
}
