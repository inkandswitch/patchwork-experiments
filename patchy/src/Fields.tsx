import { createSignal, For, Show } from "solid-js";

import {
  colourOf,
  decides,
  isObject,
  isPrefix,
  nameOf,
  preview,
  type Entry,
  type Path,
} from "./util.js";

/** Which patches decide a path: the one that holds it, and any inside it. */
export type Coverage = (path: Path) => { at?: Entry; inside: Entry[] };

export type FieldsProps = {
  value: unknown;
  base: unknown;
  path: Path;
  coverage: Coverage;
  onPatch: (path: Path, value: unknown) => void;
  onHide: (path: Path) => void;
  onPatchText: (path: Path, start: number, end: number) => void;
  onMarkText: (path: Path, start: number, end: number, name: string) => void;
  /** Whether a shown run is (partly) text a patch already decides. */
  isPatched: (path: Path, start: number, end: number) => boolean;
};

export function Fields(props: FieldsProps) {
  const keys = () => {
    const v = props.value;
    if (Array.isArray(v)) return v.map((_, i) => i);
    if (isObject(v)) return Object.keys(v);
    return [];
  };
  return (
    <ul class="patches-tree">
      <For each={keys()}>
        {(key) => (
          <Field
            {...props}
            name={key}
            value={(props.value as Record<string | number, unknown>)?.[key]}
            base={(props.base as Record<string | number, unknown>)?.[key]}
            path={[...props.path, key]}
          />
        )}
      </For>
    </ul>
  );
}

// Lists of short scalars (a row of pixels, a palette) read better as cells.
function isCells(v: unknown): v is unknown[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.length <= 64 &&
    v.every(
      (x) =>
        x === null ||
        typeof x === "number" ||
        typeof x === "boolean" ||
        (typeof x === "string" && x.length <= 8)
    )
  );
}

function Square(props: { entry: Entry; inside?: boolean }) {
  return (
    <span
      class="patches-square"
      classList={{
        "patches-square--off": !props.entry.laid,
        "patches-square--inside": props.inside,
      }}
      style={{ "--patch": colourOf(props.entry.link.url).fill }}
      title={`${props.inside ? "Inside: " : ""}${nameOf(props.entry)}${props.entry.laid ? "" : " (off)"}`}
    />
  );
}

