import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Index, Show, createMemo, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import type { Sticker } from "@embark/stickers";
import type { TodoDoc, TodoItem } from "./datatype";
import {
  groupByItem,
  useItemStickers,
  type InlineSticker,
  type ItemStickerGroup,
} from "./stickers";
import "./todo.css";

// A todo list that is also a sticker *surface*. Each item is a sticker target:
// whatever the canvas's sticker broker reports for this document is drawn
// around the matching item (before / after / replace slots, plus `style`) or
// inline at a sub-range of the item's text. Inline stickers show only in read
// mode — while an item's text is being edited, the raw text is shown so it can
// be edited cleanly.
export const TodoTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Todo handle={handle as DocHandle<TodoDoc>} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

const EMPTY_GROUP: ItemStickerGroup = {
  whole: { before: [], after: [], replace: null, styles: {} },
  inline: [],
};

function Todo(props: { handle: DocHandle<TodoDoc>; element: ToolElement }) {
  const [doc] = useDocument<TodoDoc>(() => props.handle.url);
  const items = () => doc()?.items ?? [];
  const resolved = useItemStickers(props.element, props.handle.url);

  // Recompute on every doc change too: `groupByItem` reads each target handle's
  // live path / range, which shift as items are edited or reordered.
  const groups = createMemo(() => groupByItem(items(), resolved()));
  const groupFor = (id: string) => groups().get(id) ?? EMPTY_GROUP;

  const [editingId, setEditingId] = createSignal<string | null>(null);

  // Append a blank item and start editing it — the bottom "New To-Do" row.
  const addItem = () => {
    const id = crypto.randomUUID();
    props.handle.change((d) => {
      d.items.push({ id, text: "", done: false });
    });
    setEditingId(id);
  };

  // Enter while editing: a written item spawns a fresh sibling below and moves
  // the caret onto it (Things' "keep typing to keep adding"); a blank item ends
  // the run and is discarded so no empty rows pile up.
  const advance = (item: () => TodoItem, index: number) => {
    if (item().text.trim() === "") {
      discardEmpty(index);
      return;
    }
    const id = crypto.randomUUID();
    props.handle.change((d) => {
      d.items.splice(index + 1, 0, { id, text: "", done: false });
    });
    setEditingId(id);
  };

  // Blur ends editing. Ignore the blur that fires as focus advances onto a
  // freshly spawned row (editing has already moved on). A row left blank is
  // discarded, the way Things drops an abandoned new to-do.
  const stopEditing = (item: () => TodoItem, index: number) => {
    if (editingId() !== item().id) return;
    if (item().text.trim() === "") discardEmpty(index);
    else setEditingId(null);
  };

  const discardEmpty = (index: number) => {
    props.handle.change((d) => {
      const item = d.items[index];
      if (item && item.text.trim() === "") d.items.splice(index, 1);
    });
    setEditingId(null);
  };

  return (
    <div class="embark-todo">
      <Index each={items()}>
        {(item, index) => (
          <TodoRow
            handle={props.handle}
            item={item}
            index={index}
            group={() => groupFor(item().id)}
            editing={() => editingId() === item().id}
            onEdit={() => setEditingId(item().id)}
            onEnter={() => advance(item, index)}
            onBlur={() => stopEditing(item, index)}
          />
        )}
      </Index>
      <button type="button" class="embark-todo__add" on:click={addItem}>
        <span class="embark-todo__add-icon" aria-hidden="true">+</span>
        <span class="embark-todo__add-label">New To-Do</span>
      </button>
    </div>
  );
}

