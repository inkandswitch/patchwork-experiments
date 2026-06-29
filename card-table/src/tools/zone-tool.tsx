import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { CardRow } from "../components/PlayingCard";
import { CardStack } from "../components/CardStack";
import { ContactHandLabel } from "../components/ContactName";
import { ReadyToStartButton } from "../components/ReadyToStartButton";
import { ReshuffleButton } from "../components/ReshuffleButton";
import { ZoneDropTarget } from "../components/ZoneDropTarget";
import { loadLocalPlayer, loadExchangePrivateKey } from "../crypto/player-keys";
import { playerMatchesTablePublicKey } from "../crypto/validate-keys";
import {
  fulfillKeyRequests,
  keyMaterialDigest,
  missingKeyParticipants,
  publishCardReveal,
  requestCardDecryption,
  revealedOffsetsForZone,
  submitKeyRequests,
  tryDecryptFromDoc,
} from "../crypto/reveal";
import { useAutoInit, useInitStatus } from "../hooks/use-auto-init";
import { useJoinTable } from "../hooks/use-join-table";
import { useKeyExchange } from "../hooks/use-key-exchange";
import { usePlayerIdentity } from "../hooks/use-player-identity";
import {
  canDragDeck,
  deckLabel,
  useStockDrag,
  useZoneDnd,
} from "../hooks/use-zone-dnd";
import { makeTool } from "../make-tool";
import { addZone, setZoneFaceUp } from "../ops/zones";
import { dragUrlWithTool, writePatchworkDrag } from "../patchwork-drag";
import { rootDocUrl, subZoneUrl, zoneIdFromSubUrl } from "../paths";
import type { CardTableDoc, CardZone, DecryptedCard } from "../types";

function resolveZone(
  table: CardTableDoc,
  subZone: CardZone,
  docUrl: AutomergeUrl,
): CardZone {
  const zoneId = zoneIdFromSubUrl(docUrl) ?? subZone.id;
  return table.zones.find((entry) => entry.id === zoneId) ?? subZone;
}

function newZoneId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Deck control surface (role: "deck")
// ---------------------------------------------------------------------------

