// A stand-in for Patchwork, for working on the tool on its own: `pnpm dev`.
// It makes an Automerge document in memory (nothing is synced or saved) and mounts the
// tool on it, the same way Patchwork would. ?example=N starts from the N-th example.

import { Repo } from '@automerge/automerge-repo';
import { AmbsheetDatatype, type AmbsheetDoc } from '../src/datatype';
import { examples } from '../src/examples';
import { posOf } from '../src/lang/values';
import AmbsheetTool from '../src/tool';

const repo = new Repo({ network: [] });
const handle = repo.create<AmbsheetDoc>();
handle.change((doc) => AmbsheetDatatype.init(doc));

const example = examples[Number(new URLSearchParams(location.search).get('example') ?? -1)];
if (example) {
  handle.change((doc) => {
    for (const [addr, text] of Object.entries(example.cells)) {
      const { row, col } = posOf(addr);
      doc.data[row][col] = text;
    }
  });
}

const cleanup = AmbsheetTool(handle as any, document.getElementById('root')!);
Object.assign(window, { repo, handle, cleanup });
