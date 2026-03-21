/**
 * Custom elements wrapping <input> / <textarea> in a CLOSED shadow root.
 *
 * Closed mode ensures `element.shadowRoot` returns null, so browser extensions
 * (1Password, etc.) that iterate the DOM and peek into shadow roots cannot
 * discover the form elements inside.
 */

const styles = `
  :host { display: inline-block; }
  input, textarea {
    color: var(--te-input-color);
    background: var(--te-input-bg);
    border: 1px solid var(--te-input-border);
    border-radius: 0.35em;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  input:focus, textarea:focus {
    border-color: var(--te-input-border-focus);
    box-shadow: 0 0 0 1px var(--te-input-border-focus);
  }
  ::selection {
    background-color: var(--te-highlight);
  }
  input {
    font-size: 0.9em;
    padding: 0.2em 0.5em;
    min-width: 6em;
    line-height: 1.3em;
    height: 1.6em;
  }
  textarea {
    display: block;
    font-size: 0.85em;
    padding: 0.35em 0.5em;
    min-width: 20em;
    min-height: 3em;
    max-height: 40em;
    resize: vertical;
    overflow-y: auto;
    white-space: pre-wrap;
    line-height: 1.4;
  }
`

export class TEInput extends HTMLElement {
  input: HTMLInputElement

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = styles
    shadow.appendChild(style)
    this.input = document.createElement("input")
    this.input.type = "text"
    shadow.appendChild(this.input)
  }
}

export class TETextarea extends HTMLElement {
  textarea: HTMLTextAreaElement

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "closed" })
    const style = document.createElement("style")
    style.textContent = styles
    shadow.appendChild(style)
    this.textarea = document.createElement("textarea")
    this.textarea.addEventListener("input", () => this.autoSize())
    shadow.appendChild(this.textarea)
  }

  connectedCallback() {
    requestAnimationFrame(() => this.autoSize())
  }

  private autoSize() {
    const ta = this.textarea
    ta.style.height = "auto"
    ta.style.height = Math.min(
      ta.scrollHeight,
      parseFloat(getComputedStyle(ta).maxHeight) || 640
    ) + "px"
  }
}

if (!customElements.get("te-input"))
  customElements.define("te-input", TEInput)
if (!customElements.get("te-textarea"))
  customElements.define("te-textarea", TETextarea)

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "te-input": { ref?: (el: TEInput) => void; class?: string }
      "te-textarea": { ref?: (el: TETextarea) => void; class?: string }
    }
  }
}
