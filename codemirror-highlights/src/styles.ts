const DEFAULT_HIGHLIGHT_CSS = "background: rgba(255, 230, 0, 0.35);";

export function createHighlightRule(group: string, css?: string): string {
  return `::highlight(${group}) { ${normalizeHighlightCss(css)} }`;
}

function normalizeHighlightCss(css?: string): string {
  const trimmed = css?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_HIGHLIGHT_CSS;
}
