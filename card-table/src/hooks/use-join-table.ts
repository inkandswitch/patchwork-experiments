import { useEffect } from "react";
import { canJoinTable } from "../crypto/protocol";
import type { CardTableDoc } from "../types";

/** Auto-join the shuffle roster using the player's contact identity URL. */
export function useJoinTable(
  doc: CardTableDoc,
  changeDoc: (callback: (draft: CardTableDoc) => void) => void,
  identity: string | undefined,
  identityReady: boolean,
) {
  const joined = !!identity && doc.shuffleParticipants.some((p) => p.id === identity);
  const canJoin = !!identity && canJoinTable(doc);

  useEffect(() => {
    if (!identityReady || !identity || !canJoin || joined) return;
    changeDoc((draft) => {
      if (!canJoinTable(draft)) return;
      if (draft.shuffleParticipants.some((p) => p.id === identity)) return;
      draft.shuffleParticipants.push({
        id: identity,
        readyToStart: false,
        keygenReady: false,
        shuffleDone: false,
        keyDocUrl: null,
        exchangePublicKey: null,
      });
    });
  }, [canJoin, changeDoc, identity, identityReady, joined]);
}
