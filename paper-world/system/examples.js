/**
 * @typedef {{ name: string, description: string, tool: string, value: object, source: string, package: string, tags: string[], create?: string }} Example
 * @typedef {{ value(): Example[], subscribe(fn: (value: Example[]) => void): () => void }} ExampleSubscribable
 * @typedef {{ readFile: (path: string) => Promise<string>, watch: (pattern: string, fn: (matches: string[]) => void) => () => void }} ExampleFilesystem
 */

const DEFAULT_PREVIEW_WIDTH = 300;
const DEFAULT_PREVIEW_HEIGHT = 200;

/**
 * @param {ExampleFilesystem} filesystem
 * @returns {{ all(): ExampleSubscribable }}
 */
export function createExamples(filesystem) {
  let current = [];
  const listeners = new Set();

  filesystem.watch('**/examples.md', (matches) => {
    void loadExamples(matches);
  });

  async function loadExamples(matches) {
    try {
      const next = [];
      for (const path of matches) {
        try {
          const raw = await filesystem.readFile(path);
          next.push(...parseExamples(raw, path));
        } catch {
          // skip unreadable files
        }
      }
      if (!examplesEqual(current, next)) {
        current = next;
        for (const fn of listeners) fn(current);
      }
    } catch {
      // read failures are silent; next change will retry
    }
  }

  function all() {
    return {
      value() {
        return current;
      },
      subscribe(fn) {
        fn(current);
        listeners.add(fn);
        return () => { listeners.delete(fn); };
      },
    };
  }

  return { all };
}

/**
 * @param {string} markdown
 * @param {string} sourcePath
 * @returns {Example[]}
 */
export function parseExamples(markdown, sourcePath) {
  const lines = String(markdown).split(/\r?\n/);
  const examples = [];
  let packageName = packageNameFromPath(sourcePath);
  let heading = '';
  let descriptionLines = [];
  let inFence = false;
  let fenceLines = [];

  for (const line of lines) {
    if (inFence) {
      if (line.trimEnd() === '```') {
        const json = fenceLines.join('\n');
        const example = tryParseExample(json, heading, descriptionLines.join('\n').trim(), sourcePath, packageName);
        if (example) examples.push(example);
        inFence = false;
        fenceLines = [];
      } else {
        fenceLines.push(line);
      }
      continue;
    }

    const h1Match = /^#\s+(.+)$/.exec(line);
    if (h1Match) {
      packageName = h1Match[1].trim();
      continue;
    }

    const headingMatch = /^##\s+(.+)$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      descriptionLines = [];
      continue;
    }

    if (/^```json\s*$/.test(line)) {
      inFence = true;
      fenceLines = [];
      continue;
    }

    if (heading && line.trim() !== '') {
      descriptionLines.push(line);
    }
  }

  return examples;
}

/**
 * @param {string} json
 * @param {string} name
 * @param {string} description
 * @param {string} source
 * @param {string} packageName
 * @returns {Example | null}
 */
function tryParseExample(json, name, description, source, packageName) {
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.tool === 'string' &&
      parsed.value !== undefined &&
      typeof parsed.value === 'object' &&
      parsed.value !== null
    ) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === 'string') : [];
      const example = { name: name || 'Untitled', description, tool: parsed.tool, value: parsed.value, source, package: packageName, tags };
      if (typeof parsed.create === 'string') example.create = parsed.create;
      return example;
    }
  } catch {
    // not valid JSON or missing required keys
  }
  return null;
}

function packageNameFromPath(sourcePath) {
  const parts = sourcePath.replace(/\\/g, '/').split('/');
  const idx = parts.lastIndexOf('examples.md');
  if (idx > 0) return parts[idx - 1];
  return parts[parts.length - 1] || 'unknown';
}

/**
 * @param {Example[]} a
 * @param {Example[]} b
 * @returns {boolean}
 */
function examplesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].tool !== b[i].tool || a[i].source !== b[i].source) {
      return false;
    }
  }
  return true;
}

/**
 * @param {Example} example
 * @returns {{ width: number, height: number }}
 */
export function getExamplePreviewSize(example) {
  const exWidth = typeof example?.width === 'number' ? example.width : undefined;
  const exHeight = typeof example?.height === 'number' ? example.height : undefined;
  const valWidth = typeof example?.value?.width === 'number' ? example.value.width : undefined;
  const valHeight = typeof example?.value?.height === 'number' ? example.value.height : undefined;
  return {
    width: exWidth ?? valWidth ?? DEFAULT_PREVIEW_WIDTH,
    height: exHeight ?? valHeight ?? DEFAULT_PREVIEW_HEIGHT,
  };
}
