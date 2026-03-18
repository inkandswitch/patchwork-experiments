import { updateText } from '@automerge/automerge-repo';
import type { Doc, Ref } from '@automerge/automerge-repo';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';
import './text.css';

export const schema = z.object({
  type: z.literal('text'),
  id: z.string(),
  x: z.number(),
  y: z.number(),
  zIndex: z.number(),
  text: z.string(),
  color: z.string().optional(),
  fontSize: z.number().optional(),
});

export type TextShape = z.infer<typeof schema>;

const DEFAULT_FONT_SIZE = 18;
const DEFAULT_COLOR = '#1a1a1a';
const supportsFieldSizing = CSS.supports('field-sizing', 'content');

// ─── Entry point ──────────────────────────────────────────────────────────────

export default function textRefTool(ref: Ref<TextShape>, element: HTMLElement): () => void {
  return render(() => <TextShapeView shapeRef={ref} hostElement={element} />, element);
}

// ─── View ─────────────────────────────────────────────────────────────────────

function TextShapeView(props: { shapeRef: Ref<TextShape>; hostElement: HTMLElement }) {
  const initial = props.shapeRef.value() as TextShape | undefined;
  const shapeId = initial?.id ?? '';

  const [shape, setShape] = createSignal<TextShape | undefined>(initial);

  let textareaEl!: HTMLTextAreaElement;
  let mirrorEl: HTMLSpanElement | undefined;

  onCleanup(
    props.shapeRef.onChange((val) => {
      const s = val as TextShape | undefined;
      setShape(s);
      if (s && document.activeElement !== textareaEl) {
        const newValue = s.text ?? '';
        if (textareaEl.value !== newValue) {
          textareaEl.value = newValue;
          resizeMirror();
        }
      }
    }),
  );

  function resizeMirror() {
    if (!mirrorEl) return;
    const val = textareaEl.value;
    mirrorEl.textContent = val.endsWith('\n') ? val + ' ' : val || ' ';
    textareaEl.style.width = mirrorEl.offsetWidth + 'px';
    textareaEl.style.height = mirrorEl.offsetHeight + 'px';
  }

  onMount(() => {
    if (initial) {
      textareaEl.value = initial.text ?? '';
      resizeMirror();
      if (!initial.text) requestAnimationFrame(() => textareaEl.focus());
    }
  });

  createEffect(() => {
    const s = shape();
    if (!s) return;
    props.hostElement.style.setProperty(
      '--paper-text-size',
      `${s.fontSize ?? DEFAULT_FONT_SIZE}px`,
    );
    props.hostElement.style.setProperty('--paper-text-color', s.color ?? DEFAULT_COLOR);
  });

  return (
    <>
      <Show when={!supportsFieldSizing}>
        <span ref={mirrorEl} class="paper-text-mirror" />
      </Show>
      <textarea
        ref={textareaEl}
        class="paper-text-textarea"
        spellcheck={false}
        rows={1}
        onPointerDown={(e) => e.stopPropagation()}
        onInput={(e) => {
          resizeMirror();
          console.log('input', textareaEl.value);
          // props.shapeRef.docHandle.change((d) => {
          //   updateText(d as Doc<unknown>, ['shapes', shapeId, 'text'], textareaEl.value);
          // });
        }}
        onBlur={() => {
          if (!textareaEl.value.trim()) props.shapeRef.remove();
        }}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') textareaEl.blur();
        }}
      />
    </>
  );
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:ref-tool' as const,
    id: 'paper-text',
    name: 'Text',
    schema,
    async load() {
      return textRefTool;
    },
  },
];
