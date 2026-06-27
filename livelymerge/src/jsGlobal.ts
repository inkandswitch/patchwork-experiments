import type { Obj } from './types';

export function isJsGlobalObj(obj: Obj): boolean {
  return typeof obj.$jsGlobal === 'string';
}

export function getJsGlobalTarget(obj: Obj): unknown {
  if (!obj.$jsGlobal) return undefined;
  return (globalThis as Record<string, unknown>)[obj.$jsGlobal];
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
  if (typeof value === 'function') {
    return value.bind(target);
  }
  return value;
}
