// What a task's code finds when it imports by bare name in a Node run thread.
//
// In a browser, a task's bare imports are resolved by the page's import map,
// to the very modules the run worker's own Repo is made from. Here they are
// resolved by this file, to the same end: `@automerge/automerge`,
// `@automerge/automerge-repo` and the `/slim` of each are the modules this
// thread's Repo (`@automerge/automerge-repo-node`, see webworker-lib.node.ts)
// is made from and uses. Code that appends to a text with Automerge's
// `splice` then runs unchanged on any device. It has to be the same module
// instance, not an equal copy: a second copy of Automerge has its own wasm,
// which cannot operate on documents the first one made.
//
// Which code is a task's is known from how it came in, not from where it is
// on disk: what `importTask` imports, and every module that imports in turn
// (a package's copy given with --local may be the very directory this host
// runs from). For everything else, the host's own code and the Repo among it,
// resolution is Node's own, untouched.
//
// Code that travelled with a task (fetched from automerge, or a data: URL)
// has no node_modules beside it, so the shared Automerge modules and Node's
// own modules are all it can import by bare name; any other bare name fails
// with an error that says so. Code of a package installed on this machine
// (--local) imports its other dependencies from its own node_modules, as any
// program there does, and gets the shared Automerge modules too, as do those
// dependencies themselves.
//
// The hooks are Node's synchronous, in-thread module customization
// (`module.registerHooks`): they apply to the thread that registers them and
// to no other, to `import()` of file: and data: URLs alike, and need no
// separate hooks module or hooks thread, as `module.register` would.

import * as nodeModule from 'node:module';

/** The names task code may import by bare name and gets this thread's own copies of. */
export const SHARED = [
  '@automerge/automerge',
  '@automerge/automerge/slim',
  '@automerge/automerge-repo',
  '@automerge/automerge-repo/slim',
] as const;

/**
 * Where a task's code came from: `carried` with the task (fetched from
 * automerge, or a data: URL), or `installed` on this machine with its
 * dependencies beside it (--local).
 */
export type TaskCode = 'carried' | 'installed';

interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
  importAttributes?: Record<string, string>;
}
interface Resolved {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: ResolveContext) => Resolved;
interface ModuleHooks {
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): Resolved;
}
// Node's own types here predate registerHooks.
const { registerHooks, isBuiltin } = nodeModule as unknown as {
  registerHooks(hooks: ModuleHooks): unknown;
  isBuiltin(specifier: string): boolean;
};

/** By the url of each module of task code loaded in this thread, where that code came from. */
const taskModules = new Map<string, TaskCode>();
/** What `importTask` is importing now, by the specifier it gave `import()`. */
const importing = new Map<string, TaskCode>();
/** Each shared name, resolved once when the hooks are registered: the same url every time. */
const shared = new Map<string, string>();
let registered = false;
/** True only while `shareAutomerge` resolves the shared names. */
let resolvingShared = false;

/** Whether a specifier names a package rather than a path or a URL. */
const isBare = (specifier: string) =>
  !/^(\.{0,2}\/|#)/.test(specifier) && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier);

/** The error a task's code gets for a bare name it cannot import here. */
export const unshared = (specifier: string) =>
  new Error(
    `a task's code on a Node host imports by bare name only ${SHARED.join(', ')} (this host's own copies) ` +
      `and Node's built-in modules, so it cannot import "${specifier}"`,
  );

/**
 * Registers the hooks for this thread, once, before any task's code is
 * imported. The shared names are resolved as the Repo's own package resolves
 * them, so the Automerge a task gets is the one that Repo uses, not another
 * copy elsewhere in node_modules.
 */
export function shareAutomerge(): void {
  if (registered) {
    return;
  }
  if (typeof registerHooks !== 'function') {
    throw new Error(`a Node host runs tasks on Node 22.15 or later, which has module.registerHooks; this is ${process.version}`);
  }
  registered = true;
  const repoUrl = import.meta.resolve('@automerge/automerge-repo-node');

  registerHooks({
    resolve(specifier, context, next) {
      if (resolvingShared) {
        // The Repo's own package is `@automerge/automerge-repo` by name, and
        // its modules import Automerge as ES modules: resolved from inside
        // it, as an import, these are the files its own imports were.
        const url =
          specifier === '@automerge/automerge-repo' ? repoUrl : next(specifier, { ...context, parentURL: repoUrl }).url;
        shared.set(specifier, url);
        return { url, shortCircuit: true };
      }
      const from = context.parentURL === undefined ? undefined : taskModules.get(context.parentURL);
      if (from === undefined) {
        const resolved = next(specifier, context);
        const code = importing.get(specifier);
        if (code) {
          taskModules.set(resolved.url, code);
        }
        return resolved;
      }
      const url = shared.get(specifier);
      if (url) {
        return { url, shortCircuit: true };
      }
      if (from === 'carried' && isBare(specifier) && !isBuiltin(specifier)) {
        throw unshared(specifier);
      }
      const resolved = next(specifier, context);
      if (!resolved.url.startsWith('node:')) {
        taskModules.set(resolved.url, from);
      }
      return resolved;
    },
  });

  // All of them here, once, as ES imports from inside the Repo's package, and
  // not when a task first asks: a task's require() of one would be resolved
  // by CommonJS rules, which take no other parent and find whatever copy is
  // beside the module that requires it.
  resolvingShared = true;
  try {
    for (const specifier of SHARED) {
      import.meta.resolve(specifier);
    }
  } finally {
    resolvingShared = false;
  }
  if (shared.size !== SHARED.length) {
    throw new Error(`this thread could not resolve ${SHARED.filter((s) => !shared.has(s)).join(', ')} from its Repo's package`);
  }
}

/**
 * Imports a task's code (a file: or data: URL) as task code: what it imports
 * by bare name is resolved as this file's header says. `shareAutomerge` must
 * have been called in this thread first.
 */
export async function importTask(url: string, code: TaskCode): Promise<any> {
  if (!registered) {
    throw new Error("a task's code is imported only once the thread shares its Automerge (shareAutomerge)");
  }
  importing.set(url, code);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    importing.delete(url);
  }
}
