import { markReadyToStart } from "../crypto/protocol";
import type { CardTableDoc } from "../types";

export function ReadyToStartButton({
  doc,
  userId,
  changeDoc,
}: {
  doc: CardTableDoc;
  userId: string;
  changeDoc: (callback: (draft: CardTableDoc) => void) => void;
}) {
  if (doc.phase !== "setup") return null;

  const me = doc.shuffleParticipants.find((p) => p.id === userId);
  if (!me || me.readyToStart === true) return null;

  return (
    <button
      type="button"
      onClick={() =>
        changeDoc((draft) => markReadyToStart(draft, userId))
      }
      className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
    >
      Ready to start
    </button>
  );
}
