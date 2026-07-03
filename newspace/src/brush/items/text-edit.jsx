// Text-editing helpers, extracted from tool.jsx.
//   InlineEdit — a <textarea> editing an item's `.text` (used for shape labels).
//   TextEdit   — a contenteditable that IS the same element as the static text
//                display, so editing has identical shape+size (no jump).
// Both are prop-driven (`id`, `surface`, `text`, `style`, `done`, …).
import { onMount } from "solid-js";

export function InlineEdit(props) {
  let el;
  // a textarea that edits an item's `.text`, saving to its surface
  const save = (v) => props.surface.handle.change((d) => {
    const o = d.items.find((x) => x.id === props.id);
    if (!o) return;
    o.text = v;
    if (props.autosize && el && props.wrap) {
      // fixed-width text box (excalidraw): only the height grows
      el.style.height = "0px";
      const h = Math.max(1, el.scrollHeight);
      el.style.height = h + "px";
      if (Math.abs((o.h || 0) - h) > 1) o.h = h;
    } else if (props.autosize && el) {
      // point text: grow to fit both ways — measure with the box collapsed first
      el.style.width = "0px"; el.style.height = "0px";
      const w = Math.max(8, el.scrollWidth), h = Math.max(1, el.scrollHeight);
      el.style.width = w + "px"; el.style.height = h + "px";
      if (Math.abs((o.w || 0) - w) > 1) o.w = w;
      if (Math.abs((o.h || 0) - h) > 1) o.h = h;
    } else if (el && o.kind === "text" && Math.abs((o.h || 0) - el.scrollHeight) > 1) {
      o.h = el.scrollHeight;
    }
  });
  onMount(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); if (props.autosize) save(el.value); });
  return (
    <textarea
      ref={el}
      class={props.cls}
      classList={{ "ns-text-wrap": !!props.wrap }}
      style={props.style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); el.blur(); } }}
      onInput={(e) => save(e.currentTarget.value)}
      onBlur={() => props.done()}
    >{props.text}</textarea>
  );
}

// Editor for a text ITEM. It's the SAME element as the static display (a
// `.ns-text-static` div, contenteditable) so editing has identical shape + size
// — no jump between display and edit. plaintext-only keeps Enter = newline and
// paste plain. The element sizes itself (point text grows both ways; a wrap box
// keeps its width), which we mirror back into the item's w/h on COMMIT (blur):
// typing writes only the text — a per-keystroke size write churned the doc for
// a value the element already displays. README.md Phase 10 (plan-2 §9).
export function TextEdit(props) {
  let el;
  const save = () => props.surface.handle.change((d) => {
    const o = d.items.find((x) => x.id === props.id);
    if (o) o.text = el.innerText;
  });
  const commitSize = () => props.surface.handle.change((d) => {
    const o = d.items.find((x) => x.id === props.id);
    if (!o) return;
    const h = Math.max(1, el.offsetHeight);
    if (!props.wrap) { const w = Math.max(8, el.offsetWidth); if (Math.abs((o.w || 0) - w) > 1) o.w = w; }
    if (Math.abs((o.h || 0) - h) > 1) o.h = h;
  });
  onMount(() => {
    el.innerText = props.text || "";
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    save();
  });
  return (
    <div
      ref={el}
      class="ns-text-static ns-text-editing"
      classList={{ "ns-text-wrap": !!props.wrap }}
      contenteditable="plaintext-only"
      style={props.style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); el.blur(); } }}
      onInput={save}
      onBlur={() => { commitSize(); props.done(); }}
    />
  );
}
