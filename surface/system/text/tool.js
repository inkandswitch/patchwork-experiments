import { render, html } from '../solid.js';
import textSchema from './schema.js';



const supportsFieldSizing = CSS.supports('field-sizing', 'content');

export default function mount(element) {
  const ref = element.getOrCreate(textSchema);
  const textRef = ref.at('text');

  let textareaEl;
  let mirrorEl;

  function resizeMirror() {
    if (supportsFieldSizing || !mirrorEl || !textareaEl) return;
    const val = textareaEl.value;
    mirrorEl.textContent = val.endsWith('\n') ? val + ' ' : val || ' ';
    textareaEl.style.width = mirrorEl.offsetWidth + 'px';
    textareaEl.style.height = mirrorEl.offsetHeight + 'px';
  }

  function onInput() {
    resizeMirror();
    textRef.change(() => textareaEl.value);
  }

  const unsubscribe = textRef.subscribe((text) => {
    if (!textareaEl) return;
    if (document.activeElement === textareaEl) return;
    const newValue = text ?? '';
    if (textareaEl.value !== newValue) {
      textareaEl.value = newValue;
      resizeMirror();
    }
  });

  const dispose = render(
    () =>
      html`<div>
        ${!supportsFieldSizing
          ? html`<span
              ref=${(el) => {
                mirrorEl = el;
              }}
              style=${{
                position: 'absolute',
                visibility: 'hidden',
                'pointer-events': 'none',
                'white-space': 'pre',
                top: '0',
                left: '0',
                'line-height': '1.4',
                'font-family': "'Cutive Mono', 'Courier New', Courier, monospace",
                'font-size': '18px',
              }}
            />`
          : ''}
        <textarea
          ref=${(el) => {
            textareaEl = el;
            const initial = ref.value();
            textareaEl.value = initial?.text ?? '';
            resizeMirror();
          }}
          spellcheck=${false}
          rows=${1}
          onPointerDown=${(e) => e.stopPropagation()}
          onInput=${onInput}
          onKeyDown=${(e) => {
            if (e.key === 'Escape') textareaEl.blur();
          }}
          style=${{
            position: 'absolute',
            top: '0',
            left: '0',
            resize: 'none',
            overflow: 'hidden',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            padding: '0',
            margin: '0',
            'white-space': 'pre',
            cursor: 'text',
            'line-height': '1.4',
            'font-family': "'Cutive Mono', 'Courier New', Courier, monospace",
            'font-size': '18px',
            color: '#1a1a1a',
            'field-sizing': 'content',
          }}
        />
      </div>`,
    element,
  );

  return () => {
    unsubscribe();
    dispose();
  };
}
