/**
 * Shared notes: what agents have learned about how THIS document's UI works, kept in
 * a persistent LM global (`aiNotes`, an array of {topic, text, author, when}) so it
 * syncs with the document and every user's agent reads and extends the same manual.
 * Separate objects, not one big string: LM strings are single Automerge ops, so two
 * users' concurrent edits to one text would overwrite each other, while pushes to an
 * array merge.
 *
 * All access goes through the runtime's transpiling eval, the same path the
 * Workspace's do-it uses. The code is built here with JSON-quoted strings so the
 * model never composes it.
 */
export const NOTES_GLOBAL = 'aiNotes';

export interface Note {
  topic: string;
  text: string;
  author?: string;
  when?: string;
}

interface RuntimeLike {
  eval(source: string): unknown;
}

function runtime(): RuntimeLike | null {
  const rt = (window as any).runtime;
  return rt && typeof rt.eval === 'function' ? rt : null;
}

const q = (s: string) => JSON.stringify(String(s));

/** LM source that upserts a note by topic (creating the global on first use). */
export function rememberSource(note: Note): string {
  const g = NOTES_GLOBAL;
  return `(() => {
  if (typeof ${g} === 'undefined' || ${g} == null) ${g} = [];
  let i = -1;
  for (let k = 0; k < ${g}.length; k++) if (${g}[k].topic === ${q(note.topic)}) i = k;
  let n = { topic: ${q(note.topic)}, text: ${q(note.text)}, author: ${q(note.author ?? '')}, when: ${q(note.when ?? '')} };
  if (i >= 0) ${g}[i] = n; else ${g}.push(n);
  return ${g}.length;
})()`;
}

/** LM source that removes the note with this topic; returns whether one was removed. */
export function forgetSource(topic: string): string {
  const g = NOTES_GLOBAL;
  return `(() => {
  if (typeof ${g} === 'undefined' || ${g} == null) return false;
  let i = -1;
  for (let k = 0; k < ${g}.length; k++) if (${g}[k].topic === ${q(topic)}) i = k;
  if (i < 0) return false;
  ${g}.splice(i, 1);
  return true;
})()`;
}

/** LM source that yields the notes array (or null when there is none). */
export function readSource(): string {
  const g = NOTES_GLOBAL;
  return `typeof ${g} === 'undefined' ? null : ${g}`;
}

/** The notes as plain host objects (reads the LM proxies property by property). */
export function readNotes(): Note[] {
  const rt = runtime();
  if (!rt) return [];
  const arr = rt.eval(readSource()) as any;
  if (!arr || typeof arr.length !== 'number') return [];
  const out: Note[] = [];
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (!n || typeof n.topic !== 'string') continue;
    out.push({
      topic: n.topic,
      text: String(n.text ?? ''),
      author: n.author ? String(n.author) : undefined,
      when: n.when ? String(n.when) : undefined,
    });
  }
  return out;
}

export function rememberNote(topic: string, text: string, author?: string): number {
  const rt = runtime();
  if (!rt) throw new Error('no runtime');
  return Number(rt.eval(rememberSource({ topic, text, author, when: new Date().toISOString() })));
}

export function forgetNote(topic: string): boolean {
  const rt = runtime();
  if (!rt) throw new Error('no runtime');
  return !!rt.eval(forgetSource(topic));
}

/** The notes as the model reads them in its first turn. */
export function formatNotes(notes: readonly Note[]): string {
  if (notes.length === 0) {
    return 'Shared notes about this system: none yet. You are the first agent here — record what you learn (see the remember tool).';
  }
  const lines = notes.map((n) => {
    const by = n.author ? ` — ${n.author}` : '';
    const when = n.when ? `, ${n.when.slice(0, 10)}` : '';
    return `- ${n.topic}: ${n.text}${by || when ? ` (${by.replace(/^ — /, '')}${when})` : ''}`;
  });
  return `Shared notes about this system, written by earlier agent runs (yours and other users'). Trust them, but fix any that turn out wrong:\n${lines.join('\n')}`;
}
