import { useCallback, useRef, useState } from 'react';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import { getTokenDragData, PATCHWORK_URLS_MIME } from './tokens.tsx';

export type PatchworkDropItem =
  | { type: 'document'; url: AutomergeUrl; name: string }
  | { type: 'tool'; url: AutomergeUrl; name: string; path: string };

interface TokenDropZoneProps {
  onDrop: (items: PatchworkDropItem[]) => void;
  children: (isDraggedOver: boolean) => React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

function resolveItems(e: DragEvent): PatchworkDropItem[] {
  const raw = e.dataTransfer?.getData(PATCHWORK_URLS_MIME);
  if (!raw) return [];

  let urls: string[];
  try {
    urls = JSON.parse(raw);
  } catch {
    return [];
  }

  const token = e.dataTransfer ? getTokenDragData(e.dataTransfer) : null;

  return urls.map((url) => {
    if (token?.type === 'tool') {
      return { type: 'tool', url: url as AutomergeUrl, name: token.name, path: token.path ?? '' };
    }
    if (token?.type === 'document') {
      return { type: 'document', url: url as AutomergeUrl, name: token.name };
    }
    return { type: 'document', url: url as AutomergeUrl, name: url };
  });
}

export function TokenDropZone({ onDrop, children, style, className }: TokenDropZoneProps) {
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const dragCounterRef = useRef(0);

  const isPatchworkDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(PATCHWORK_URLS_MIME);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggedOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e)) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggedOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isPatchworkDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggedOver(false);
      const items = resolveItems(e.nativeEvent as DragEvent);
      if (items.length > 0) onDrop(items);
    },
    [onDrop],
  );

  return (
    <div
      style={style}
      className={className}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children(isDraggedOver)}
    </div>
  );
}
