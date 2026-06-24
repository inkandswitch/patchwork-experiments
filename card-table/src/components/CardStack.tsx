import type { DragEvent } from "react";
import { PlayingCard, type CardSize } from "./PlayingCard";

export function CardStack({
  count,
  size = "md",
  draggable = false,
  onDragStart,
  label,
  className = "",
}: {
  count: number;
  size?: CardSize;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  label?: string;
  className?: string;
}) {
  if (count <= 0) {
    return (
      <div className={`card-table-stack-empty ${className}`.trim()}>
        <p className="text-xs text-emerald-100/70 italic">Empty stock</p>
      </div>
    );
  }

  const layers = Math.min(count, 5);

  return (
    <div className={`card-table-stack ${className}`.trim()}>
      <div className="card-table-stack-pile">
        {Array.from({ length: layers }, (_, index) => (
          <PlayingCard
            key={index}
            faceDown
            size={size}
            className="card-table-stack-layer"
            style={{
              transform: `translate(${index * 2}px, ${-index * 2}px)`,
              zIndex: index,
            }}
            draggable={draggable && index === layers - 1}
            onDragStart={index === layers - 1 ? onDragStart : undefined}
          />
        ))}
        <span className="card-table-stack-count">{count}</span>
      </div>
      {label ? <p className="card-table-stack-label">{label}</p> : null}
    </div>
  );
}
