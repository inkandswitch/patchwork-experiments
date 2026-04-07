/**
 * Type declarations for the LLM script execution environment.
 *
 * Scripts run inside an async function with a `with` scope that exposes
 * `element`, `filesystem`, `repo`, and `console` as top-level bindings.
 */

// ---------------------------------------------------------------------------
// Filesystem
// ---------------------------------------------------------------------------

type DocLink = {
  name: string;
  type: string;
  url: string;
};

type Filesystem = {
  /** Read a file as text. */
  readFile(path: string): Promise<string>;
  /** Write or overwrite a text file. */
  writeFile(path: string, content: string): Promise<void>;
  /** Create a folder and any missing parents. */
  createFolder(path: string): Promise<void>;
  /** List files and subfolders in a directory. */
  listEntries(path?: string): Promise<DocLink[]>;
  /** Get the service-worker URL for a file (sync). */
  getUrlOfFile(path?: string): string;
  /** Dynamically import a JS module by filesystem path. */
  import(path: string): Promise<any>;
};

// ---------------------------------------------------------------------------
// Ref (document reference bound to a path inside an automerge document)
// ---------------------------------------------------------------------------

type Ref<T = any> = {
  /** Narrow to a sub-path within the document. */
  at(...segments: (string | number)[]): Ref;
  /** The automerge URL of this ref (includes path encoding). */
  readonly url: string;
  /** Return a plain JS snapshot of the value at this path. */
  value(): T;
  /**
   * Mutate the document at this path.
   *
   * Two call signatures:
   * - `ref.change(current => { current.x = 1; })` — mutate in place
   * - `ref.at('key').change(() => newValue)` — replace the value
   */
  change(fn: ((current: T) => void) | (() => T)): void;
};

// ---------------------------------------------------------------------------
// DocHandle (automerge-repo document handle)
// ---------------------------------------------------------------------------

type DocHandle<T = unknown> = {
  /** Mutate the document. `fn` receives a mutable proxy. */
  change(fn: (doc: T) => void): void;
  /** Return a read-only snapshot of the current document. */
  doc(): T;
  /** The automerge URL of this document. */
  readonly url: string;
};

// ---------------------------------------------------------------------------
// Repo (automerge-repo)
// ---------------------------------------------------------------------------

type Repo = {
  /** Create a new document with an initial value (sync). Returns a DocHandle. */
  create<T>(initialValue?: T): DocHandle<T>;
  /** Look up an existing document by URL (async — must `await`). */
  find<T>(automergeUrl: string): Promise<DocHandle<T>>;
};

// ---------------------------------------------------------------------------
// Element (the outermost ancestor ref-view frame)
// ---------------------------------------------------------------------------

type RefElement = HTMLElement & {
  /** The Ref bound to this element's document/path. */
  readonly ref: Ref;
  /** The parent ref-view element, or null for the root. */
  readonly parent: RefElement | null;
  /** Filesystem scoped to this element's tool root. */
  readonly filesystem: Filesystem;
};

// ---------------------------------------------------------------------------
// Console (captured — output is collected and returned to the LLM)
// ---------------------------------------------------------------------------

type CapturedConsole = {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
};

// ---------------------------------------------------------------------------
// Global bindings available in every <script> block
// ---------------------------------------------------------------------------

declare const element: RefElement;
declare const filesystem: Filesystem;
declare const repo: Repo;
declare const console: CapturedConsole;
