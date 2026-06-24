import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CardRow } from "../components/PlayingCard";
import { ContactHandLabel } from "../components/ContactName";
import { ZoneDropTarget } from "../components/ZoneDropTarget";
import { loadLocalPlayer, loadExchangePrivateKey } from "../crypto/player-keys";
import {
  fulfillKeyRequests,
  keyMaterialDigest,
  missingKeyParticipants,
  publishCardReveal,
  revealedOffsetsForHand,
  requestCardDecryption,
  submitKeyRequests,
  tryDecryptFromDoc,
} from "../crypto/reveal";
import { useKeyExchange } from "../hooks/use-key-exchange";
import { usePlayerIdentity } from "../hooks/use-player-identity";
import { useZoneDnd } from "../hooks/use-zone-dnd";
import { makeTool } from "../make-tool";
import { claimHand } from "../ops/zones";
import { handIdFromSubUrl, rootDocUrl } from "../paths";
import { playerMatchesTablePublicKey } from "../crypto/validate-keys";
import type { CardTableDoc, DecryptedCard, SecureHandZone } from "../types";

function resolveHand(
  table: CardTableDoc,
  subHand: SecureHandZone,
  docUrl: AutomergeUrl,
): SecureHandZone {
  const handId = handIdFromSubUrl(docUrl);
  if (!handId) return subHand;
  return table.hands.find((entry) => entry.id === handId) ?? subHand;
}

function HandEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const tableUrl = rootDocUrl(docUrl);
  const { ready: identityReady, userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(tableUrl, { suspense: true });
  const [subHand] = useDocument<SecureHandZone>(docUrl, { suspense: true });
  const [table] = useDocument<CardTableDoc>(tableUrl, { suspense: true });
  const hand = useMemo(
    () => resolveHand(table, subHand, docUrl),
    [table, subHand, docUrl],
  );
  const [decrypted, setDecrypted] = useState<Map<number, DecryptedCard | null>>(
    new Map(),
  );
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealingOffset, setRevealingOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const isUnclaimed = !hand.ownerId;
  const isOwner = !!userId && hand.ownerId === userId;
  const isShuffleParticipant =
    !!userId && table.shuffleParticipants.some((p) => p.id === userId);
  const revealedSet = useMemo(() => revealedOffsetsForHand(hand), [hand]);
  const gameReady = table.phase === "ready" && !!table.publishedDeck?.length;

  const offsetsToDecrypt = useMemo(() => {
    if (!gameReady || !hand.cards.length) return [];
    if (isOwner) return hand.cards;
    return hand.cards.filter((offset) => revealedSet.has(offset));
  }, [gameReady, hand.cards, isOwner, revealedSet]);

  const dnd = useZoneDnd(
    handle,
    table,
    { kind: "hand", id: hand.id },
    { canDragOut: isOwner },
  );

  useKeyExchange(handle, table, userId);

  const claim = useCallback(async () => {
    if (!userId || !isUnclaimed) return;
    setError(null);
    setClaiming(true);
    try {
      handle.change((draft) => claimHand(draft, hand.id, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClaiming(false);
    }
  }, [hand.id, handle, isUnclaimed, userId]);

  const revealCard = useCallback(
    async (offset: number) => {
      if (!userId || !isOwner || !gameReady || revealedSet.has(offset)) return;
      setError(null);
      setRevealingOffset(offset);
      try {
        const player = await loadLocalPlayer(repo, table, userId);
        if (!player) throw new Error("Could not load your shuffle keys");
        await publishCardReveal(handle, table, hand.id, userId, player, offset);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRevealingOffset(null);
      }
    },
    [gameReady, hand.id, handle, isOwner, repo, revealedSet, table, userId],
  );

  useEffect(() => {
    if (!userId || offsetsToDecrypt.length === 0) {
      setDecrypted(new Map());
      setDecryptError(null);
      return;
    }

    if (!isShuffleParticipant) {
      setDecrypted(new Map());
      setDecryptError("Join the table shuffle before viewing cards in a hand.");
      return;
    }

    let canceled = false;
    setLoading(true);
    setDecryptError(null);

    (async () => {
      const latestTable = () => handle.doc() ?? table;
      const doc = latestTable();
      const player = await loadLocalPlayer(repo, doc, userId);
      if (!player) {
        if (!canceled) {
          setDecrypted(new Map());
          setDecryptError("Could not load your shuffle keys — finish setup on the table first.");
          setLoading(false);
        }
        return;
      }

      const exchangePrivateKey = await loadExchangePrivateKey(repo, doc, userId);

      const missingOffsets = offsetsToDecrypt.filter(
        (offset) => missingKeyParticipants(doc, offset, userId).length > 0,
      );
      if (missingOffsets.length > 0) {
        submitKeyRequests(handle, userId, missingOffsets);
      }
      await fulfillKeyRequests(handle, latestTable(), player, userId);

      const next = new Map<number, DecryptedCard | null>();
      let failed = 0;
      for (const offset of offsetsToDecrypt) {
        if (canceled) return;
        const current = latestTable();
        const fromDoc = await tryDecryptFromDoc(
          current,
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
          current,
          player,
          userId,
          offset,
          exchangePrivateKey,
        );
        if (!card) failed += 1;
        next.set(offset, card);
      }
      if (!canceled) {
        setDecrypted(next);
        const latest = latestTable();
        const stillWaiting = offsetsToDecrypt.filter(
          (offset) => missingKeyParticipants(latest, offset, userId).length > 0,
        ).length;
        setDecryptError(
          stillWaiting > 0
            ? `Waiting for key shares on ${stillWaiting} card${stillWaiting === 1 ? "" : "s"} — other players need a card-table view open.`
            : failed > 0
              ? player && latest.publicKey && !playerMatchesTablePublicKey(latest, player)
                ? "Your shuffle keys do not match this table — create a new card table and shuffle again."
                : `Could not decrypt ${failed} card${failed === 1 ? "" : "s"} — create a new card table and shuffle again.`
              : null,
        );
        setLoading(false);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    offsetsToDecrypt.join(","),
    keyMaterialDigest(table, offsetsToDecrypt, userId ?? ""),
    handle,
    isShuffleParticipant,
    repo,
    table,
    tableUrl,
    userId,
  ]);

  if (!identityReady || !userId) {
    return (
      <div className="card-table h-full bg-slate-900 p-3 text-xs text-slate-400">
        Loading player identity…
      </div>
    );
  }

  const publicCount = hand.cards.filter((offset) => revealedSet.has(offset)).length;

  return (
    <ZoneDropTarget label={hand.title} accepts={dnd.accepts} onDrop={dnd.onDrop}>
      <div className="card-table h-full bg-slate-900 p-2 text-white">
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            {isUnclaimed ? (
              "Unclaimed hand"
            ) : (
              <ContactHandLabel ownerId={hand.ownerId} isOwner={isOwner} />
            )}
            {publicCount > 0
              ? ` · ${publicCount}/${hand.cards.length} revealed`
              : ""}
            {loading ? " · decrypting…" : ""}
            {revealingOffset != null ? " · revealing…" : ""}
          </p>
          {isUnclaimed && userId ? (
            <button
              type="button"
              disabled={claiming}
              onClick={() => void claim()}
              className="rounded border border-amber-400/60 bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {claiming ? "Claiming…" : "Claim hand"}
            </button>
          ) : null}
          {isOwner && gameReady && hand.cards.length > 0 ? (
            <p className="text-[10px] text-slate-500">
              Click a card with a gold ring to reveal it to other players.
            </p>
          ) : null}
          {error ? (
            <p className="text-[10px] text-red-300">{error}</p>
          ) : null}
          {decryptError ? (
            <p className="text-[10px] text-amber-200">{decryptError}</p>
          ) : null}
          <CardRow
            cards={hand.cards}
            decrypted={decrypted}
            draggable={dnd.canDragOut && gameReady}
            onCardDragStart={dnd.dragCard}
            faceDownForOffset={(offset) =>
              !isOwner && !revealedSet.has(offset)
            }
            revealableForOffset={(offset) =>
              isOwner &&
              gameReady &&
              !revealedSet.has(offset) &&
              revealingOffset !== offset
            }
            onCardClick={(offset) => void revealCard(offset)}
            size="sm"
            fan
          />
        </div>
      </div>
    </ZoneDropTarget>
  );
}

function HandToolView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <Suspense fallback={<p className="p-3 text-xs text-slate-400">Loading hand…</p>}>
      <HandEditor docUrl={docUrl} />
    </Suspense>
  );
}

export const SecureHandTool = makeTool(HandToolView);
