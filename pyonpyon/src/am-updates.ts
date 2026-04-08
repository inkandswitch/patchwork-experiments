import { updateText } from '@automerge/automerge-repo';

export function updateObject(obj: Record<string, any>, newValues: Record<string, any>) {
  for (const key of Object.keys(newValues)) {
    updateProperty(obj, key, newValues[key]);
  }

  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(newValues, key)) {
      delete obj[key];
    }
  }
}

export function updateArray(arr: any[], newValues: any[]) {
  for (let idx = 0; idx < arr.length && idx < newValues.length; idx++) {
    updateProperty(arr, idx, newValues[idx]);
  }
  if (arr.length > newValues.length) {
    arr.splice(newValues.length, arr.length - newValues.length);
  } else if (arr.length < newValues.length) {
    arr.splice(arr.length, 0, ...newValues.slice(arr.length));
  }
}

function updateProperty<K extends string | number>(obj: Record<K, any>, key: K, newValue: any) {
  const oldValue = obj[key];
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    updateArray(oldValue, newValue);
  } else if (oldValue && typeof oldValue === 'object' && newValue && typeof newValue === 'object') {
    // the typecast below is needed b/c TS thinks oldValue could be null (wrong!!)
    updateObject(oldValue as object, newValue);
  } else if (typeof obj[key] === 'string' && typeof newValue === 'string') {
    updateText(obj, [key], newValue);
  } else if (obj[key] !== newValue) {
    obj[key] = structuredClone(newValue);
  }
}
