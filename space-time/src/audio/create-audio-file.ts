import type { AutomergeUrl } from '@automerge/automerge-repo';

export async function createAudioFile(blob: Blob, mimeType: string): Promise<AutomergeUrl> {
  const repo = window.repo;
  if (!repo) throw new Error('Automerge repo is not available');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = mimeType.includes('webm')
    ? 'webm'
    : mimeType.includes('ogg')
      ? 'ogg'
      : mimeType.includes('mp4') || mimeType.includes('aac')
        ? 'm4a'
        : 'wav';
  const fileHandle = await repo.create2({
    content: bytes,
    extension: ext,
    mimeType,
    name: `recording-${Date.now()}.${ext}`,
    '@patchwork': { type: 'file' },
  });

  return fileHandle.url;
}
