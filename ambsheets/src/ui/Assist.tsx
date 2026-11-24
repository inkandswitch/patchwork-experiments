// The popup that helps with a formula as it is typed: completions to pick from (with the
// highlighted one explained), or the arguments of the function the caret is inside.

import { For, Index, Show, createEffect } from 'solid-js';
import type { CallHint } from '../lang/complete';
import { printParam, type FunctionDoc } from '../lang/reference';
import { useSheet } from './state';

export function AssistPopup() {
  const s = useSheet();
  const view = s.assist.view;
  let popup: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;

  // Keep the popup inside the tool: flip it above the input if it would run off the
  // bottom, and slide it left if it would run off the side.
  createEffect(() => {
    const v = view();
    if (!v || !popup) return;
    popup.style.left = v.x + 'px';
    popup.style.top = v.y + 'px';
    const root = popup.parentElement!.getBoundingClientRect();
    const box = popup.getBoundingClientRect();
    if (box.bottom > root.bottom) popup.style.top = Math.max(0, v.inputTop - box.height - 2) + 'px';
    if (box.right > root.right) popup.style.left = Math.max(0, root.width - box.width - 4) + 'px';
  });

  // Keep the highlighted completion in sight.
  createEffect(() => {
    const index = view()?.selected ?? -1;
    const item = index >= 0 ? (list?.children[index] as HTMLElement | undefined) : undefined;
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  });

  const selectedItem = () => {
    const v = view();
    return v?.completions?.items[v.selected];
  };

  return (
    <Show when={view()}>
      {(v) => (
        // (mousedown is swallowed so that clicking in the popup doesn't take the focus
        // away from the formula, which would end the edit)
        <div class="assist" ref={popup} onMouseDown={(e) => e.preventDefault()}>
          <Show
            when={v().completions}
            fallback={
              <>
                <Show when={v().hint}>{(hint) => <Hint hint={hint()} />}</Show>
                <Show when={v().problem}>
                  <div class="assist-problem">{v().problem}</div>
                </Show>
              </>
            }
          >
            {(completions) => (
              <>
                <div class="assist-list" ref={list} role="listbox">
                  <Index each={completions().items}>
                    {(item, i) => (
                      <div
                        class="assist-item"
                        role="option"
                        data-kind={item().kind}
                        data-selected={v().selected === i ? '' : undefined}
                        onMouseEnter={() => s.assist.select(i)}
                        onClick={() => s.assist.accept(item())}
                      >
                        <span class="label">{item().label}</span>
                        <span class="detail">{item().detail}</span>
                      </div>
                    )}
                  </Index>
                </div>
                <div class="assist-doc">
                  <Show
                    when={selectedItem()}
                    fallback={<span class="keys">↑ ↓ to choose · Tab or Enter to insert · Esc to dismiss</span>}
                  >
                    {(item) => (
                      <Show when={item().fn} fallback={item().doc}>
                        {(fn) => <FunctionHelp doc={fn()} param={-1} />}
                      </Show>
                    )}
                  </Show>
                </div>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
}

function Hint(props: { hint: CallHint }) {
  return (
    <div class="assist-doc">
      <FunctionHelp doc={props.hint.doc} param={props.hint.param} />
    </div>
  );
}

/** A function's signature and what it does. `param` is the argument to draw attention to. */
export function FunctionHelp(props: { doc: FunctionDoc; param: number }) {
  return (
    <>
      <div class="signature">
        {props.doc.name}(
        <For each={props.doc.params}>
          {(param, i) => (
            <>
              {i() > 0 ? ', ' : ''}
              <span data-current={props.param === i() ? '' : undefined}>{printParam(param)}</span>
            </>
          )}
        </For>
        )
      </div>
      <Show
        when={props.doc.params[props.param]}
        fallback={
          <>
            <div class="summary">{props.doc.summary}</div>
            <dl>
              <For each={props.doc.params}>
                {(param) => (
                  <>
                    <dt>{param.name}</dt>
                    <dd>{param.doc}</dd>
                  </>
                )}
              </For>
            </dl>
          </>
        }
      >
        {(param) => (
          <>
            <div class="param">
              <b>{param().name}</b>
              {param().optional ? ' (optional)' : ''}: {param().doc}
            </div>
            <div class="summary">{props.doc.summary}</div>
          </>
        )}
      </Show>
    </>
  );
}