function TodoRow(props: {
  handle: DocHandle<TodoDoc>;
  item: () => TodoItem;
  index: number;
  group: () => ItemStickerGroup;
  editing: () => boolean;
  onEdit: () => void;
  onEnter: () => void;
  onBlur: () => void;
}) {
  const whole = () => props.group().whole;

  const toggle = () => {
    props.handle.change((d) => {
      const item = d.items[props.index];
      if (item) item.done = !item.done;
    });
  };

  const remove = () => {
    props.handle.change((d) => {
      d.items.splice(props.index, 1);
    });
  };

  const writeText = (value: string) => {
    props.handle.change((d) => {
      const item = d.items[props.index];
      if (item) item.text = value;
    });
  };

  return (
    <div class="embark-todo__row" classList={{ "embark-todo__row--done": props.item().done }}>
      <input
        type="checkbox"
        class="embark-todo__checkbox"
        checked={props.item().done}
        on:change={toggle}
      />
      <For each={whole().before}>
        {(sticker) => <span class="embark-todo__slot">{stickerNode(sticker)}</span>}
      </For>
      <Show
        when={props.editing()}
        fallback={
          <span
            class="embark-todo__text"
            style={cssText(whole().styles)}
            title="Click to edit"
            on:click={props.onEdit}
          >
            <ReadText item={props.item} group={props.group} />
          </span>
        }
      >
        <input
          class="embark-todo__input"
          ref={(el) => {
            el.value = props.item().text;
            queueMicrotask(() => el.focus());
          }}
          placeholder="New To-Do"
          on:input={(event) => writeText(event.currentTarget.value)}
          on:blur={props.onBlur}
          on:keydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onEnter();
            }
          }}
        />
      </Show>
      <For each={whole().after}>
        {(sticker) => <span class="embark-todo__slot">{stickerNode(sticker)}</span>}
      </For>
      <Show when={!props.editing()}>
        <button
          type="button"
          class="embark-todo__delete"
          title="Remove item"
          aria-label="Remove item"
          on:click={remove}
        >
          ×
        </button>
      </Show>
    </div>
  );
}

// The item's text in read mode: a whole-item `replace` sticker stands in for
// the text entirely; otherwise the text is rendered with any inline stickers
// spliced in at their ranges.
function ReadText(props: { item: () => TodoItem; group: () => ItemStickerGroup }) {
  const replace = () => props.group().whole.replace;
  return (
    <Show
      when={replace()}
      fallback={<>{renderInline(props.item().text, props.group().inline)}</>}
    >
      {(sticker) => <>{stickerNode(sticker())}</>}
    </Show>
  );
}

// Splice inline stickers into the item's text. Walks the (from-sorted) ranges
// left to right: `before`/`after` widgets insert at a point, `replace` swaps a
// span for a widget, `style` wraps a span. Mirrors the markdown renderer's
// per-decoration placement; overlaps degrade gracefully (rendered in order,
// clamped to the text length) rather than throwing.
function renderInline(text: string, inline: InlineSticker[]): JSX.Element {
  if (inline.length === 0) return text;
  const nodes: JSX.Element[] = [];
  let cursor = 0;

  const flushTo = (position: number) => {
    const end = clamp(position, text.length);
    if (end > cursor) {
      nodes.push(text.slice(cursor, end));
      cursor = end;
    }
  };

  for (const { from, to, sticker } of inline) {
    const start = clamp(from, text.length);
    const stop = clamp(to, text.length);
    if (sticker.type === "style") {
      flushTo(start);
      const segment = text.slice(cursor, Math.max(cursor, stop));
      nodes.push(<span style={cssText(sticker.styles)}>{segment}</span>);
      cursor = Math.max(cursor, stop);
      continue;
    }
    if (sticker.slot === "replace") {
      flushTo(start);
      nodes.push(stickerNode(sticker));
      cursor = Math.max(cursor, stop);
      continue;
    }
    if (sticker.slot === "before") {
      flushTo(start);
      nodes.push(stickerNode(sticker));
      continue;
    }
    flushTo(stop);
    nodes.push(stickerNode(sticker));
  }
  flushTo(text.length);
  return nodes;
}

// Render a non-style sticker as a node: `text` as a chip, `tool` as an embedded
// patchwork view (mirroring the markdown renderer's widgets). `style` carries
// no node — it decorates text via `cssText` — so it renders nothing here.
function stickerNode(sticker: Sticker): JSX.Element {
  if (sticker.type === "text") {
    return <span class="embark-todo__sticker">{sticker.text}</span>;
  }
  if (sticker.type === "tool") {
    return (
      <span class="embark-todo__tool">
        <patchwork-view doc-url={sticker.docUrl} tool-id={sticker.toolId} />
      </span>
    );
  }
  return null;
}

function cssText(styles: Record<string, string>): string {
  return Object.entries(styles)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(value, max));
}
