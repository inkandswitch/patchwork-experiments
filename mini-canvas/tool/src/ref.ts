import { updateText } from '@automerge/automerge';
import type { Doc } from '@automerge/automerge';
import type { AnyDocumentId, DocHandle, Repo } from '@automerge/automerge-repo';

export type RefPathSegment = string | number;

export type Ref<T = unknown> = {
  ref(...segments: RefPathSegment[]): Ref<unknown>;
  get(): T;
  toURL(): string;
  change(fn: ((current: unknown) => void) | (() => unknown)): void;
};

export function encodeRefToURL(docUrl: string, path: RefPathSegment[]): string {
  if (!path.length) return docUrl;
  const suffix = path.map((s) => encodeURIComponent(String(s))).join('/');
  return `${docUrl}/${suffix}`;
}

export function parseRefURL(urlString: string): { docUrl: string; path: RefPathSegment[] } {
  const schemeEnd = urlString.indexOf(':');
  if (schemeEnd === -1) return { docUrl: urlString, path: [] };
  const slashIdx = urlString.indexOf('/', schemeEnd + 1);
  if (slashIdx === -1) return { docUrl: urlString, path: [] };
  const docUrl = urlString.slice(0, slashIdx);
  const rest = urlString.slice(slashIdx + 1);
  const path: RefPathSegment[] = rest
    .split('/')
    .filter(Boolean)
    .map((s) => {
      const decoded = decodeURIComponent(s);
      const n = Number(decoded);
      return Number.isFinite(n) && String(n) === decoded ? n : decoded;
    });
  return { docUrl, path };
}

export async function findRef(repo: Repo, urlString: string): Promise<Ref> {
  const { docUrl, path } = parseRefURL(urlString);
  const handle = await repo.find(docUrl as AnyDocumentId);
  return makeRef(handle, path);
}

function makeRef(handle: DocHandle<unknown>, path: RefPathSegment[]): Ref {
  return {
    ref(...segments: RefPathSegment[]) {
      return makeRef(handle, path.concat(segments));
    },

    get() {
      const doc = handle.doc();
      return getAtPath(doc, path);
    },

    toURL() {
      return encodeRefToURL(handle.url, path);
    },

    change(fn: ((current: unknown) => void) | (() => unknown)) {
      if (typeof fn !== 'function') {
        throw new TypeError('ref.change expects a function');
      }
      handle.change((doc) => {
        if (fn.length === 0) {
          const replacer = fn as () => unknown;
          if (path.length === 0) {
            throw new Error('createRef: cannot replace root document with change(() => value)');
          }
          const prev = getAtPath(doc, path);
          const next = replacer();
          if (typeof next === 'string' && typeof prev === 'string') {
            updateText(doc as Doc<unknown>, path, next);
          } else {
            setAtPath(doc, path, next);
          }
        } else {
          (fn as (current: unknown) => void)(getAtPath(doc, path));
        }
      });
    },
  };
}

function getAtPath(obj: unknown, path: RefPathSegment[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

function setAtPath(root: unknown, path: RefPathSegment[], value: unknown) {
  if (path.length === 0) {
    throw new Error('setAtPath: empty path');
  }
  let cur: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    cur = (cur as Record<string | number, unknown>)[seg!];
    if (cur == null) {
      throw new Error(`setAtPath: missing segment at ${String(seg)}`);
    }
  }
  const last = path[path.length - 1]!;
  (cur as Record<string | number, unknown>)[last] = value;
}

export const createRef = Object.assign(
  function createRefFn<T = unknown>(handle: DocHandle<T>): Ref<T> {
    return makeRef(handle as DocHandle<unknown>, []) as Ref<T>;
  },
  { find: findRef },
);
