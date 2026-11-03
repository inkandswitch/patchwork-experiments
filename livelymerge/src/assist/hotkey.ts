/** Session hotkeys. Kept DOM-free so they can be unit-tested. */

export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Starts a session: cmd-space (note: Spotlight owns it on a stock macOS, so the
 * browser only sees it when Spotlight is rebound) or ctrl-space.
 */
export function isStartHotkey(e: KeyLike): boolean {
  const space = e.code === 'Space' || e.key === ' ';
  if (!space || e.altKey || e.shiftKey) return false;
  if (e.metaKey && !e.ctrlKey) return true;
  if (e.ctrlKey && !e.metaKey) return true;
  return false;
}

export function isEndHotkey(e: KeyLike): boolean {
  return e.key === 'Escape';
}
