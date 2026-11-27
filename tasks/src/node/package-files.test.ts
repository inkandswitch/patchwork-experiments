// @vitest-environment node
//
// A package's files on disk (package-files.ts), from a package made here in a
// Repo with no network: `packageText` reads one file and writes nothing, and
// `materialise` writes only the top-level directory of the file wanted. This
// is what a Node host does to describe a package (importPackage in
// webworker-lib.node.ts): package.json read, the entry's directory written.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { initSubduction, Repo } from '@automerge/automerge-repo';
import { parseAutomergeImport } from '../import-url';
import { materialise, packageText } from './package-files';

await initSubduction();

const dir = mkdtempSync(join(tmpdir(), 'tasks-package-files-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const filesUnder = (root: string): string[] =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();

describe('a package on disk', () => {
  const repo = new Repo({ network: [] } as any);
  const file = (content: string) => repo.create({ content }).url;
  const folder = repo.create({
    'package.json': file('{ "name": "made-up", "type": "module", "exports": "./dist/index.js" }'),
    'dist/index.js': file('export const plugins = [];'),
    'src/not-needed.txt': file('x'.repeat(100_000)),
    'docs/readme.md': file('# made up'),
  });
  const at = (path: string) => parseAutomergeImport(`/${encodeURIComponent(folder.url)}/${path}`)!;

  it('reads package.json without writing anything', async () => {
    const codeDir = join(dir, 'read');
    expect(JSON.parse(await packageText(repo as any, at('package.json'))).exports).toBe('./dist/index.js');
    expect(() => readdirSync(codeDir)).toThrow();
    await expect(packageText(repo as any, at('nowhere.json'))).rejects.toThrow('there is no nowhere.json');
  });

  it("writes only the entry's directory, and a package.json that says its modules are ES modules", async () => {
    const codeDir = join(dir, 'entry');
    const entry = await materialise(repo as any, at('dist/index.js'), codeDir);
    expect(entry.startsWith(codeDir)).toBe(true);
    expect(filesUnder(codeDir).map((path) => path.split('/').slice(2).join('/'))).toEqual(['dist/index.js', 'package.json']);
  });
});
