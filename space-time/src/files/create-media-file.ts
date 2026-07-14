import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Source } from '../types';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/ogg': 'ogv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/webm': 'webm',
};

function extensionForFile(file: File): string {
  if (MIME_TO_EXT[file.type]) return MIME_TO_EXT[file.type];
  const fromName = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  return file.type.split('/')[1] || 'bin';
}

function mediaTypeForMime(mimeType: string | undefined): Source['type'] | null {
  if (!mimeType) return null;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

export function mediaTypeForFile(file: File): Source['type'] | null {
  return mediaTypeForMime(file.type);
}

export type CreatedMediaFile = {
  url: AutomergeUrl;
  type: Source['type'];
  name: string;
  mimeType: string;
};

/**
 * Store a dropped/pasted media file as a Patchwork file document and return a
 * Source descriptor referencing it via an `automerge:` URL.
 */
export async function createMediaFile(file: File): Promise<CreatedMediaFile | null> {
  const type = mediaTypeForFile(file);
  if (!type) return null;

  const repo = window.repo;
  if (!repo) throw new Error('Automerge repo is not available');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionForFile(file);
  const mimeType = file.type || `${type}/${ext}`;
  const name = file.name || `${type}-${Date.now()}.${ext}`;

  const fileHandle = await repo.create2({
    content: bytes,
    extension: ext,
    mimeType,
    name,
    '@patchwork': { type: 'file' },
  });

  return { url: fileHandle.url, type, name, mimeType };
}

type PatchworkFileDoc = {
  '@patchwork'?: { type?: string; title?: string };
  mimeType?: string;
  name?: string;
  content?: unknown;
};

/**
 * Build a Source descriptor from an existing Patchwork file document (e.g. one
 * dragged in from the sidebar). Returns null if the doc is not a media file.
 *
 * The source stores the raw `automerge:` URL — space-time already resolves that
 * to bytes for the diffusion player and to a service-worker URL (equivalent to
 * `automergeUrlToServiceWorkerUrl`) for `<img>`/`<video>` display.
 */
export async function sourceFromFileDoc(url: string): Promise<CreatedMediaFile | null> {
  const repo = window.repo;
  if (!repo) throw new Error('Automerge repo is not available');
  if (!url.startsWith('automerge:')) return null;

  const handle = await repo.find(url as AutomergeUrl);
  const doc = handle.doc() as PatchworkFileDoc | undefined;
  if (!doc || doc['@patchwork']?.type !== 'file') return null;

  const type = mediaTypeForMime(doc.mimeType);
  if (!type) return null;

  const name = doc.name || doc['@patchwork']?.title || 'Untitled';
  return { url: url as AutomergeUrl, type, name, mimeType: doc.mimeType! };
}
