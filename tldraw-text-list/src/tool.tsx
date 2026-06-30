import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { type Cell, derive, optic, type Writable } from "bireactive";
import { connectStore } from "bireactive/automerge";
import { each, mount } from "bireactive/jsx-runtime";
import { type RichTextDoc, toPlain, toRichText } from "./richtext";
import { isTextShape, order, type Shape } from "./shapes";

type TLDrawDoc = { store?: Record<string, Shape>; schema?: unknown };

// `props.richText` ⟷ plain text, the leaf optic of every bullet's bind.
const richTextText = optic<RichTextDoc | undefined, string>(toPlain, toRichText);

// All presentation is CSS so the component body stays pure projection + binding:
// `:focus` highlight and `ul:empty` empty state. Events need no swallowing — the
// markdown embed widget's `ignoreEvent` already isolates the tool from the host.
const STYLE = `
.tl-text-list { font:14px/1.5 ui-sans-serif,system-ui,sans-serif; color:inherit; padding:14px 16px; box-sizing:border-box; }
.tl-text-list ul { list-style:disc; margin:0; padding-left:22px; display:flex; flex-direction:column; gap:4px; }
.tl-text-list ul:empty::after { content:"No text shapes in this tldraw document yet."; opacity:0.55; font-style:italic; }
.tl-text-list li > div { outline:none; white-space:pre-wrap; word-break:break-word; border-radius:4px; padding:1px 4px; margin:-1px -4px; min-height:1.2em; }
.tl-text-list li > div:focus { background:rgba(127,127,127,0.12); }
`;

export const TextListTool: ToolRender = (handle, element) => {
  const host = document.createElement("div");
  host.style.cssText = "height:100%;overflow:auto;box-sizing:border-box;color:inherit;";
  element.appendChild(host);

  // The doc↔graph bridge — the apex everything below projects from. `replace`
  // forces `richText` writes to whole-object puts (tldraw's store bridge can't
  // apply nested text splices). No imperative `handle.*` beyond handing it over.
  const bridge = connectStore<TLDrawDoc>(handle as DocHandle<TLDrawDoc>, {
    replace: ["richText"],
  });
  const records = bridge.store.store;

  const rows = derive<Shape[]>(() => {
    const map = (records.value ?? {}) as Record<string, Shape>;
    return Object.values(map).filter(isTextShape).sort(order);
  });

  const textOf = (id: string): Writable<Cell<string>> =>
    // biome-ignore lint/suspicious/noExplicitAny: dynamic store-proxy keys
    (records as any)[id].props.richText.lens(richTextText);

  const dispose = mount(
    () => (
      <div class="tl-text-list">
        <style>{STYLE}</style>
        <ul
          ref={(ul: Node) =>
            each(
              ul as Element,
              rows,
              (s: Shape) => s.id,
              (s: Shape) => (
                <li>
                  <div contenteditable="plaintext-only" spellcheck="false" lens={textOf(s.id)} />
                </li>
              ),
            )
          }
        />
      </div>
    ),
    host,
  );

  return () => {
    dispose();
    bridge.dispose();
    host.remove();
  };
};
