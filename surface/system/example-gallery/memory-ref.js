let nextId = 0;

export function createMemoryRef(initialData) {
  const rootId = `memory:${nextId++}`;
  const root = { data: structuredClone(initialData) };
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn();
  }

  function reset(newData) {
    root.data = structuredClone(newData);
    notify();
  }

  function makeRef(path, schema) {
    return {
      get url() {
        if (!path.length) return rootId;
        return rootId + '/' + path.map(encodeURIComponent).join('/');
      },

      value() {
        const raw = getAtPath(root.data, path);
        if (schema) {
          if (raw === undefined) {
            const initial = schema.init();
            this.change(() => initial);
            return initial;
          }
          return schema.parse(raw);
        }
        return raw;
      },

      change(fn) {
        if (fn.length === 0) {
          if (path.length === 0) {
            throw new Error('MemoryRef.change: cannot replace root with change(() => value)');
          }
          setAtPath(root.data, path, fn());
        } else {
          fn(getAtPath(root.data, path));
        }
        notify();
      },

      subscribe(fn) {
        const handler = () => {
          try { fn(this.value()); } catch { /* ignore */ }
        };
        handler();
        listeners.add(handler);
        return () => { listeners.delete(handler); };
      },

      at(...segments) {
        return makeRef(path.concat(segments), undefined);
      },

      as(newSchema) {
        return makeRef(path, newSchema);
      },
    };
  }

  const ref = makeRef([], undefined);
  ref.reset = reset;
  return ref;
}

function getAtPath(obj, path) {
  let cur = obj;
  for (const seg of path) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function setAtPath(root, path, value) {
  if (path.length === 0) throw new Error('setAtPath: empty path');
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    cur = cur[path[i]];
    if (cur == null) throw new Error(`setAtPath: missing segment at ${path[i]}`);
  }
  cur[path[path.length - 1]] = value;
}
