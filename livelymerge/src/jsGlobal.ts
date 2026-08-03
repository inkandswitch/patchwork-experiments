import type { Obj } from './types';

export function isJsGlobalObj(obj: Obj): boolean {
  return typeof obj.$jsGlobal === 'string';
}

export function getJsGlobalTarget(obj: Obj): unknown {
  if (!obj.$jsGlobal) return undefined;
  return (globalThis as Record<string, unknown>)[obj.$jsGlobal];
}

/** True when a native global value can be proxied (objects and functions). */
export function isJsGlobalTarget(value: unknown): value is object | ((...args: never[]) => unknown) {
  return value != null && (typeof value === 'object' || typeof value === 'function');
}

export function toJsCallArgs(args: unknown[]): unknown[] {
  return args.map(toJsValue);
}

/** Convert an LM value to something storable on a native JS object. */
export function toJsValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && (value as { $isProxy?: boolean }).$isProxy) {
    const unwrapped = (value as { $unwrapped: Obj }).$unwrapped;
    if (isJsGlobalObj(unwrapped)) {
      return getJsGlobalTarget(unwrapped);
    }
  }
  return value;
}

export function readJsGlobalProperty(target: object, prop: PropertyKey): unknown {
  const value = Reflect.get(target, prop);
  // LM fun proxies (e.g. assigned onto the console wrapper by newdefs' transcript
  // mirror) don't expose `bind`; only native functions need the receiver pinned.
  if (typeof value === 'function' && !(value as { $isProxy?: boolean }).$isProxy) {
    return value.bind(target);
  }
  return value;
}
