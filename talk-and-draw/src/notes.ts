/**
 * Shared notes: what agents have learned about how Patchwork and its tools work, kept
 * in an Automerge document (`{ notes: [{topic, text, author, when}] }`) so the manual
 * syncs and grows. Separate objects in an array, not one big string, so concurrent
 * edits merge.
 *
 * Which document: `localStorage['patchworkTalkAndDraw.notesUrl']`, created on first
 * use. Point several browsers at the same URL (`talkAndDraw.notesUrl = '…'` from the
 * console, or the drawer) to share one manual. Falls back to localStorage when
 * there is no repo.
 */
export interface Note {
  topic: string;
  text: string;
  author?: string;
  when?: string;
}

const URL_KEY = 'patchworkTalkAndDraw.notesUrl';
/**
 * The ONE shared manual, for everyone who installs this package: Talk & Draw acts on
 * all of Patchwork, so what one agent learns should help every user's agent. A
 * localStorage URL (setNotesUrl) overrides it, e.g. for a private manual.
 */
export const SHARED_NOTES_URL = '';
const LOCAL_KEY = 'patchworkTalkAndDraw.notes';

let handle: any = null;
let loading: Promise<void> | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function notesUrl(): string | null {
  return handle?.url ?? (storage()?.getItem(URL_KEY) || SHARED_NOTES_URL || null);
}

/** Switch to another notes document (null: forget it; a new one is made on next use). */
export async function setNotesUrl(url: string | null): Promise<void> {
  handle = null;
  loading = null;
  if (url) storage()?.setItem(URL_KEY, url);
  else storage()?.removeItem(URL_KEY);
  await loadNotesDoc();
}

/** Finds or creates the notes document. Safe to call repeatedly. */
export function loadNotesDoc(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const repo = (window as any).repo;
    if (!repo) return;
    const url = storage()?.getItem(URL_KEY) || SHARED_NOTES_URL || null;
    try {
      if (url) {
        handle = await repo.find(url);
        if (typeof handle?.whenReady === 'function') await handle.whenReady();
        return;
      }
    } catch (err) {
      console.warn('Talk & Draw: could not load notes doc', url, err);
    }
    handle = repo.create({ notes: [] });
    storage()?.setItem(URL_KEY, handle.url);
  })();
  return loading;
}

function localNotes(): Note[] {
  try {
    return JSON.parse(storage()?.getItem(LOCAL_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function readNotes(): Note[] {
  if (!handle) return localNotes();
  const arr = (handle.doc()?.notes ?? []) as any[];
  return arr
    .filter((n) => n && typeof n.topic === 'string')
    .map((n) => ({
      topic: String(n.topic),
      text: String(n.text ?? ''),
      author: n.author ? String(n.author) : undefined,
      when: n.when ? String(n.when) : undefined,
    }));
}

export function rememberNote(topic: string, text: string, author?: string): number {
  const n: Note = { topic, text, author: author ?? '', when: new Date().toISOString() };
  if (!handle) {
    const list = localNotes().filter((x) => x.topic !== topic);
    list.push(n);
    storage()?.setItem(LOCAL_KEY, JSON.stringify(list));
    return list.length;
  }
  handle.change((d: any) => {
    if (!Array.isArray(d.notes)) d.notes = [];
    const i = d.notes.findIndex((x: any) => x?.topic === topic);
    if (i >= 0) d.notes.splice(i, 1, n);
    else d.notes.push(n);
  });
  return handle.doc().notes.length;
}

export function forgetNote(topic: string): boolean {
  if (!handle) {
    const list = localNotes();
    const rest = list.filter((x) => x.topic !== topic);
    storage()?.setItem(LOCAL_KEY, JSON.stringify(rest));
    return rest.length !== list.length;
  }
  let removed = false;
  handle.change((d: any) => {
    const i = (d.notes ?? []).findIndex((x: any) => x?.topic === topic);
    if (i >= 0) {
      d.notes.splice(i, 1);
      removed = true;
    }
  });
  return removed;
}

/** The notes as the model reads them in its first turn. */
export function formatNotes(notes: readonly Note[]): string {
  if (notes.length === 0) {
    return 'Shared notes about Patchwork and its tools: none yet. You are the first agent here — record what you learn (see the remember tool).';
  }
  const lines = notes.map((n) => {
    const by = n.author ? ` — ${n.author}` : '';
    const when = n.when ? `, ${n.when.slice(0, 10)}` : '';
    return `- ${n.topic}: ${n.text}${by || when ? ` (${by.replace(/^ — /, '')}${when})` : ''}`;
  });
  return `Shared notes about Patchwork and its tools, written by earlier agent runs. Trust them, but fix any that turn out wrong:\n${lines.join('\n')}`;
}
