import { useEffect, useState } from "react";
import { requestReshuffle } from "../crypto/protocol";
import type { CardTableDoc } from "../types";

/**
 * Shown once the deck is dealt. Reshuffling discards the current deal, so it
 * takes a deliberate confirm click.
 */
export function ReshuffleButton({
  doc,
  userId,
  changeDoc,
}: {
  doc: CardTableDoc;
  userId: string;
  changeDoc: (callback: (draft: CardTableDoc) => void) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const joined = doc.shuffleParticipants.some((p) => p.id === userId);

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (doc.phase !== "ready" || !joined) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        changeDoc((draft) => requestReshuffle(draft));
      }}
      className={
        confirming
          ? "rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          : "rounded-md border border-emerald-200/40 bg-emerald-950/40 px-3 py-1.5 text-sm font-medium text-emerald-100/90 hover:bg-emerald-900/50"
      }
      title="Collect every card and shuffle a fresh deck"
    >
      {confirming ? "Reshuffle — discards the deal?" : "Reshuffle"}
    </button>
  );
}
