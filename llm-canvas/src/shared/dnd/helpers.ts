export const PATCHWORK_URLS_MIME = "text/x-patchwork-urls" as const;

// ---------------------------------------------------------------------------
// Drop consumed flag
// The browser guarantees drop fires on the target before dragend fires on
// the source, so this module-level flag is a reliable cross-component signal.
// ---------------------------------------------------------------------------

let _dropConsumed = false;

export function markDropConsumed(): void {
  _dropConsumed = true;
}

export function consumeDrop(): boolean {
  const result = _dropConsumed;
  _dropConsumed = false;
  return result;
}
export const PATCHWORK_TOKEN_MIME = "text/x-patchwork-token" as const;

export interface PatchworkDocItem {
  type: "document";
  url: string;
  name: string;
}

export interface PatchworkToolItem {
  type: "tool";
  url: string;
  name: string;
  path: string;
}

export type PatchworkItem = PatchworkDocItem | PatchworkToolItem;

export function setDragData(dt: DataTransfer, item: PatchworkItem, effect: "copy" | "move" = "copy"): void {
  dt.effectAllowed = effect;
  dt.setData(PATCHWORK_URLS_MIME, JSON.stringify([item.url]));
  dt.setData(PATCHWORK_TOKEN_MIME, JSON.stringify(item));
}

export function getDragData(dt: DataTransfer): PatchworkItem | null {
  const raw = dt.getData(PATCHWORK_TOKEN_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PatchworkItem;
  } catch {
    return null;
  }
}

export function isPatchworkDrag(types: readonly string[]): boolean {
  return types.includes(PATCHWORK_URLS_MIME);
}

export function resolveDropItems(dt: DataTransfer): PatchworkItem[] {
  const raw = dt.getData(PATCHWORK_URLS_MIME);
  if (!raw) return [];

  let urls: string[];
  try {
    urls = JSON.parse(raw);
  } catch {
    return [];
  }

  const token = getDragData(dt);

  return urls.map((url) => {
    if (token?.type === "tool") {
      return { type: "tool", url, name: token.name, path: token.path };
    }
    if (token?.type === "document") {
      return { type: "document", url, name: token.name };
    }
    return { type: "document", url, name: url };
  });
}