function DeckSurface({
  docUrl,
  tableUrl,
  deck,
}: {
  docUrl: AutomergeUrl;
  tableUrl: AutomergeUrl;
  deck: CardZone;
}) {
  const repo = useRepo();
  const { ready: identityReady, userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(tableUrl, { suspense: true });
  const [table, changeDoc] = useDocument<CardTableDoc>(tableUrl, {
    suspense: true,
  });
  const canDrag = canDragDeck(table, deck);
  const dragDeckCard = useStockDrag(handle);
  const onInitError = useCallback((message: string) => {
    console.error("[card-zone:deck]", message);
  }, []);

  const joined =
    !!userId && table.shuffleParticipants.some((p) => p.id === userId);

  useJoinTable(table, changeDoc, userId, identityReady);
  const initMessage = useInitStatus(table, userId);
  useAutoInit(tableUrl, handle, repo, userId, table, changeDoc, onInitError);
  useKeyExchange(handle, table, userId);

  const spawn = useCallback(
    (
      event: DragEvent<HTMLButtonElement>,
      props: { id: string; title: string; ownerId?: string; faceUp?: boolean },
    ) => {
      handle.change((draft) => addZone(draft, props));
      writePatchworkDrag(event.dataTransfer, "card-zone", [
        {
          id: props.id,
          url: dragUrlWithTool(subZoneUrl(tableUrl, props.id), "card-zone"),
          name: props.title,
        },
      ]);
    },
    [handle, tableUrl],
  );

  const dragDeckToCanvas = (event: DragEvent<HTMLButtonElement>) => {
    writePatchworkDrag(event.dataTransfer, "card-zone", [
      {
        id: deck.id,
        url: dragUrlWithTool(subZoneUrl(tableUrl, deck.id), "card-zone"),
        name: deck.title || "Deck",
      },
    ]);
  };

  const handCount = table.zones.filter((z) => z.ownerId).length;
  const pileCount = table.zones.filter(
    (z) => !z.ownerId && z.role !== "deck" && !z.faceUp,
  ).length;
  const playAreaCount = table.zones.filter(
    (z) => !z.ownerId && z.role !== "deck" && z.faceUp,
  ).length;

  const hint =
    table.phase === "ready"
      ? ""
      : identityReady && userId
        ? initMessage
        : "Loading…";

  const spawnButton = (
    onDragStart: (event: DragEvent<HTMLButtonElement>) => void,
    label: string,
    title: string,
  ) => (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      className="card-table-canvas-drag rounded border border-emerald-200/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-100/90 cursor-grab active:cursor-grabbing"
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div className="card-table card-table-deck-tool h-full min-h-[8rem]">
      <div className="card-table-felt flex h-full flex-col items-center justify-center gap-3 p-4">
        <CardStack
          count={deck.cards.length}
          draggable={canDrag}
          onDragStart={dragDeckCard}
          label={deckLabel(deck, table)}
        />
        {joined && table.phase === "setup" ? (
          <ReadyToStartButton doc={table} userId={userId!} changeDoc={changeDoc} />
        ) : null}
        {joined && table.phase === "ready" ? (
          <ReshuffleButton doc={table} userId={userId!} changeDoc={changeDoc} />
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {spawnButton(
            dragDeckToCanvas,
            "Place deck",
            "Drag onto the canvas to place the deck widget",
          )}
          {spawnButton(
            (event) =>
              spawn(event, {
                id: newZoneId("hand"),
                title: `Hand ${handCount + 1}`,
                ownerId: userId ?? "",
              }),
            "New hand",
            "Drag onto the canvas to create your private hand",
          )}
          {spawnButton(
            (event) =>
              spawn(event, {
                id: newZoneId("pile"),
                title: `Pile ${pileCount + 1}`,
                faceUp: false,
              }),
            "New pile",
            "Drag onto the canvas to create a face-down pile",
          )}
          {spawnButton(
            (event) =>
              spawn(event, {
                id: newZoneId("play"),
                title: `Play area ${playAreaCount + 1}`,
                faceUp: false,
              }),
            "New play area",
            "Drag onto the canvas to create a play area",
          )}
        </div>
        <p className="max-w-[14rem] text-center text-[11px] leading-snug text-emerald-100/80">
          {hint}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hand / pile surface (every non-deck zone)
// ---------------------------------------------------------------------------

function ZoneSurface({
  docUrl,
  tableUrl,
  zone,
}: {
  docUrl: AutomergeUrl;
  tableUrl: AutomergeUrl;
  zone: CardZone;
}) {
  const repo = useRepo();
  const { userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(tableUrl, { suspense: true });
  const [table] = useDocument<CardTableDoc>(tableUrl, { suspense: true });
  const [decrypted, setDecrypted] = useState<Map<number, DecryptedCard | null>>(
    new Map(),
  );
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealingOffset, setRevealingOffset] = useState<number | null>(null);
  const [armedOffset, setArmedOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isHand = !!zone.ownerId;
  const isOwner = !!userId && zone.ownerId === userId;
  const isShuffleParticipant =
    !!userId && table.shuffleParticipants.some((p) => p.id === userId);
  const revealedSet = useMemo(() => revealedOffsetsForZone(zone), [zone]);
  const gameReady = table.phase === "ready" && !!table.publishedDeck?.length;

  const offsetsToDecrypt = useMemo(() => {
    if (!gameReady || !zone.cards.length) return [];
    if (isOwner) return zone.cards;
    if (!isHand && zone.faceUp) return zone.cards;
    return zone.cards.filter((offset) => revealedSet.has(offset));
  }, [gameReady, zone.cards, zone.faceUp, isHand, isOwner, revealedSet]);

  const dnd = useZoneDnd(handle, table, zone.id, {
    canDragOut: isHand ? isOwner : true,
  });

  useKeyExchange(handle, table, userId);

  const toggleFaceUp = useCallback(() => {
    handle.change((draft) => setZoneFaceUp(draft, zone.id, !zone.faceUp));
  }, [handle, zone.id, zone.faceUp]);

  const revealCard = useCallback(
    async (offset: number) => {
      if (!userId || !isOwner || !gameReady || revealedSet.has(offset)) return;
      setError(null);
      setArmedOffset(null);
      setRevealingOffset(offset);
      try {
        const player = await loadLocalPlayer(repo, table, userId);
        if (!player) throw new Error("Could not load your shuffle keys");
        await publishCardReveal(handle, table, zone.id, userId, player, offset);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRevealingOffset(null);
      }
    },
    [gameReady, zone.id, handle, isOwner, repo, revealedSet, table, userId],
  );

  // Revealing is deliberate: the first click arms a card (red ring), a second
  // click on the same card publishes the reveal.
  const handleCardClick = useCallback(
    (offset: number) => {
      if (!isOwner || !gameReady || revealedSet.has(offset)) return;
      if (revealingOffset === offset) return;
      if (armedOffset === offset) {
        void revealCard(offset);
      } else {
        setArmedOffset(offset);
      }
    },
    [armedOffset, gameReady, isOwner, revealCard, revealedSet, revealingOffset],
  );

  useEffect(() => {
    if (!userId || offsetsToDecrypt.length === 0) {
      setDecrypted(new Map());
      setDecryptError(null);
      return;
    }

    if (!isShuffleParticipant) {
      setDecrypted(new Map());
      setDecryptError("Join the table shuffle before viewing these cards.");
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
          // Don't blank already-revealed cards on a transient key-load miss.
          setDecryptError(
            "Could not load your shuffle keys — finish setup on the table first.",
          );
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
        // Merge into prior results so a card already shown is never blanked by
        // a transient miss; only keep offsets we still want, and never replace
        // a good card with null.
        setDecrypted((prev) => {
          const merged = new Map(prev);
          for (const [offset, card] of next) {
            if (card) merged.set(offset, card);
            else if (!merged.has(offset)) merged.set(offset, null);
          }
          for (const offset of [...merged.keys()]) {
            if (!offsetsToDecrypt.includes(offset)) merged.delete(offset);
          }
          return merged;
        });
        const latest = latestTable();
        const stillWaiting = offsetsToDecrypt.filter(
          (offset) => missingKeyParticipants(latest, offset, userId).length > 0,
        ).length;
        setDecryptError(
          stillWaiting > 0
            ? `Waiting for key shares on ${stillWaiting} card${stillWaiting === 1 ? "" : "s"} — other players need a card-table view open.`
            : failed > 0
              ? player &&
                latest.publicKey &&
                !playerMatchesTablePublicKey(latest, player)
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
    // Gate on the inputs that actually affect decryption, not the whole doc —
    // depending on `table` would re-run on our own key-share writes and thrash.
  }, [
    offsetsToDecrypt.join(","),
    keyMaterialDigest(table, offsetsToDecrypt, userId ?? ""),
    table.shuffleId,
    table.publishedDeck?.length ?? 0,
    handle,
    isShuffleParticipant,
    repo,
    tableUrl,
    userId,
  ]);

  const publicCount = zone.cards.filter((offset) =>
    revealedSet.has(offset),
  ).length;
  const lastIndex = zone.cards.length - 1;

  return (
    <ZoneDropTarget label={zone.title} accepts={dnd.accepts} onDrop={dnd.onDrop}>
      <div className="card-table h-full min-h-[5rem] bg-slate-900 p-2 text-white">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              {isHand ? (
                <ContactHandLabel ownerId={zone.ownerId!} isOwner={isOwner} />
              ) : (
                `${zone.title} · ${zone.cards.length} card${zone.cards.length === 1 ? "" : "s"}`
              )}
              {isHand && publicCount > 0
                ? ` · ${publicCount}/${zone.cards.length} revealed`
                : ""}
              {!isHand && zone.faceUp ? " · face up" : ""}
              {loading ? " · decrypting…" : ""}
              {revealingOffset != null ? " · revealing…" : ""}
            </p>
            {!isHand ? (
              <button
                type="button"
                onClick={toggleFaceUp}
                className="rounded border border-slate-400/40 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700/40"
                title={zone.faceUp ? "Flip face down" : "Flip face up"}
              >
                {zone.faceUp ? "Flip down" : "Flip up"}
              </button>
            ) : null}
          </div>

          {error ? <p className="text-[10px] text-red-300">{error}</p> : null}
          {decryptError ? (
            <p className="text-[10px] text-amber-200">{decryptError}</p>
          ) : null}

          {isHand || zone.faceUp ? (
            <CardRow
              cards={zone.cards}
              decrypted={decrypted}
              draggable={dnd.canDragOut && gameReady}
              onCardDragStart={dnd.beginCardDrag}
              faceDownForOffset={(offset) =>
                isHand && !isOwner && !revealedSet.has(offset)
              }
              armedForOffset={(offset) =>
                isOwner &&
                gameReady &&
                armedOffset === offset &&
                !revealedSet.has(offset) &&
                revealingOffset !== offset
              }
              revealedForOffset={(offset) => revealedSet.has(offset)}
              onCardClick={handleCardClick}
              size="sm"
              fan={isHand}
            />
          ) : zone.cards.length > 0 ? (
            <CardStack
              count={zone.cards.length}
              size="sm"
              draggable={dnd.ready && dnd.canDragOut}
              onDragStart={(event) =>
                dnd.beginCardDrag(event, zone.cards[lastIndex], lastIndex)
              }
            />
          ) : (
            <p className="text-xs text-slate-400 italic">Drop cards here</p>
          )}
        </div>
      </div>
    </ZoneDropTarget>
  );
}

function ZoneEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const tableUrl = rootDocUrl(docUrl);
  const { ready: identityReady, userId } = usePlayerIdentity();
  const [subZone] = useDocument<CardZone>(docUrl, { suspense: true });
  const [table] = useDocument<CardTableDoc>(tableUrl, { suspense: true });
  const zone = useMemo(
    () => resolveZone(table, subZone, docUrl),
    [table, subZone, docUrl],
  );

  if (zone.role === "deck") {
    return <DeckSurface docUrl={docUrl} tableUrl={tableUrl} deck={zone} />;
  }

  if (!identityReady || !userId) {
    return (
      <div className="card-table h-full bg-slate-900 p-3 text-xs text-slate-400">
        Loading player identity…
      </div>
    );
  }

  return <ZoneSurface docUrl={docUrl} tableUrl={tableUrl} zone={zone} />;
}

function ZoneToolView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <Suspense
      fallback={<p className="p-3 text-xs text-slate-400">Loading zone…</p>}
    >
      <ZoneEditor docUrl={docUrl} />
    </Suspense>
  );
}

export const CardZoneTool = makeTool(ZoneToolView);
