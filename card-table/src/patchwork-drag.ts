import type { AutomergeUrl } from "@automerge/automerge-repo";

export const PATCHWORK_URLS_MIME = "text/x-patchwork-urls";
export const PATCHWORK_DND_MIME = "text/x-patchwork-dnd";

export type PatchworkDragItem = {
  id: string;
  url: string;
  name?: string;
};

export function writePatchworkDrag(
  dataTransfer: DataTransfer,
  source: string,
  items: PatchworkDragItem[],
) {
  const urls = items.map((item) => item.url);
  const urlsJson = JSON.stringify(urls);
  const dndJson = JSON.stringify({ source, items });

  dataTransfer.items.add(urlsJson, PATCHWORK_URLS_MIME);
  dataTransfer.items.add(dndJson, PATCHWORK_DND_MIME);
  dataTransfer.effectAllowed = "copyMove";
}

export function dragUrlWithTool(
  docUrl: AutomergeUrl,
  toolId: string,
): string {
  return `${docUrl}?tool=${encodeURIComponent(toolId)}`;
}
