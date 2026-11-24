import { render } from 'solid-js/web';
import type { AmbsheetHandle } from './datatype';
import { App } from './ui/App';
import css from './ui/styles.css?inline';

/** The Patchwork tool: renders the ambsheet in `handle` into `element`. */
export default function AmbsheetTool(handle: AmbsheetHandle, element: HTMLElement) {
  // Patchwork tools live in the light DOM, so the styles travel with the tool (and are
  // all scoped under .ambsheet).
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.className = 'ambsheet';
  element.append(style, root);

  const dispose = render(() => <App handle={handle} />, root);

  return () => {
    dispose();
    root.remove();
    style.remove();
  };
}
