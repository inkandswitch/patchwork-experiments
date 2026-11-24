/**
 * `tad`: the helpers the model gets inside `eval` (also on `window.tad` for the
 * console). Everything here is ordinary page JavaScript over `window.repo` and the
 * DOM — no platform imports — so it works in whatever frame is running.
 *
 * Coordinates in and out are IMAGE px (what the model saw), converted with the
 * session's scale, like every other tool.
 *
 * Patchwork facts this relies on (checked against patchwork-filesystem 0.0.2 and the
 * frames in this repo, Nov 2026):
 *  - `window.repo` (automerge-repo) and `window.accountDocHandle` exist;
 *  - the account doc has `moduleSettingsUrl` → `{ modules: [folderDocUrl | importUrl] }`;
 *  - a pushwork folder doc is `{ title, docs: [{ name, type: 'folder' | 'file', url }] }`
 *    and a file doc is `{ name, extension, mimeType, content }` where content is a
 *    string, an ImmutableString or bytes;
 *  - the ModuleWatcher reloads a module when its ROOT folder doc changes, so writes
 *    touch the root folder too;
 *  - rendered documents are `<patchwork-view doc-url=… tool-id=…>` elements (in
 *    shadow roots too); other elements may carry `data-doc-url` etc.
 */
import { deepActiveElement, deepElementFromPoint, isOwnElement } from './events';

type Url = string;
type AnyDoc = Record<string, any>;

let currentScale = 1;
/** Set by the session/executor: image px = screen px × scale. */
export function setTadScale(s: number): void {
  currentScale = s > 0 ? s : 1;
}
const toScreen = (v: number) => v / currentScale;
const toImage = (v: number) => Math.round(v * currentScale);

function repo(): any {
  const r = (window as any).repo;
  if (!r) throw new Error('window.repo is not available');
  return r;
}

async function handle(url: Url): Promise<any> {
  const h = await repo().find(url);
  if (typeof h?.whenReady === 'function') await h.whenReady();
  return h;
}

/** A plain-data copy (Automerge docs are proxies / frozen; this is safe to print). */
function plain(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (v == null || typeof v !== 'object') return v;
  if (depth > 40) return '…';
  if (seen.has(v as object)) return '[circular]';
  seen.add(v as object);
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  if (v instanceof Date) return v.toISOString();
  const ctor = (v as any).constructor?.name;
  if (ctor === 'ImmutableString' || ctor === 'RawString') return String((v as any).val ?? v);
  if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = plain((v as any)[k], depth + 1, seen);
  return out;
}

function textOf(content: unknown): string | null {
  if (content == null) return null;
  if (typeof content === 'string') return content;
  if (content instanceof Uint8Array) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
      return null;
    }
  }
  const c = content as any;
  if (typeof c.val === 'string') return c.val;
  if (typeof c.toString === 'function') return String(c.toString());
  return null;
}

// ---- DOM ------------------------------------------------------------------------

/** All elements matching `sel`, including inside open shadow roots. */
function deepQueryAll(sel: string, root: ParentNode = document): Element[] {
  const out: Element[] = [];
  const walk = (r: ParentNode) => {
    for (const el of Array.from(r.querySelectorAll('*'))) {
      if (el.matches(sel)) out.push(el);
      const sr = (el as HTMLElement).shadowRoot;
      if (sr) walk(sr);
    }
  };
  walk(root);
  return out.filter((e) => !isOwnElement(e));
}

function rectImg(el: Element): { x: number; y: number; w: number; h: number } {
  const r = el.getBoundingClientRect();
  return { x: toImage(r.left), y: toImage(r.top), w: toImage(r.width), h: toImage(r.height) };
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
}

const HANDLE_ATTRS = ['doc-url', 'data-doc-url', 'data-ref-url', 'data-edge-url', 'url'];

function viewInfo(el: Element) {
  const attr = (n: string) => el.getAttribute(n) ?? undefined;
  return {
    docUrl: HANDLE_ATTRS.map(attr).find((v) => v && v.startsWith('automerge:')),
    toolId: attr('tool-id') ?? attr('data-tool-id'),
    component: attr('component') ?? undefined,
    tag: el.tagName.toLowerCase(),
    rect: rectImg(el),
  };
}

