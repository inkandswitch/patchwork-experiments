import type { CSSProperties, DragEvent } from "react";
import type { DecryptedCard } from "../types";
import {
  centerGlyph,
  displayRank,
  isRedSuit,
  suitGlyph,
} from "./card-display";

export type CardSize = "sm" | "md" | "lg";

const sizeClasses: Record<CardSize, string> = {
  sm: "h-16 w-11 text-[10px]",
  md: "h-24 w-[4.25rem] text-xs",
  lg: "h-32 w-[5.75rem] text-sm",
};

const centerSize: Record<CardSize, string> = {
  sm: "text-lg",
  md: "text-3xl",
  lg: "text-4xl",
};

export function PlayingCard({
  faceDown = false,
  card,
  size = "md",
  draggable = false,
  onDragStart,
  onClick,
  armed = false,
  revealed = false,
  className = "",
  style,
}: {
  faceDown?: boolean;
  card?: DecryptedCard | null;
  size?: CardSize;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onClick?: () => void;
  /** First click: armed for reveal (red highlight). */
  armed?: boolean;
  /** Card is shared with everyone (emphasized). */
  revealed?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const sizeClass = sizeClasses[size];
  const stateClass = `${armed ? "is-armed" : ""} ${revealed ? "is-revealed" : ""}`;

  if (faceDown || !card) {
    return (
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onClick={onClick}
        style={style}
        className={`card-table-card card-table-card-back ${sizeClass} ${stateClass} ${className}`
          .replace(/\s+/g, " ")
          .trim()}
        aria-label={armed ? "Face-down card — click again to reveal" : "Face-down card"}
      />
    );
  }

  const red = isRedSuit(card.suit);
  const rank = displayRank(card.rank);
  const glyph = suitGlyph(card.suit);
  const center = centerGlyph(card);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      style={style}
      className={`card-table-card card-table-card-face ${sizeClass} ${red ? "is-red" : "is-black"} ${stateClass} ${className}`
        .replace(/\s+/g, " ")
        .trim()}
      aria-label={`${rank} of ${card.suit}${revealed ? " (revealed)" : ""}`}
    >
      <div className="card-table-corner card-table-corner-top">
        <span className="card-table-rank">{rank}</span>
        <span className="card-table-suit">{glyph}</span>
      </div>
      <div className={`card-table-center ${centerSize[size]}`}>{center}</div>
      <div className="card-table-corner card-table-corner-bottom">
        <span className="card-table-rank">{rank}</span>
        <span className="card-table-suit">{glyph}</span>
      </div>
    </div>
  );
}

export function CardRow({
  cards,
  decrypted,
  faceDown = false,
  size = "md",
  fan = false,
  draggable = false,
  onCardDragStart,
  faceDownForOffset,
  onCardClick,
  armedForOffset,
  revealedForOffset,
}: {
  cards: number[];
  decrypted?: Map<number, DecryptedCard | null>;
  faceDown?: boolean;
  size?: CardSize;
  fan?: boolean;
  draggable?: boolean;
  onCardDragStart?: (
    event: DragEvent<HTMLDivElement>,
    offset: number,
    index: number,
  ) => void;
  /** Per-card face-down (overrides `faceDown` when set). */
  faceDownForOffset?: (offset: number) => boolean;
  onCardClick?: (offset: number, index: number) => void;
  armedForOffset?: (offset: number) => boolean;
  revealedForOffset?: (offset: number) => boolean;
}) {
  if (!cards.length) {
    return <p className="text-xs text-slate-400 italic">No cards</p>;
  }

  return (
    <div className={`card-table-row ${fan ? "is-fan" : ""}`.trim()}>
      {cards.map((offset, index) => {
        const cardFaceDown = faceDownForOffset
          ? faceDownForOffset(offset)
          : faceDown;
        return (
          <PlayingCard
            key={`${offset}-${index}`}
            faceDown={cardFaceDown}
            card={cardFaceDown ? undefined : decrypted?.get(offset)}
            size={size}
            draggable={draggable}
            armed={armedForOffset?.(offset) ?? false}
            revealed={revealedForOffset?.(offset) ?? false}
            onClick={
              onCardClick ? () => onCardClick(offset, index) : undefined
            }
            onDragStart={
              draggable && onCardDragStart
                ? (event) => onCardDragStart(event, offset, index)
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
