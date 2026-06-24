import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense, useCallback, type DragEvent } from "react";
import { CardStack } from "../components/CardStack";
import { ReadyToStartButton } from "../components/ReadyToStartButton";
import { canJoinTable } from "../crypto/protocol";
import { canDragDeck, deckLabel, useStockDrag } from "../hooks/use-zone-dnd";
import { useAutoInit, useInitStatus } from "../hooks/use-auto-init";
import { useKeyExchange } from "../hooks/use-key-exchange";
import { useJoinTable } from "../hooks/use-join-table";
import { usePlayerIdentity } from "../hooks/use-player-identity";
import { makeTool } from "../make-tool";
import { DEFAULT_DECK_ID } from "../ops/deck";
import { addHand, addPile } from "../ops/zones";
import { dragUrlWithTool, writePatchworkDrag } from "../patchwork-drag";
import { rootDocUrl, subDeckUrl, subHandUrl, subPileUrl } from "../paths";
import type { CardTableDoc, SecureDeckZone } from "../types";

function newZoneId(prefix: "hand" | "pile"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function DeckEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const tableUrl = rootDocUrl(docUrl);
  const { ready: identityReady, userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(tableUrl, { suspense: true });
  const [deck] = useDocument<SecureDeckZone>(docUrl, { suspense: true });
  const [table, changeDoc] = useDocument<CardTableDoc>(tableUrl, {
    suspense: true,
  });
  const canDrag = canDragDeck(table, deck);
  const count = deck.cards.length;
  const dragDeckCard = useStockDrag(tableUrl);
  const onInitError = useCallback((message: string) => {
    console.error("[secure-deck]", message);
  }, []);

  const joined =
    !!userId && table.shuffleParticipants.some((p) => p.id === userId);
  const canJoin = !!userId && canJoinTable(table);

  useJoinTable(table, changeDoc, userId, identityReady);

  const initMessage = useInitStatus(table, userId);

  useAutoInit(tableUrl, handle, repo, userId, table, changeDoc, onInitError);

  useKeyExchange(handle, table, userId);

  const dragDeckToCanvas = (event: DragEvent<HTMLButtonElement>) => {
    const deckSubUrl = subDeckUrl(tableUrl, deck.id ?? DEFAULT_DECK_ID);
    writePatchworkDrag(event.dataTransfer, "secure-deck", [
      {
        id: deck.id ?? DEFAULT_DECK_ID,
        url: dragUrlWithTool(deckSubUrl, "secure-deck"),
        name: deck.title || "Deck",
      },
    ]);
  };

  const dragSpawnHand = (event: DragEvent<HTMLButtonElement>) => {
    const handId = newZoneId("hand");
    const title = `Hand ${table.hands.length + 1}`;
    handle.change((draft) =>
      addHand(draft, { id: handId, title, ownerId: "" }),
    );
    const handUrl = subHandUrl(tableUrl, handId);
    writePatchworkDrag(event.dataTransfer, "secure-deck", [
      {
        id: handId,
        url: dragUrlWithTool(handUrl, "secure-hand"),
        name: title,
      },
    ]);
  };

  const dragSpawnPile =
    (faceUp: boolean) => (event: DragEvent<HTMLButtonElement>) => {
      const pileId = newZoneId("pile");
      const title = faceUp
        ? `Play area ${table.piles.length + 1}`
        : `Pile ${table.piles.length + 1}`;
      handle.change((draft) => addPile(draft, { id: pileId, title, faceUp }));
      const pileUrl = subPileUrl(tableUrl, pileId);
      writePatchworkDrag(event.dataTransfer, "secure-deck", [
        {
          id: pileId,
          url: dragUrlWithTool(pileUrl, "secure-pile"),
          name: title,
        },
      ]);
    };

  const hint =
    table.phase === "ready"
      ? ""
      : identityReady && userId
        ? initMessage
        : "Loading…";

  return (
    <div className="card-table card-table-deck-tool h-full min-h-[8rem]">
      <div className="card-table-felt flex h-full flex-col items-center justify-center gap-3 p-4">
        <CardStack
          count={count}
          draggable={canDrag}
          onDragStart={dragDeckCard}
          label={deckLabel(deck, table)}
        />
        {joined && table.phase === "setup" ? (
          <ReadyToStartButton
            doc={table}
            userId={userId!}
            changeDoc={changeDoc}
          />
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            draggable
            onDragStart={dragDeckToCanvas}
            className="card-table-canvas-drag rounded border border-emerald-200/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-100/90 cursor-grab active:cursor-grabbing"
            title="Drag onto the canvas to place the deck widget"
          >
            Place deck
          </button>
          <button
            type="button"
            draggable
            onDragStart={dragSpawnHand}
            className="card-table-canvas-drag rounded border border-emerald-200/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-100/90 cursor-grab active:cursor-grabbing"
            title="Drag onto the canvas to create a hand zone"
          >
            New hand
          </button>
          <button
            type="button"
            draggable
            onDragStart={dragSpawnPile(false)}
            className="card-table-canvas-drag rounded border border-emerald-200/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-100/90 cursor-grab active:cursor-grabbing"
            title="Drag onto the canvas to create a face-down pile zone"
          >
            New pile
          </button>
          <button
            type="button"
            draggable
            onDragStart={dragSpawnPile(true)}
            className="card-table-canvas-drag rounded border border-emerald-200/40 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-100/90 cursor-grab active:cursor-grabbing"
            title="Drag onto the canvas to create a face-up play area"
          >
            New play area
          </button>
        </div>
        <p className="max-w-[14rem] text-center text-[11px] leading-snug text-emerald-100/80">
          {hint}
        </p>
      </div>
    </div>
  );
}

function DeckToolView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <Suspense
      fallback={<p className="p-3 text-xs text-slate-400">Loading deck…</p>}
    >
      <DeckEditor docUrl={docUrl} />
    </Suspense>
  );
}

export const SecureDeckTool = makeTool(DeckToolView);
