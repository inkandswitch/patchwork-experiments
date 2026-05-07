import { Show, For, type Accessor, type Setter, type JSX } from "solid-js";
import { BackIcon } from "./icons.jsx";

export default function FilterPanel<T>(props: {
  icon: JSX.Element;
  placeholder: string;
  query: Accessor<string>;
  setQuery: (v: string) => void;
  highlight: Accessor<number>;
  setHighlight: Setter<number>;
  items: Accessor<T[]>;
  onKeyDown: (e: KeyboardEvent) => void;
  emptyMessage: string;
  onSelect: (item: T) => void;
  onBack: () => void;
  renderLabel: (item: T) => JSX.Element;
  renderDescription?: (item: T) => JSX.Element;
}) {
  return (
    <>
      <div class="cmd-palette-input-container">
        <button
          class="cmd-palette-back-btn"
          onClick={props.onBack}
          title="Back to commands"
          aria-label="Back to commands"
        >
          <BackIcon />
        </button>
        <span class="cmd-palette-input-icon">{props.icon}</span>
        <input
          class="cmd-palette-input"
          placeholder={props.placeholder}
          value={props.query()}
          onInput={(e) => {
            props.setQuery(e.target.value);
            props.setHighlight(0);
          }}
          onKeyDown={props.onKeyDown}
          ref={(el) => requestAnimationFrame(() => el.focus())}
        />
      </div>
      <div class="cmd-palette-results">
        <Show
          when={props.items().length > 0}
          fallback={<div class="cmd-palette-empty">{props.emptyMessage}</div>}
        >
          <For each={props.items()}>
            {(item, i) => (
              <div
                class="cmd-palette-item"
                aria-selected={props.highlight() === i()}
                onClick={() => props.onSelect(item)}
                onMouseMove={() => props.setHighlight(i())}
              >
                <span class="cmd-palette-item-label">
                  {props.renderLabel(item)}
                </span>
                <Show when={props.renderDescription}>
                  {(render) => (
                    <span class="cmd-palette-item-description">
                      {render()(item)}
                    </span>
                  )}
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
    </>
  );
}
