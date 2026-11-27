import { describe, expect, it } from 'vitest';
import { inSamePackage, onOrigin, parseAutomergeImport } from './import-url';

const ID = '2KYqboWHPS5rvWsheoLnHgFvE7ou';
const HEADS = '2iYYnqERhPWhH9VN5HunnB5bzATxTBYAWDBdnS4CjKpbjmjVXU';
const pinned = `https://patchwork.example/automerge%3A${ID}%23${HEADS}/dist/tasks/wait.js`;

describe('reading an import URL', () => {
  it('finds the package, its heads and the file in a service worker URL', () => {
    expect(parseAutomergeImport(pinned)).toEqual({
      docUrl: `automerge:${ID}#${HEADS}`,
      packageUrl: `automerge:${ID}`,
      heads: HEADS,
      path: 'dist/tasks/wait.js',
      search: '',
    });
  });

  it('reads one with no heads, one with no origin, and one with a query, the same way', () => {
    expect(parseAutomergeImport(`https://x.example/automerge%3A${ID}/a/b.js`)).toMatchObject({
      docUrl: `automerge:${ID}`,
      heads: null,
      path: 'a/b.js',
    });
    expect(parseAutomergeImport(`/automerge%3A${ID}%23${HEADS}/dist/t.js`)).toMatchObject({
      packageUrl: `automerge:${ID}`,
      heads: HEADS,
      path: 'dist/t.js',
    });
    expect(parseAutomergeImport(`${pinned}?retry=1`)).toMatchObject({
      path: 'dist/tasks/wait.js',
      search: '?retry=1',
    });
  });

  it('whatever the origin, the package is the same', () => {
    expect(parseAutomergeImport(pinned)?.packageUrl).toBe(`automerge:${ID}`);
    expect(parseAutomergeImport(pinned.replace('patchwork.example', 'elsewhere.example:8080'))?.packageUrl).toBe(`automerge:${ID}`);
  });

  it('is in no package when it is anything else', () => {
    for (const url of [
      'data:text/javascript,export default 1',
      'https://cdn.example/lib/index.js',
      `https://x.example/automerge%3A${ID}`, // a package, but no file
      `https://x.example/automerge%3A${ID}/`,
      'https://x.example/automerge%3Anot-an-id/x.js',
      `https://x.example/%E0%A4%A/x.js`, // not decodable
      `file:///automerge%3A${ID}/x.js`,
      `automerge:${ID}`,
      '',
    ]) {
      expect(parseAutomergeImport(url), url).toBeNull();
    }
  });
});

describe('moving an import to the site a worker is on', () => {
  it('rewrites the origin of code in automerge, and gives one to a URL that had none', () => {
    const here = 'https://here.example';
    const want = `${here}/automerge%3A${ID}%23${HEADS}/dist/tasks/wait.js`;
    expect(onOrigin(pinned, here)).toBe(want);
    expect(onOrigin(`/automerge%3A${ID}%23${HEADS}/dist/tasks/wait.js`, here)).toBe(want);
    expect(onOrigin(`${pinned}?retry=1`, here)).toBe(`${want}?retry=1`);
    expect(onOrigin(want, here)).toBe(want);
  });

  it('leaves anything else alone', () => {
    const data = 'data:text/javascript,export default 1';
    expect(onOrigin(data, 'https://here.example')).toBe(data);
    expect(onOrigin('https://cdn.example/x.js', 'https://here.example')).toBe('https://cdn.example/x.js');
  });

  it("names another file in a module's own package, with no origin", () => {
    const from = `https://patchwork.example/automerge%3A${ID}%23${HEADS}/dist/assets/chunk-abc.js`;
    const made = inSamePackage(from, 'dist/tasks/wait.js')!;
    expect(made).toBe(`/automerge%3A${ID}%23${HEADS}/dist/tasks/wait.js`);
    expect(parseAutomergeImport(made)).toMatchObject({ heads: HEADS, path: 'dist/tasks/wait.js' });
    expect(inSamePackage('http://localhost:5173/src/x.ts', 'dist/tasks/wait.js')).toBeNull();
  });
});
