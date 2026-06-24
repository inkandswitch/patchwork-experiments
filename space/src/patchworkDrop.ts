/**
 * Parse Patchwork sidebar / tool drags onto the space canvas.
 */

import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DocHandle } from "@automerge/automerge-repo";
import type { Editor } from "tldraw";
import { PATCHWORK_DOC_SHAPE_TYPE } from "./PatchworkDocShape";
import { makeShapeId } from "./tool";

export type DropItem = {
  rawUrl: string;
  docUrl: AutomergeUrl;
  toolId?: string;
  docType?: string;
  docName?: string;
};

const DND_TYPES = [
  'text/x-patchwork-dnd',
  'text/x-patchwork-urls',
  'text/uri-list',
  'text/plain',
] as const;

export function hasPatchworkDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return DND_TYPES.some((type) => dataTransfer.types.includes(type));
}

export function parsePatchworkDrop(dataTransfer: DataTransfer): DropItem[] {
  const dndRaw = dataTransfer.getData('text/x-patchwork-dnd');
  if (dndRaw) {
    try {
      const parsed = JSON.parse(dndRaw) as {
        items?: Array<{ url: string; name?: string; type?: string }>;
      };
      if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
        return parsed.items
          .filter((item) => item?.url)
          .map((item) => toDropItem(item.url, item.name, item.type));
      }
    } catch {
      // fall through
    }
  }

  const urlsRaw = dataTransfer.getData('text/x-patchwork-urls');
  if (urlsRaw) {
    try {
      const urls = JSON.parse(urlsRaw);
      if (Array.isArray(urls)) {
        return urls
          .filter((url): url is string => typeof url === 'string' && url.length > 0)
          .map((url) => toDropItem(url));
      }
    } catch {
      // fall through
    }
  }

  const text =
    dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
  if (text) {
    const items: DropItem[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const automerge = automergeUrlFromLine(trimmed);
      if (automerge) items.push(toDropItem(automerge));
    }
    if (items.length > 0) return items;
  }

  return [];
}

function automergeUrlFromLine(line: string): string | null {
  if (line.startsWith('automerge:')) return line;
  const docId = line.match(/#doc=([^&\s]+)/)?.[1];
  if (docId) return `automerge:${docId}`;
  return null;
}

function toDropItem(
  rawUrl: string,
  docName?: string,
  itemType?: string,
): DropItem {
  const { docUrl, toolId } = parseDroppedPatchworkUrl(rawUrl);
  return { rawUrl, docUrl, toolId, docType: itemType, docName };
}

export function parseDroppedPatchworkUrl(raw: string): {
  docUrl: AutomergeUrl;
  toolId?: string;
} {
  const idx = raw.indexOf('?tool=');
  if (idx === -1) return { docUrl: raw as AutomergeUrl };
  return {
    docUrl: raw.slice(0, idx) as AutomergeUrl,
    toolId: decodeURIComponent(raw.slice(idx + 6)),
  };
}

export async function docTypeForUrl(
  repo: any,
  docUrl: AutomergeUrl,
): Promise<string> {
  try {
    const docHandle = await repo.find(docUrl);
    const doc = docHandle.doc() as { '@patchwork'?: { type?: string }; title?: string; name?: string } | undefined;
    return doc?.['@patchwork']?.type ?? '';
  } catch {
    return '';
  }
}

const DEFAULT_W = 640;
const DEFAULT_H = 480;

/**
 * Generic size heuristic: path-addressed sub-documents (e.g. an embedded
 * widget within a parent doc) get a compact frame; root documents get the
 * full default. No per-datatype knowledge lives here.
 */
function shapeSize(docUrl: string): { w: number; h: number } {
  const isSubDoc = docUrl.includes('/');
  return isSubDoc ? { w: 320, h: 220 } : { w: DEFAULT_W, h: DEFAULT_H };
}

export async function createPatchworkDocShapes(
  repo: any,
  editor: Editor,
  folderHandle: DocHandle<any>,
  dropPoint: { x: number; y: number },
  items: DropItem[],
) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let docType = item.docType ?? '';
    let docName = item.docName ?? '';

    try {
      if (!docType) docType = await docTypeForUrl(repo, item.docUrl);
      const docHandle = await repo.find(item.docUrl);
      const doc = docHandle.doc();
      if (doc) {
        if (!docType) docType = doc['@patchwork']?.type || '';
        if (!docName) docName = doc.title || doc.name || '';
      }
    } catch {
      // proceed with inferred metadata
    }

    const toolId = item.toolId ?? '';
    const shapeId = makeShapeId(item.docUrl);
    const { w, h } = shapeSize(item.docUrl);

    folderHandle.change((d: any) => {
      if (!d.docs) d.docs = [];
      const already = d.docs.some((entry: any) => entry.url === item.docUrl);
      if (!already) {
        d.docs.push({ name: docName, type: docType, url: item.docUrl });
      }
    });

    if (editor.getShape(shapeId)) {
      editor.updateShape({
        id: shapeId,
        type: PATCHWORK_DOC_SHAPE_TYPE,
        x: dropPoint.x + i * 30 - w / 2,
        y: dropPoint.y + i * 30 - h / 2,
        props: { docUrl: item.docUrl, docName, docType, toolId, w, h },
      } as any);
    } else {
      editor.createShape({
        id: shapeId,
        type: PATCHWORK_DOC_SHAPE_TYPE,
        x: dropPoint.x + i * 30 - w / 2,
        y: dropPoint.y + i * 30 - h / 2,
        props: {
          w,
          h,
          docUrl: item.docUrl,
          docName,
          docType,
          toolId,
        },
      } as any);
    }

    console.log('[space] dropped patchwork doc:', item.docUrl, docName, toolId || '(default)');
  }
}
