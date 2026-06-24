import { useState, type ReactNode } from "react";
import { CARD_TABLE_MIME, readDragPayload } from "../dnd";

function acceptsCardDrop(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(CARD_TABLE_MIME);
}

export function ZoneDropTarget({
  children,
  active,
  label,
  onDropStock,
}: {
  children: ReactNode;
  active: boolean;
  label: string;
  onDropStock: () => void;
}) {
  const [over, setOver] = useState(false);

  if (!active) {
    return <>{children}</>;
  }

  return (
    <div
      className={`card-table-drop-zone ${over ? "is-over" : ""}`.trim()}
      onDragEnter={(event) => {
        if (acceptsCardDrop(event.dataTransfer)) setOver(true);
      }}
      onDragOver={(event) => {
        if (!acceptsCardDrop(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const payload = readDragPayload(event.dataTransfer);
        if (payload?.source === "stock") onDropStock();
      }}
    >
      {over ? (
        <div className="card-table-drop-hint" aria-hidden>
          Deal to {label}
        </div>
      ) : null}
      {children}
    </div>
  );
}
