import { from, render, html } from '../solid.js';
import { schema } from './schema.js';
import styles from './shape.css' with { type: 'css' };

document.adoptedStyleSheets = [...document.adoptedStyleSheets, styles];

export { schema };

export default function mount(element) {
  const ref = element.ref.as(schema);
  const data = from(ref);

  const shapeId = element.ref.url.split('/').pop() ?? '';

  function embedDocUrl() {
    return data()?.embedDocUrl;
  }

  function embedToolUrl() {
    return data()?.embedToolUrl;
  }

  function embedWidth() {
    return `${data()?.width}px`;
  }

  function embedHeight() {
    return `${data()?.height}px`;
  }

  return render(
    () =>
      html`<div
        class="embed-shape"
        style=${() => ({ width: embedWidth(), height: embedHeight() })}
      >
        <div class="embed-shape-header">
          <span class="embed-shape-title">${shapeId} v2</span>
        </div>
        <div
          class="embed-shape-body"
          onPointerDown=${(e) => e.stopPropagation()}
        >
          ${() =>
          embedDocUrl()
            ? html`<ref-view
                    tool-url=${embedToolUrl}
                    ref-url=${embedDocUrl}
                  />`
            : html`<div class="embed-shape-placeholder">
                    No embedded document
                  </div>`}
        </div>
      </div>`,
    element,
  );
}
