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
