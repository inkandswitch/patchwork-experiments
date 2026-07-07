# Card UI (the middle slot) and persisted state

Most cards are behavior-only: the shell draws the whole face (title,
description, pips) from the card document, and the module renders nothing.
Only render into `element` when the card genuinely shows something — status,
a result list, controls.

## Rendering

The slot is small (the middle band of a playing card) — design for a status
line, a compact list, or a short row of controls; make long content scroll
(`overflow: auto`). Plain DOM re-rendered on change is the default:

```js
export default (handle, element) => {
  const root = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = `
    .my-card-list { margin: 0; padding: 0; list-style: none; font-size: 12px; overflow: auto; }
    .my-card-list li { padding: 2px 4px; }
  `;
  element.append(style, root);

  const render = () => {
    const doc = handle.doc();
    root.innerHTML = "";
    // ... build DOM from doc + your working state ...
  };
  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    root.remove();
    style.remove();
  };
};
```

- Namespace CSS classes (there is no shadow DOM — you share the page) and
  remove the `<style>` element in cleanup.
- For fine-grained reactivity use Solid without a build step:
  `import { render } from "solid-js/web"`, `import html from "solid-js/html"`,
  `import { createSignal } from "solid-js"` — mirror the doc into a signal
  from the `change` listener, and call the disposer `render` returns in
  cleanup. Never `stopPropagation()` on `click` (Solid delegates clicks); if
  a control must not start a canvas drag, stop `pointerdown` instead.

## Persisting settings on the card document

Settings that should survive reloads (a chosen mode, a threshold) live as
extra fields on the card's own document:

```js
const period = () => handle.doc()?.period ?? "week";
select.onchange = () => handle.change((d) => { d.period = select.value; });
```

- Read with `handle.doc()`, write ONLY inside `handle.change`, re-render (and
  re-run any dependent work) from the `change` event — that way remote edits
  and your own writes take the same path.
- Never assign `undefined`; `delete d.field` or set `null`. Mutate arrays and
  objects in place, don't reassign them.
- Expect fields to be missing on first run — always default.
- Working state that is *derived* (fetch results, scan output) does NOT
  belong on the document; keep it in module variables and republish through
  context channels.

## Hover → highlight

To make a row in your UI light up its counterpart on the canvas, own a slice
of the `highlight` channel and clear-and-set it on hover:

```js
const highlight = store.handle({ name: "highlight", empty: {} }, owner);
const setHighlight = (urls) => highlight.change((slice) => {
  for (const key of Object.keys(slice)) delete slice[key];
  for (const url of urls) slice[url] = true;
});
row.onmouseenter = () => setHighlight([rowDocUrl]);
row.onmouseleave = () => setHighlight([]);
// cleanup: highlight.release()
```
