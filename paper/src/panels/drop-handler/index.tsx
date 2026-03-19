import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import type { HasPatchworkMetadata, UnixFileEntry } from '@inkandswitch/patchwork-filesystem';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { getPaperViewport } from '../../paper/get-paper-viewport.js';
import type { PaperDoc, PaperDragEventDetail, BaseShape } from '../../paper/types.js';
import type { PatchworkViewElement } from '@inkandswitch/patchwork-elements';

type FileDoc = UnixFileEntry & HasPatchworkMetadata;

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const GAP = 20;

// ─── Entry point ──────────────────────────────────────────────────────────────

function dropHandlerTool(handle: DocHandle<PaperDoc>, element: PatchworkViewElement): () => void {
  return render(() => <DropHandlerLayer handle={handle} element={element} />, element);
}

// ─── Drop handler layer ───────────────────────────────────────────────────────

function DropHandlerLayer(props: { handle: DocHandle<PaperDoc>; element: PatchworkViewElement }) {
  onMount(() => {
    const viewport = getPaperViewport(props.element);
    if (!viewport) return;
    viewport.addEventListener('paper:drop', (e) =>
      onDrop(e as CustomEvent<PaperDragEventDetail>).catch(console.error),
    );
  });

  async function onDrop(e: CustomEvent<PaperDragEventDetail>) {
    const { canvasX, canvasY, patchworkUrls, dataTransfer } = e.detail;

    const urlsToEmbed: AutomergeUrl[] = patchworkUrls ? [...(patchworkUrls as AutomergeUrl[])] : [];

    // Create a file document for each dropped OS file
    const files = dataTransfer?.files ? Array.from(dataTransfer.files) : [];
    for (const file of files) {
      const mimeType = file.type || 'application/octet-stream';
      const isText = mimeType.startsWith('text/') || mimeType === 'application/json';
      const content = isText ? await file.text() : new Uint8Array(await file.arrayBuffer());
      const ext = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : '';
      const fileHandle = props.element.repo.create<FileDoc>();
      fileHandle.change((d) => {
        d['@patchwork'] = { type: 'file' };
        d.content = content;
        d.mimeType = mimeType;
        d.extension = ext;
        d.name = file.name;
      });
      urlsToEmbed.push(fileHandle.url);
    }

    if (urlsToEmbed.length === 0) return;

    props.handle.change((d) => {
      const maxZIndex = Object.values(d.shapes).reduce(
        (max, s) => Math.max(max, (s as BaseShape).zIndex),
        -1,
      );
      for (let i = 0; i < urlsToEmbed.length; i++) {
        const id = crypto.randomUUID();
        d.shapes[id] = {
          id,
          type: 'embed',
          x: canvasX + i * (DEFAULT_WIDTH + GAP),
          y: canvasY,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          zIndex: maxZIndex + 1 + i,
          docUrl: urlsToEmbed[i],
        };
      }
    });
  }
  return null;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-drop-handler',
    name: 'Drop Handler',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return dropHandlerTool;
    },
  },
];