function composedAncestors(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let e = el; e; ) {
    out.push(e);
    if (e.parentElement) e = e.parentElement;
    else {
      const root = e.getRootNode();
      e = root instanceof ShadowRoot ? root.host : null;
    }
  }
  return out;
}

function describeEl(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
  const attrs = ['doc-url', 'tool-id', 'role', 'aria-label', 'title', 'placeholder', 'type', 'name', 'contenteditable']
    .map((a) => (el.hasAttribute(a) ? ` ${a}=${JSON.stringify(el.getAttribute(a)!.slice(0, 60))}` : ''))
    .join('');
  return `<${el.tagName.toLowerCase()}${id}${cls}${attrs}>`;
}

/** A compact text outline of the DOM inside an element (for when pixels aren't enough). */
function outline(root: Element, maxLines = 120, maxDepth = 14): string {
  const lines: string[] = [];
  const walk = (el: Element, depth: number) => {
    if (lines.length >= maxLines || depth > maxDepth || isOwnElement(el)) return;
    if (!visible(el) && el.tagName !== 'SLOT') return;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(' ')
      .slice(0, 80);
    const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? ` value=${JSON.stringify(el.value.slice(0, 60))}` : '';
    const r = rectImg(el);
    lines.push(`${'  '.repeat(depth)}${describeEl(el)}${value} @${r.x},${r.y} ${r.w}x${r.h}${own ? ` "${own}"` : ''}`);
    const kids = [...Array.from((el as HTMLElement).shadowRoot?.children ?? []), ...Array.from(el.children)];
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);
  if (lines.length >= maxLines) lines.push('… (truncated)');
  return lines.join('\n');
}

// ---- files in pushwork folders -----------------------------------------------------
//
// Two shapes exist. pushwork's default "vfs" root is ONE flat doc:
//   { "@patchwork": { type: "directory" }, lastSyncAt, "src/index.ts": "automerge:…",
//     "dist/index.js": "automerge:…#heads" }   (artifact dirs like dist/ are heads-pinned)
// The older "patchwork-folder" shape nests folder docs: { title, docs: [{ name, type, url }] }.

interface Entry {
  path: string;
  type: string;
  url: Url;
}

