import { useState, type ReactNode } from "react";
import { CARD_TABLE_MIME, readDragPayload, type CardDragPayload } from "../dnd";

function hasCardPayload(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CARD_TABLE_MIME);
}

export function ZoneDropTarget({
  children,
  label,
  accepts,
  onDrop,
}: {
  children: ReactNode;
  label: string;
  /** Whether this zone accepts the given drag payload. */
  accepts: (payload: CardDragPayload) => boolean;
  onDrop: (payload: CardDragPayload) => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div
      className={`card-table-drop-zone ${over ? "is-over" : ""}`.trim()}
      onDragEnter={(event) => {
        if (hasCardPayload(event.dataTransfer)) setOver(true);
      }}
      onDragOver={(event) => {
        if (!hasCardPayload(event.dataTransfer)) return;
        // Payload contents aren't readable during dragover, so we optimistically
        // allow the drop and validate on drop.
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        const payload = readDragPayload(event.dataTransfer);
        if (!payload || !accepts(payload)) return;
        event.preventDefault();
        onDrop(payload);
      }}
    >
      {over ? (
        <div className="card-table-drop-hint" aria-hidden>
          Drop on {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}
