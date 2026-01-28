/**
 * Word Counter - Bundleless Patchwork Toolbar Tool
 *
 * A title bar tool that displays word count and character count for markdown documents.
 */

// ============================================================================
// Word Counter Tool
// ============================================================================

function countWords(text) {
  if (!text || typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

function countCharacters(text) {
  if (!text || typeof text !== "string") return 0;
  return text.length;
}

function createStyles() {
  const style = document.createElement("style");
  style.textContent = `
    .wc-container {
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      color: var(--color-text-secondary, #666);
      padding: 0 8px;
      height: 100%;
      user-select: none;
    }
    .wc-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .wc-value {
      font-weight: 600;
      color: var(--color-text-primary, #333);
      font-variant-numeric: tabular-nums;
    }
    .wc-label {
      opacity: 0.8;
    }
    .wc-divider {
      width: 1px;
      height: 14px;
      background: var(--color-border, #ddd);
    }
  `;
  return style;
}

export function renderWordCounter(handle, element) {
  const style = createStyles();
  element.appendChild(style);

  const container = document.createElement("div");
  container.className = "wc-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc || !doc.content) {
      container.innerHTML = "";
      return null;
    }

    const content = doc.content;
    const words = countWords(content);
    const chars = countCharacters(content);

    container.innerHTML = `
      <div class="wc-stat">
        <span class="wc-value">${words.toLocaleString()}</span>
        <span class="wc-label">${words === 1 ? "word" : "words"}</span>
      </div>
      <div class="wc-divider"></div>
      <div class="wc-stat">
        <span class="wc-value">${chars.toLocaleString()}</span>
        <span class="wc-label">${chars === 1 ? "char" : "chars"}</span>
      </div>
    `;
  }

  render();
  handle.on("change", render);

  return () => {
    handle.off("change", render);
    container.remove();
    style.remove();
  };
}

// ============================================================================
// Plugin Exports
// ============================================================================

export const plugins = [
  {
    type: "patchwork:tool",
    id: "word-counter",
    name: "Word Counter",
    icon: "Hash",
    supportedDatatypes: ["markdown"],
    async load() {
      return renderWordCounter;
    },
    forTitleBar: true,
  },
];
