import type * as AutomergeModule from '@automerge/automerge';

export type Automerge = typeof AutomergeModule;

/** The global constructors of the window Automerge was loaded in. */
export type Realm = {
  Object: ObjectConstructor;
  Array: ArrayConstructor;
  Uint8Array: Uint8ArrayConstructor;
};

let current: Automerge | null = null;
let currentRealm: Realm = globalThis;

/**
 * The Automerge module must be the same instance the documents were created
 * with (Patchwork's), so it is injected instead of imported. Automerge only
 * accepts objects from its own window (it checks `instanceof Object`), so
 * when it lives in a parent frame, pass that frame as `realm`.
 */
export function setAutomerge(module: Automerge, realm: Realm = globalThis): void {
  current = module;
  currentRealm = realm;
}

export function automerge(): Automerge {
  if (!current) {
    throw new Error('Automerge has not been provided, call setAutomerge first');
  }
  return current;
}

export function realm(): Realm {
  return currentRealm;
}

/** Whether an Automerge module has been provided. */
export function hasAutomerge(): boolean {
  return current !== null;
}

const IMMUTABLE_STRING = Symbol.for('_am_immutableString');

/**
 * What this package needs of Automerge, for a realm that can't import it (a
 * worker with no importmap). Automerge recognises an immutable string by a
 * registered symbol, not by its class, so this one is stored as one; a
 * splice is a whole-string assignment, which for outputs nobody co-edits
 * gives the same document text.
 */
export function automergeStandIn(): Automerge {
  class ImmutableString {
    val: string;
    constructor(val: string) {
      (this as any)[IMMUTABLE_STRING] = true;
      this.val = val;
    }
    toString() {
      return this.val;
    }
    toJSON() {
      return this.val;
    }
    static [Symbol.hasInstance](value: unknown) {
      return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, IMMUTABLE_STRING);
    }
  }
  const splice = (doc: any, path: (string | number)[], index: number, remove: number, insert = '') => {
    let parent = doc;
    for (const key of path.slice(0, -1)) parent = parent[key];
    const key = path[path.length - 1];
    const text = String(parent[key] ?? '');
    parent[key] = text.slice(0, index) + insert + text.slice(index + remove);
  };
  return { ImmutableString, splice } as unknown as Automerge;
}
