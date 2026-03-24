import { updateText } from "@automerge/automerge";
import type { Doc, Patch, Prop } from "@automerge/automerge";
import type {
  AnyDocumentId,
  DocHandle,
  DocHandleChangePayload,
  Repo,
} from "@automerge/automerge-repo";
import type { Schema } from "./schema";
import type { Subscribable } from "./subscribable";

export type RefPathSegment = string | number;

export class Ref<T = unknown> implements Subscribable<T> {
  #handle: DocHandle<unknown>;
  #path: RefPathSegment[];
  #schema?: Schema<unknown>;

  constructor(handle: DocHandle<unknown>, path: RefPathSegment[], schema?: Schema<unknown>) {
    this.#handle = handle;
    this.#path = path;
    this.#schema = schema;
  }

  at(...segments: RefPathSegment[]): Ref<unknown> {
    return new Ref(this.#handle, this.#path.concat(segments));
  }

  get url(): string {
    return encodeRefToURL(this.#handle.url, this.#path);
  }

  value(): T {
    const raw = getAtPath(this.#handle.doc(), this.#path);
    if (this.#schema) {
      if (raw === undefined) {
        const initial = this.#schema.init();
        this.change((() => initial) as () => T);
        return initial as T;
      }
      return this.#schema.parse(raw) as T;
    }
    return raw as T;
  }

  change(fn: ((current: T) => void) | (() => T)): void {
    if (typeof fn !== "function") {
      throw new TypeError("ref.change expects a function");
    }
    const path = this.#path;
    this.#handle.change((doc) => {
      if (fn.length === 0) {
        const replacer = fn as () => unknown;
        if (path.length === 0) {
          throw new Error("Ref.change: cannot replace root document with change(() => value)");
        }
        const prev = getAtPath(doc, path);
        const next = replacer();
        if (typeof next === "string" && typeof prev === "string") {
          updateText(doc as Doc<unknown>, path, next);
        } else {
          setAtPath(doc, path, next);
        }
      } else {
        (fn as (current: unknown) => void)(getAtPath(doc, path));
      }
    });
  }

  as<U>(schema: Schema<U>): Ref<U> {
    return new Ref(this.#handle, this.#path, schema as Schema<unknown>) as unknown as Ref<U>;
  }

  subscribe(fn: (value: T) => void): () => void {
    fn(this.value());
    const handler = (payload: DocHandleChangePayload<unknown>) => {
      if (patchAffectsPath(payload.patches, this.#path)) {
        const raw = getAtPath(this.#handle.doc(), this.#path);
        if (raw === undefined && this.#path.length > 0) return;
        fn(this.value());
      }
    };
    this.#handle.on("change", handler);
    return () => {
      this.#handle.off("change", handler);
    };
  }
}

function encodeRefToURL(docUrl: string, path: RefPathSegment[]): string {
  if (!path.length) return docUrl;
  const suffix = path.map((s) => encodeURIComponent(String(s))).join("/");
  return `${docUrl}/${suffix}`;
}

export function parseRefURL(urlString: string): { docUrl: string; path: RefPathSegment[] } {
  const schemeEnd = urlString.indexOf(":");
  if (schemeEnd === -1) return { docUrl: urlString, path: [] };
  const slashIdx = urlString.indexOf("/", schemeEnd + 1);
  if (slashIdx === -1) return { docUrl: urlString, path: [] };
  const docUrl = urlString.slice(0, slashIdx);
  const rest = urlString.slice(slashIdx + 1);
  const path: RefPathSegment[] = rest
    .split("/")
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
  return new Ref(handle, path);
}

export function createRef<T = unknown>(handle: DocHandle<T>): Ref<T> {
  return new Ref(handle as DocHandle<unknown>, []) as Ref<T>;
}

function pathsOverlap(patchPath: Prop[], refPath: RefPathSegment[]): boolean {
  const minLength = Math.min(patchPath.length, refPath.length);
  for (let i = 0; i < minLength; i++) {
    if (String(patchPath[i]) !== String(refPath[i])) return false;
  }
  return true;
}

function patchAffectsPath(patches: Patch[], refPath: RefPathSegment[]): boolean {
  return patches.some((patch) => pathsOverlap(patch.path, refPath));
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
    throw new Error("setAtPath: empty path");
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
