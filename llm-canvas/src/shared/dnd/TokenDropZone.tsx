import { useCallback, useRef, useState } from "react";
import { isPatchworkDrag, resolveDropItems, type PatchworkItem } from "./helpers.ts";

interface TokenDropZoneProps {
  onDrop: (items: PatchworkItem[]) => void;
  children: (isDraggedOver: boolean) => React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export function TokenDropZone({ onDrop, children, style, className }: TokenDropZoneProps) {
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggedOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e.dataTransfer.types)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isPatchworkDrag(e.dataTransfer.types)) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggedOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!isPatchworkDrag(e.dataTransfer.types)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggedOver(false);
      const items = resolveDropItems(e.dataTransfer);
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