function Field(props: FieldsProps & { name: string | number }) {
  const [open, setOpen] = createSignal(false);
  const container = () => Array.isArray(props.value) || isObject(props.value);
  const text = () => typeof props.value === "string";
  const expandable = () => container() || text();
  const cover = () => props.coverage(props.path);
  const at = () => cover().at;
  const wash = () => {
    const a = at();
    return a?.laid ? colourOf(a.link.url).wash : undefined;
  };

  return (
    <li>
      <div class="patches-row">
        <button
          type="button"
          class="patches-twist"
          disabled={!expandable()}
          aria-label={expandable() ? (open() ? "Close" : "Open") : undefined}
          aria-expanded={expandable() ? open() : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          {expandable() ? (open() ? "▾" : "▸") : ""}
        </button>
        <span class="patches-key">{String(props.name)}</span>
        <span
          class="patches-preview"
          classList={{ "patches-preview--covered": !!wash() }}
          style={wash() ? { background: wash() } : undefined}
        >
          {preview(props.value)}
        </span>
        <Show when={at()}>{(a) => <Square entry={a()} />}</Show>
        <Show when={!at() && cover().inside[0]}>
          {(e) => <Square entry={e()} inside />}
        </Show>
        <span class="patches-row-actions">
          <button
            type="button"
            title="Patch this value: edits to it go into the patch"
            onClick={() => props.onPatch(props.path, props.value)}
          >
            Patch
          </button>
          <button
            type="button"
            title="Patch this value out"
            onClick={() => props.onHide(props.path)}
          >
            Hide
          </button>
        </span>
      </div>
      <Show when={open()}>
        <Show when={isCells(props.value)} fallback={
          <Show when={text()} fallback={
            <Show when={container()}>
              <Fields {...props} />
            </Show>
          }>
            <TextPicker
              text={String(props.value)}
              onPatch={(s, e) => props.onPatchText(props.path, s, e)}
              onMark={(s, e, name) => props.onMarkText(props.path, s, e, name)}
              isPatched={(s, e) => props.isPatched(props.path, s, e)}
            />
          </Show>
        }>
          <Cells {...props} />
        </Show>
      </Show>
    </li>
  );
}

function Cells(props: FieldsProps) {
  const cells = () => props.value as unknown[];
  return (
    <div
      class="patches-cells"
      style={{ "--cols": String(Math.min(cells().length, 8)) }}
    >
      <For each={cells()}>
        {(cell, i) => {
          const path = () => [...props.path, i()];
          const at = () => props.coverage(path()).at;
          return (
            <button
              type="button"
              class="patches-cell"
              classList={{ "patches-cell--covered": !!at()?.laid }}
              style={
                at()?.laid
                  ? {
                      "--patch": colourOf(at()!.link.url).fill,
                      "--patch-wash": colourOf(at()!.link.url).wash,
                    }
                  : undefined
              }
              title={`Patch ${String(props.path.at(-1))}[${i()}]`}
              onClick={() => props.onPatch(path(), cell)}
            >
              {String(cell)}
            </button>
          );
        }}
      </For>
    </div>
  );
}

// The string as shown, patches and all, to select a run of: patch it (the
// document's own text), or mark it (either).
function TextPicker(props: {
  text: string;
  onPatch: (start: number, end: number) => void;
  onMark: (start: number, end: number, name: string) => void;
  isPatched: (start: number, end: number) => boolean;
}) {
  let box!: HTMLTextAreaElement;
  const [sel, setSel] = createSignal<[number, number]>([0, 0]);
  const [name, setName] = createSignal("strong");
  const read = () => setSel([box.selectionStart, box.selectionEnd]);
  const some = () => sel()[1] > sel()[0];
  return (
    <div class="patches-picker">
      <textarea
        ref={box}
        readOnly
        class="patches-picker-text"
        value={props.text}
        aria-label="The document's text: select a run to patch or mark"
        onSelect={read}
        onKeyUp={read}
        onMouseUp={read}
      />
      <div class="patches-picker-actions">
        <button
          type="button"
          disabled={!some() || props.isPatched(...sel())}
          title={
            some() && props.isPatched(...sel())
              ? "A patch already decides some of this: edit it in its card"
              : undefined
          }
          onClick={() => props.onPatch(...sel())}
        >
          Patch selection
        </button>
        <button
          type="button"
          disabled={!some()}
          onClick={() => props.onMark(sel()[0], sel()[1], name())}
        >
          Mark
        </button>
        <select
          aria-label="Mark"
          value={name()}
          onChange={(e) => setName(e.currentTarget.value)}
        >
          <option value="strong">strong</option>
          <option value="em">em</option>
          <option value="code">code</option>
          <option value="highlight">highlight</option>
        </select>
      </div>
    </div>
  );
}

/** Coverage over a set of entries: who holds each path, who's inside it. */
export function coverage(entries: () => Entry[]): Coverage {
  return (path) => {
    let at: Entry | undefined;
    const inside: Entry[] = [];
    for (const e of entries()) {
      for (const p of e.handle.doc()?.patches ?? []) {
        if (decides(p, path)) {
          // Front first, so the first laid one is the one that shows.
          if (!at || (!at.laid && e.laid)) at = e;
        } else if (isPrefix(path, p.path) && !inside.includes(e)) {
          inside.push(e);
        }
      }
    }
    inside.sort((a, b) => Number(b.laid) - Number(a.laid));
    return { at, inside };
  };
}
