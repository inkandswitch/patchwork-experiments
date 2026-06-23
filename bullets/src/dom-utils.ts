import { hasTag } from "./tree-utils.ts";
import { URL_OR_TAG_RE } from "./constants.ts";

const WEB_URL_RE = /https?:\/\/[^\s]+/g;

export function hasWebUrl(text: string): boolean {
  WEB_URL_RE.lastIndex = 0;
  return WEB_URL_RE.test(text);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderContentWithLinks(el: HTMLElement, text: string) {
  URL_OR_TAG_RE.lastIndex = 0;
  const parts: string[] = [];
  let lastIdx = 0;
  let match;
  while ((match = URL_OR_TAG_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(escapeHtml(text.slice(lastIdx, match.index)));
    }
    const token = match[0];
    if (token.startsWith("#")) {
      const tag = escapeHtml(token.slice(1).toLowerCase());
      parts.push(`<span class="bullet-tag" data-tag="${tag}">${escapeHtml(token)}</span>`);
    } else {
      const escaped = escapeHtml(token);
      parts.push(`<a href="${escaped}" class="bullet-link">${escaped}</a>`);
    }
    lastIdx = match.index + token.length;
  }
  if (lastIdx < text.length) {
    parts.push(escapeHtml(text.slice(lastIdx)));
  }
  el.innerHTML = parts.join("");
}

export function hasRichContent(text: string): boolean {
  return hasWebUrl(text) || hasTag(text);
}

/** Find the previous or next .bullet-content in DOM order. */
export function findAdjacentBulletContent(
  current: HTMLElement,
  direction: "up" | "down"
): HTMLElement | null {
  const list = current.closest(".bullets-list");
  if (!list) return null;
  const all = Array.from(list.querySelectorAll<HTMLElement>(".bullet-content"));
  const idx = all.indexOf(current);
  if (idx === -1) return null;
  const target = direction === "up" ? idx - 1 : idx + 1;
  return all[target] ?? null;
}

/** Restore cursor to a character offset within an element after innerHTML replacement. */
export function restoreCursor(el: HTMLElement, charOffset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = charOffset;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = (node as Text).length;
    if (remaining <= len) {
      const range = document.createRange();
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
  }
  // Fallback: place at end
  const range = document.createRange();
  if (el.lastChild) {
    range.setStartAfter(el.lastChild);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Focus a .bullet-content element and place cursor at end. */
export function focusBulletContent(el: HTMLElement) {
  el.focus();
  const range = document.createRange();
  const sel = window.getSelection();
  if (el.childNodes.length > 0) {
    range.setStartAfter(el.lastChild!);
  } else {
    range.setStart(el, 0);
  }
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.scrollIntoView({ block: "nearest" });
}

/** Get the computed line height of an element in pixels. */
function getLineHeight(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const lh = parseFloat(style.lineHeight);
  if (!isNaN(lh) && lh > 0) return lh;
  return (parseFloat(style.fontSize) || 16) * 1.4;
}

/** Get the character offset of the selection focus point within an element. */
function getFocusCharOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.focusNode || sel.rangeCount === 0) return 0;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.setEnd(sel.focusNode, sel.focusOffset);
  return range.toString().length;
}

/** Check if the selection focus point is on the first visual line of the element. */
export function isCursorOnFirstVisualLine(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.focusNode) return true;
  if (!el.firstChild) return true;

  // Character-position fallback: offset 0 is always the first line
  if (getFocusCharOffset(el) === 0) return true;

  const startRange = document.createRange();
  startRange.selectNodeContents(el);
  startRange.collapse(true);
  const startY = startRange.getBoundingClientRect().top;

  const focusRange = document.createRange();
  focusRange.setStart(sel.focusNode, sel.focusOffset);
  focusRange.collapse(true);
  const focusY = focusRange.getBoundingClientRect().top;

  if (startY === 0 && startY === focusY) return true;

  return Math.abs(focusY - startY) < getLineHeight(el) * 0.8;
}

/** Check if the selection focus point is on the last visual line of the element. */
export function isCursorOnLastVisualLine(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.focusNode) return true;
  if (!el.firstChild) return true;

  // Character-position fallback: at end of text is always the last line
  const textLen = (el.textContent || "").length;
  if (getFocusCharOffset(el) >= textLen) return true;

  const endRange = document.createRange();
  endRange.selectNodeContents(el);
  endRange.collapse(false);
  const endY = endRange.getBoundingClientRect().top;

  const focusRange = document.createRange();
  focusRange.setStart(sel.focusNode, sel.focusOffset);
  focusRange.collapse(true);
  const focusY = focusRange.getBoundingClientRect().top;

  if (endY === 0 && endY === focusY) return true;

  return Math.abs(focusY - endY) < getLineHeight(el) * 0.8;
}

export function getActiveBulletId(): string | null {
  const el = document.activeElement;
  if (!el) return null;
  const row = el.closest?.(".bullet-row[data-bullet-id]") as HTMLElement | null;
  return row?.dataset.bulletId ?? null;
}