async function listFolder(folderUrl: Url, prefix = '', recursive = true, out: Entry[] = [], depth = 0): Promise<Entry[]> {
  const h = await handle(folderUrl);
  const doc = h.doc() as AnyDoc | undefined;
  if (!doc) return out;
  if (Array.isArray(doc.docs)) {
    for (const d of doc.docs as { name: string; type: string; url: Url }[]) {
      const path = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.name === 'node_modules' || d.name === '.git') continue;
      out.push({ path, type: d.type, url: d.url });
      if (recursive && d.type === 'folder' && depth < 12) await listFolder(d.url, path, true, out, depth + 1);
    }
    return out;
  }
  // vfs: flat keys
  for (const [k, v] of Object.entries(doc)) {
    if (typeof v !== 'string' || !v.startsWith('automerge:')) continue;
    if (prefix && !k.startsWith(prefix + '/')) continue;
    out.push({ path: k, type: 'file', url: v });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function resolvePath(folderUrl: Url, path: string): Promise<Entry | null> {
  const root = (await handle(folderUrl)).doc() as AnyDoc | undefined;
  if (root && !Array.isArray(root.docs)) {
    const v = root[path];
    return typeof v === 'string' && v.startsWith('automerge:') ? { path, type: 'file', url: v } : null;
  }
  const parts = path.split('/').filter(Boolean);
  let url = folderUrl;
  let type = 'folder';
  for (let i = 0; i < parts.length; i++) {
    const h = await handle(url);
    const docs = ((h.doc() as AnyDoc | undefined)?.docs ?? []) as { name: string; type: string; url: Url }[];
    const hit = docs.find((d) => d.name === parts[i]);
    if (!hit) return null;
    url = hit.url;
    type = hit.type;
  }
  return { path, type, url };
}

/** Strips heads (`automerge:id#heads`) so we always look at the latest. */
const bare = (u: string) => u.replace(/#.*$/, '');

async function moduleUrls(): Promise<string[]> {
  const acct = (window as any).accountDocHandle;
  const msUrl = acct?.doc?.()?.moduleSettingsUrl;
  if (!msUrl) throw new Error('no accountDoc.moduleSettingsUrl');
  const ms = (await handle(msUrl)).doc() as AnyDoc;
  return ((ms?.modules ?? []) as unknown[])
    .map((m) => (typeof m === 'string' ? m : ((m as any)?.url ?? (m as any)?.importUrl ?? '')))
    .filter(Boolean)
    .map(String);
}

async function packageName(folderUrl: Url): Promise<string | null> {
  try {
    const e = await resolvePath(folderUrl, 'package.json');
    if (!e) return null;
    const t = textOf(((await handle(bare(e.url))).doc() as AnyDoc)?.content);
    return t ? (JSON.parse(t).name ?? null) : null;
  } catch {
    return null;
  }
}

/** A heads-pinned url for the handle's current state. */
function pinnedUrl(h: any): string {
  try {
    const v = h.view?.(h.heads());
    if (v?.url) return v.url;
  } catch {
    /* fall through */
  }
  return h.url;
}

const entryCache = new Map<string, Promise<{ name: string | null; path: string; text: string | null } | null>>();

/** A module's entry file (package.json exports/main), read once per page. */
function entryOf(moduleUrl: Url): Promise<{ name: string | null; path: string; text: string | null } | null> {
  const key = bare(moduleUrl);
  let p = entryCache.get(key);
  if (!p) {
    p = (async () => {
      const pj = await resolvePath(key, 'package.json');
      if (!pj) return null;
      const json = JSON.parse(textOf(((await handle(bare(pj.url))).doc() as AnyDoc)?.content) ?? '{}');
      const ex = json.exports;
      let entry: unknown = typeof ex === 'string' ? ex : ex?.['.'] ?? ex?.import ?? json.module ?? json.main ?? 'index.js';
      if (entry && typeof entry === 'object') entry = (entry as any).import ?? (entry as any).default ?? Object.values(entry as object)[0];
      const path = String(entry).replace(/^\.\//, '');
      const e = await resolvePath(key, path);
      const text = e ? textOf(((await handle(bare(e.url))).doc() as AnyDoc)?.content) : null;
      return { name: json.name ?? null, path, text };
    })().catch(() => null);
    entryCache.set(key, p);
  }
  return p;
}

const TEXT_EXT = /\.(m?[jt]sx?|json|css|html?|md|txt|rs|ya?ml|toml|svg|glsl|wgsl|py)$/i;

// ---- the helper object -------------------------------------------------------------

export const tad = {
  get scale() {
    return currentScale;
  },

  /** The automerge repo. */
  get repo() {
    return repo();
  },

  /** The account doc (plain copy). */
  account(): unknown {
    return plain((window as any).accountDocHandle?.doc?.());
  },

  /**
   * Rendered documents: every visible `<patchwork-view>` (or element carrying a doc
   * url), with docUrl, toolId and its rect in image px. With (x, y) — image px — only
   * those containing that point, innermost first.
   */
  views(x?: number, y?: number): ReturnType<typeof viewInfo>[] {
    if (x != null && y != null) {
      const el = deepElementFromPoint(toScreen(x), toScreen(y));
      return composedAncestors(el)
        .filter((e) => e.tagName === 'PATCHWORK-VIEW' || HANDLE_ATTRS.some((a) => e.getAttribute(a)?.startsWith('automerge:')))
        .map(viewInfo);
    }
    const sel = ['patchwork-view', ...HANDLE_ATTRS.map((a) => `[${a}^="automerge:"]`)].join(',');
    return deepQueryAll(sel).filter(visible).map(viewInfo);
  },

  /** The element at an image point: its ancestry (innermost first) and the docs it belongs to. */
  at(x: number, y: number): { path: string[]; views: ReturnType<typeof viewInfo>[]; text: string } {
    const el = deepElementFromPoint(toScreen(x), toScreen(y));
    const anc = composedAncestors(el);
    return {
      path: anc.slice(0, 12).map(describeEl),
      views: tad.views(x, y),
      text: (el?.textContent ?? '').trim().slice(0, 200),
    };
  },

  /** A text outline of the DOM under the image point (or of the whole page). */
  dom(x?: number, y?: number, maxLines = 120): string {
    let root: Element = document.body;
    if (x != null && y != null) {
      const el = deepElementFromPoint(toScreen(x), toScreen(y));
      const view = composedAncestors(el).find((e) => e.tagName === 'PATCHWORK-VIEW');
      root = view ?? el ?? document.body;
    }
    return outline(root, maxLines);
  },

  /** The focused element (through shadow roots). */
  focused(): string | null {
    const el = deepActiveElement();
    return el ? describeEl(el) : null;
  },

  /** The document at `url` as plain data (latest heads). */
  async doc(url: Url): Promise<unknown> {
    return plain((await handle(bare(url))).doc());
  },

  /** The DocHandle itself (for .change, .on('change'), heads, …). */
  handle,

  /**
   * Changes a document: `fn(doc)` mutates the Automerge proxy as in handle.change.
   * Returns the changed doc as plain data. Everyone viewing it sees this at once.
   */
  async change(url: Url, fn: (doc: AnyDoc) => void, message?: string): Promise<unknown> {
    const h = await handle(bare(url));
    h.change(fn, message ? { message } : undefined);
    return plain(h.doc());
  },

  /** A fresh random UUID (CatColab and others key things by uuid). */
  uuid(): string {
    return crypto.randomUUID();
  },

  // -- plugin source ------------------------------------------------------------------

  /** Every loaded module: its import url and (when it is a pushwork folder) package name. */
  async modules(): Promise<{ url: string; name: string | null }[]> {
    const urls = await moduleUrls();
    return Promise.all(
      urls.map(async (u) => ({ url: u, name: u.startsWith('automerge:') ? await packageName(bare(u)) : null })),
    );
  },

  /** Files of a module folder (recursive), as [{path, type, url}]. */
  async ls(folderUrl: Url, path = ''): Promise<Entry[]> {
    const start = path ? await resolvePath(bare(folderUrl), path) : { url: bare(folderUrl), type: 'folder', path: '' };
    if (!start) throw new Error(`no such path: ${path}`);
    return listFolder(start.url, path);
  },

  /** A file's text. `pathOrFileUrl` is a path inside the folder, or a file doc url. */
  async read(folderUrl: Url, path?: string): Promise<string> {
    let url = bare(folderUrl);
    if (path) {
      const e = await resolvePath(url, path);
      if (!e) throw new Error(`no such file: ${path}`);
      url = e.url;
    }
    const t = textOf(((await handle(bare(url))).doc() as AnyDoc)?.content);
    if (t == null) throw new Error('not a text file');
    return t;
  },

  /**
   * Searches the text files of a module folder for a regex (string or RegExp).
   * Returns matching lines as "path:line: text" (at most `max`).
   */
  async grep(folderUrl: Url, pattern: string | RegExp, max = 60): Promise<string[]> {
    const re = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    const files = (await listFolder(bare(folderUrl))).filter((e) => e.type !== 'folder' && TEXT_EXT.test(e.path));
    const out: string[] = [];
    for (const f of files) {
      let t: string | null = null;
      try {
        t = textOf(((await handle(bare(f.url))).doc() as AnyDoc)?.content);
      } catch {
        continue;
      }
      if (!t || t.length > 3_000_000) continue;
      const lines = t.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          out.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (out.length >= max) return out;
        }
      }
    }
    return out;
  },

  /**
   * Which loaded module defines a plugin/tool id (e.g. a view's toolId): searches every
   * module's package.json name and sources for the id. Returns candidates.
   */
  async findPlugin(id: string): Promise<{ url: string; name: string | null; entry?: string; hits: string[] }[]> {
    const mods = (await tad.modules()).filter((m) => m.url.startsWith('automerge:'));
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`["'\`]${esc}["'\`]`);
    // Fast path: plugin descriptions live in each package's entry module, so look
    // there first (one file per module) before searching everything.
    const fast: { url: string; name: string | null; entry?: string; hits: string[] }[] = [];
    await Promise.all(
      mods.map(async (m) => {
        const e = await entryOf(m.url).catch(() => null);
        if (!e?.text) return;
        const lines = e.text.split('\n');
        const hits: string[] = [];
        for (let i = 0; i < lines.length && hits.length < 5; i++) {
          if (re.test(lines[i])) hits.push(`${e.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
        }
        if (hits.length) fast.push({ url: m.url, name: e.name, entry: e.path, hits });
      }),
    );
    if (fast.length) return fast;
    const out: { url: string; name: string | null; hits: string[] }[] = [];
    for (const m of mods) {
      const hits = await tad.grep(m.url, re, 5).catch(() => []);
      if (hits.length) out.push({ ...m, hits });
    }
    return out;
  },

  /**
   * What is at an image point, from the screen down to the code: the element there,
   * the documents/tools it belongs to (innermost first), and for the innermost tool,
   * the module that provides it with its entry file and file list.
   */
  async whatsHere(x: number, y: number): Promise<unknown> {
    const here = tad.at(x, y);
    const views = here.views;
    const withTool = views.find((v) => v.toolId);
    let tool: unknown = null;
    if (withTool?.toolId) {
      const found = await tad.findPlugin(withTool.toolId).catch((e) => String(e));
      if (Array.isArray(found) && found.length) {
        const m = found[0];
        const files = (await tad.ls(m.url).catch(() => [])).map((f) => f.path);
        tool = {
          id: withTool.toolId,
          module: m.url,
          package: m.name,
          entry: (m as any).entry,
          definedAt: m.hits,
          files: files.length > 200 ? [...files.slice(0, 200), `… ${files.length - 200} more`] : files,
          otherCandidates: found.slice(1).map((c) => c.url),
        };
      } else {
        tool = { id: withTool.toolId, module: null, note: 'no loaded module mentions this id (built in to the frame?)' };
      }
    }
    return { element: here.path.slice(0, 6), text: here.text, views, tool };
  },

  /** Lines `start`..`end` (1-based, inclusive) of a file, numbered — for big files. */
  async lines(moduleUrl: Url, path: string, start = 1, end = start + 299): Promise<string> {
    const t = await tad.read(moduleUrl, path);
    const all = t.split('\n');
    const s0 = Math.max(1, start);
    const e0 = Math.min(all.length, end);
    const body = all.slice(s0 - 1, e0).map((l, i) => `${String(s0 + i).padStart(5)}  ${l}`).join('\n');
    return `${path} lines ${s0}-${e0} of ${all.length}:\n${body}`;
  },

  /**
   * Replaces a file's text in a module folder, then touches the module's root folder
   * so Patchwork reloads it. LIVE: everyone using this plugin gets the change.
   * Only bundleless code takes effect this way — editing `src/` of a vite-built
   * package changes nothing that runs (`dist/` is what is loaded).
   */
  async write(folderUrl: Url, path: string, text: string): Promise<string> {
    const root = bare(folderUrl);
    const e = await resolvePath(root, path);
    if (!e) throw new Error(`no such file: ${path} (creating files isn't supported)`);
    const fh = await handle(bare(e.url));
    fh.change((d: AnyDoc) => {
      const c = d.content;
      if (typeof c === 'string' || c == null) d.content = text;
      else if (c instanceof Uint8Array) d.content = new TextEncoder().encode(text);
      else if (typeof c === 'object' && typeof (c as any).constructor === 'function') d.content = new (c as any).constructor(text);
      else d.content = text;
    });
    const rh = await handle(root);
    rh.change((d: AnyDoc) => {
      // vfs roots pin artifact files (dist/…) to heads: move the pin to the new version.
      if (!Array.isArray(d.docs) && typeof d[path] === 'string' && d[path].includes('#')) d[path] = pinnedUrl(fh);
      // Any change to the root makes Patchwork's ModuleWatcher reload the module.
      if (!Array.isArray(d.docs)) d.lastSyncAt = Date.now();
      else d.lastModified = Date.now();
    });
    return `wrote ${text.length} chars to ${path}; module reload requested`;
  },
};

// ---- eval ------------------------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/** Formats an eval result for the model: strings raw, everything else as JSON-ish. */
export function formatResult(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return v;
  if (typeof v === 'function') return String(v);
  if (v instanceof Element) return describeEl(v);
  try {
    const p = plain(v);
    const s = JSON.stringify(p, null, 1);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/**
 * Evaluates JavaScript in the page with `tad` and `repo` in scope; top-level `await`
 * works. An expression is returned as is; statements need an explicit `return`.
 */
export async function evaluate(source: string): Promise<string> {
  const scope = ['tad', 'repo'];
  const args = [tad, (window as any).repo];
  let fn: (...a: unknown[]) => Promise<unknown>;
  try {
    fn = new AsyncFunction(...scope, `return (\n${source.trim().replace(/;+$/, '')}\n);`);
  } catch {
    fn = new AsyncFunction(...scope, source);
  }
  try {
    const v = await fn(...args);
    return formatResult(v).slice(0, 20000);
  } catch (err) {
    const e = err as Error;
    return `Error: ${e?.message ?? String(err)}${e?.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
  }
}
