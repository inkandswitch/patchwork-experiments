const styles = `
  :host { display: inline-block; }
  input, textarea {
    color: var(--te-input-color);
    background-color: var(--te-input-bg);
    border: 1px solid var(--te-input-border);
    border-radius: 0.3em;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  input:focus, textarea:focus {
    border-color: var(--te-input-border-focus);
  }
  ::selection {
    background-color: var(--te-highlight);
  }
  input {
    font-size: 0.9em;
    padding: 0.25em 0.5em 0.2em;
    min-width: 6em;
    line-height: 1.2em;
    height: 1.6em;
  }
  textarea {
    display: block;
    font-size: 0.85em;
    padding: 0.2em 0.5em;
    min-width: 20em;
    min-height: 3em;
    max-height: 40em;
    resize: both;
    overflow: auto;
    white-space: pre-wrap;
  }
`

export class TEInput extends HTMLElement {
  input: HTMLInputElement

  constructor() {
    super()
    const shadow = this.attachShadow({ mode: "open" })
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
    const shadow = this.attachShadow({ mode: "open" })
    const style = document.createElement("style")
    style.textContent = styles
    shadow.appendChild(style)
    this.textarea = document.createElement("textarea")
    shadow.appendChild(this.textarea)
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
