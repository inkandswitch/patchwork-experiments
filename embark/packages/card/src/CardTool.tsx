import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, createEffect } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { CardDoc } from "./datatype";
import "./card.css";

// A minimal editor for a card: a read-only table of its `props` plus a textarea
// bound to its `content`.
export const CardTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <Card handle={handle as DocHandle<CardDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => dispose();
};

function Card(props: { handle: DocHandle<CardDoc> }) {
  const [doc] = useDocument<CardDoc>(() => props.handle.url);
  const entries = () => Object.entries(doc()?.props ?? {});

  let textarea: HTMLTextAreaElement | undefined;

  // Drive the textarea as effectively uncontrolled: seed it (and re-sync on
  // remote edits) only when the stored value actually differs from what's
  // shown, so the round-trip through automerge never resets the caret while
  // the user types.
  createEffect(() => {
    const content = doc()?.content ?? "";
    if (textarea && textarea.value !== content) textarea.value = content;
  });

  const onInput = (event: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const value = event.currentTarget.value;
    props.handle.change((card) => {
      card.content = value;
    });
  };

  return (
    <div class="embark-card">
      <table class="embark-card__props">
        <tbody>
          <For each={entries()}>
            {([key, value]) => (
              <tr class="embark-card__row">
                <th class="embark-card__key">{key}</th>
                <td class="embark-card__value">{stringifyValue(value)}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <textarea
        ref={textarea}
        class="embark-card__content"
        placeholder="Write something…"
        on:input={onInput}
      />
    </div>
  );
}

// Show strings verbatim; render everything else as compact JSON.
function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
