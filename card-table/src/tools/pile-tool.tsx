import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense, useEffect, useState } from "react";
import { CardRow } from "../components/PlayingCard";
import { CardStack } from "../components/CardStack";
import { ZoneDropTarget } from "../components/ZoneDropTarget";
import { loadLocalPlayer, loadExchangePrivateKey } from "../crypto/player-keys";
import {
  keyMaterialDigest,
  requestCardDecryption,
  tryDecryptFromDoc,
} from "../crypto/reveal";
import { useKeyExchange } from "../hooks/use-key-exchange";
import { usePlayerIdentity } from "../hooks/use-player-identity";
import { useDeckDropTarget } from "../hooks/use-deck-dnd";
import { makeTool } from "../make-tool";
import { rootDocUrl } from "../paths";
import type { CardTableDoc, DecryptedCard, SecurePileZone } from "../types";

function PileEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const tableUrl = rootDocUrl(docUrl);
  const { ready: identityReady, userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(tableUrl, { suspense: true });
  const [pile] = useDocument<SecurePileZone>(docUrl, { suspense: true });
  const [table] = useDocument<CardTableDoc>(tableUrl, { suspense: true });
  const [decrypted, setDecrypted] = useState<Map<number, DecryptedCard | null>>(
    new Map(),
  );
  const [loading, setLoading] = useState(false);

  const canReveal =
    !!userId &&
    pile.faceUp &&
    table.phase === "ready" &&
    pile.cards.length > 0 &&
    !!table.publishedDeck?.length;

  const stockDrop = useDeckDropTarget(handle, table, { pileId: pile.id });

  useKeyExchange(handle, table, userId);

  useEffect(() => {
    if (!userId || !canReveal) {
      setDecrypted(new Map());
      return;
    }

    let canceled = false;
    setLoading(true);

    (async () => {
      const player = await loadLocalPlayer(repo, table, userId);
      const exchangePrivateKey = await loadExchangePrivateKey(repo, table, userId);
      const next = new Map<number, DecryptedCard | null>();
      for (const offset of pile.cards) {
        if (canceled) return;
        const fromDoc = await tryDecryptFromDoc(
          table,
          player,
          userId,
          offset,
          exchangePrivateKey,
        );
        if (fromDoc) {
          next.set(offset, fromDoc);
          continue;
        }
        const card = await requestCardDecryption(
          handle,
          table,
          player,
          userId,
          offset,
          exchangePrivateKey,
        );
        next.set(offset, card);
      }
      if (!canceled) {
        setDecrypted(next);
        setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    canReveal,
    pile.cards.join(","),
    keyMaterialDigest(table, pile.cards, userId ?? ""),
    handle,
    repo,
    table,
    tableUrl,
    userId,
  ]);

  if (!identityReady || !userId) {
    return (
      <div className="card-table h-full p-3 text-xs text-slate-400">
        Loading player identity…
      </div>
    );
  }

  return (
    <ZoneDropTarget
      active={stockDrop.active}
      label={pile.title}
      onDropStock={stockDrop.onDropStock}
    >
      <div className="card-table h-full min-h-[5rem] p-1">
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            {pile.cards.length} card{pile.cards.length === 1 ? "" : "s"}
            {loading ? " · revealing…" : ""}
          </p>

          {pile.faceUp ? (
            <CardRow
              cards={pile.cards}
              decrypted={decrypted}
              faceDown={false}
              size="sm"
            />
          ) : pile.cards.length > 0 ? (
            <CardStack count={pile.cards.length} size="sm" />
          ) : (
            <p className="text-xs text-slate-400 italic">Drop cards here</p>
          )}
        </div>
      </div>
    </ZoneDropTarget>
  );
}

function PileToolView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <Suspense fallback={<p className="p-3 text-xs text-slate-400">Loading pile…</p>}>
      <PileEditor docUrl={docUrl} />
    </Suspense>
  );
}

export const SecurePileTool = makeTool(PileToolView);
