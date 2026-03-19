import { updateText } from '@automerge/automerge';

const REF_PARAM = 'refPath';

/**
 * Build a URL string for a doc handle + JSON path. Preserves an existing `#fragment` (e.g. heads)
 * and adds `refPath` to the fragment query.
 */
export function encodeRefToURL(docUrl, path) {
  const pathJson = JSON.stringify(path);
  const hashIndex = docUrl.indexOf('#');
  if (hashIndex === -1) {
    return `${docUrl}#${REF_PARAM}=${encodeURIComponent(pathJson)}`;
  }
  const beforeHash = docUrl.slice(0, hashIndex);
  const frag = docUrl.slice(hashIndex + 1);
  const params = new URLSearchParams(frag);
  params.set(REF_PARAM, pathJson);
  return `${beforeHash}#${params.toString()}`;
}

/**
 * Parse a URL produced by {@link encodeRefToURL} or {@link Ref#toURL}.
 * @returns {{ docUrl: string, path: Array<string|number> }}
 */
export function parseRefURL(urlString) {
  const hashIndex = urlString.indexOf('#');
  if (hashIndex === -1) {
    return { docUrl: urlString, path: [] };
  }
  const beforeHash = urlString.slice(0, hashIndex);
  const frag = urlString.slice(hashIndex + 1);
  const params = new URLSearchParams(frag);
  const raw = params.get(REF_PARAM);
  params.delete(REF_PARAM);
  const rest = params.toString();
  const docUrl = rest ? `${beforeHash}#${rest}` : beforeHash;
  const path = raw != null && raw !== '' ? JSON.parse(raw) : [];
  return { docUrl, path };
}

/**
 * Resolve a serialized ref URL with `repo.find(docUrl)` and return a ref at `path`.
 * @param {import('@automerge/automerge-repo').Repo} repo
 * @param {string} urlString
 * @returns {Promise<ReturnType<typeof createRef>>}
 */
export async function findRef(repo, urlString) {
  const { docUrl, path } = parseRefURL(urlString);
  const handle = await repo.find(docUrl);
  return makeRef(handle, path);
}

/**
 * @param {import('@automerge/automerge-repo').DocHandle<any>} handle
 */
export function createRef(handle) {
  return makeRef(handle, []);
}

createRef.find = findRef;

function makeRef(handle, path) {
  return {
    ref(...segments) {
      return makeRef(handle, path.concat(segments));
    },

    get() {
      const doc = handle.doc();
      return getAtPath(doc, path);
    },

    toURL() {
      return encodeRefToURL(handle.url, path);
    },

    change(fn) {
      if (typeof fn !== 'function') {
        throw new TypeError('ref.change expects a function');
      }
      handle.change((doc) => {
        if (fn.length === 0) {
          if (path.length === 0) {
            throw new Error('createRef: cannot replace root document with change(() => value)');
          }
          const prev = getAtPath(doc, path);
          const next = fn();
          if (typeof next === 'string' && typeof prev === 'string') {
            updateText(doc, path, next);
          } else {
            setAtPath(doc, path, next);
          }
        } else {
          fn(getAtPath(doc, path));
        }
      });
    },
  };
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
  if (path.length === 0) {
    throw new Error('setAtPath: empty path');
  }
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    cur = cur[seg];
    if (cur == null) {
      throw new Error(`setAtPath: missing segment at ${String(seg)}`);
    }
  }
  const last = path[path.length - 1];
  cur[last] = value;
}
