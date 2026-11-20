// The bar's icons (PLANS.md §5): a command's `icon` names one; 16 px line
// drawings in currentColor, so they take the button's colour in either theme.
// Plain strings, so a toolbar test can read them without a DOM.

const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = Object.freeze({
  undo: svg('<path d="M5 3 2 6l3 3"/><path d="M2 6h8a4 4 0 0 1 0 8H7"/>'),
  redo: svg('<path d="m11 3 3 3-3 3"/><path d="M14 6H6a4 4 0 0 0 0 8h3"/>'),
  select: svg('<path d="M3 2v11l3.2-3 2.3 5 2-.9-2.3-5H13z"/>'),
  move: svg('<path d="M8 1.5v13M1.5 8h13"/><path d="m6 3.5 2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/>'),
  measure: svg('<rect x="1.5" y="5" width="13" height="6" rx="1"/><path d="M4.5 5v2.5M7 5v1.5M9.5 5v2.5M12 5v1.5"/>'),
  frame: svg('<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/><circle cx="8" cy="8" r="2"/>'),
  grid: svg('<path d="M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13"/>'),
  axes: svg('<path d="M3 13V3M3 13h10M3 13l7-7"/><path d="m1.5 4.5 1.5-2 1.5 2M11.5 11.5l2 1.5-2 1.5"/>'),
  bounds: svg('<rect x="2" y="2" width="12" height="12" rx="1" stroke-dasharray="2 2"/><rect x="5" y="5" width="6" height="6"/>'),
  settings: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
});
