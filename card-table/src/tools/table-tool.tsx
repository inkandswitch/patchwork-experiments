import {
  useDocHandle,
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Suspense, useCallback, useState } from "react";
import { ContactName, ShuffleParticipantRow } from "../components/ContactName";
import { ReadyToStartButton } from "../components/ReadyToStartButton";
import { canJoinTable } from "../crypto/protocol";
import { useAutoInit, useInitStatus } from "../hooks/use-auto-init";
import { useKeyExchange } from "../hooks/use-key-exchange";
import { useJoinTable } from "../hooks/use-join-table";
import { usePlayerIdentity } from "../hooks/use-player-identity";
import { makeTool } from "../make-tool";
import { dealCards } from "../ops/zones";
import { DEFAULT_DECK_ID, deckCardCount } from "../ops/deck";
import type { CardTableDoc } from "../types";

function TableEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const { ready: identityReady, userId } = usePlayerIdentity();
  const handle = useDocHandle<CardTableDoc>(docUrl, { suspense: true });
  const [doc, changeDoc] = useDocument<CardTableDoc>(docUrl, { suspense: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dealTargetHand, setDealTargetHand] = useState("");
  const [dealTargetPile, setDealTargetPile] = useState("");
  const [dealCount, setDealCount] = useState(1);

  const onInitError = useCallback((message: string) => {
    setError(message);
  }, []);

  const run = useCallback(
    async (label: string, fn: () => void | Promise<void>) => {
      setError(null);
      setBusy(label);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const joined = !!userId && doc.shuffleParticipants.some((p) => p.id === userId);
  const canJoin = !!userId && canJoinTable(doc);

  useJoinTable(doc, changeDoc, userId, identityReady);

  const status = useInitStatus(doc, userId);

  useAutoInit(
    docUrl,
    handle,
    repo,
    userId,
    doc,
    changeDoc,
    onInitError,
  );

  useKeyExchange(handle, doc, userId);

  if (!identityReady || !userId) {
    return (
      <div className="card-table h-full bg-slate-50 p-4 text-sm text-slate-500">
        Loading player identity…
      </div>
    );
  }

  const deal = (target: { handId?: string; pileId?: string }, count = 1) =>
    run("deal", () => {
      changeDoc((draft) => dealCards(draft, target, count));
    });

  return (
    <div className="card-table h-full overflow-y-auto bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <p className="text-sm text-slate-500">
            Phase: <span className="font-medium">{doc.phase}</span>
            {" · "}
            Stock: {deckCardCount(doc)}/{doc.deckSize}
          </p>
        </header>

        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {doc.phase !== "ready" ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-medium">Setup</h2>
            <p className="text-sm text-slate-600">{status}</p>
            {joined ? (
              <ReadyToStartButton
                doc={doc}
                userId={userId}
                changeDoc={changeDoc}
              />
            ) : canJoin ? (
              <p className="text-xs text-slate-400">
                Joining as <ContactName identity={userId} fallback="…" />…
              </p>
            ) : null}
            <ul className="text-xs text-slate-600 space-y-1">
              {doc.shuffleParticipants.map((participant, index) => (
                <li key={participant.id}>
                  <ShuffleParticipantRow
                    participant={participant}
                    showReady={doc.phase === "setup"}
                    active={
                      index === doc.shuffleTurn &&
                      (doc.phase === "shuffle-forward" ||
                        doc.phase === "shuffle-back")
                    }
                  />
                </li>
              ))}
              {doc.phase === "setup" && doc.shuffleParticipants.length === 0 ? (
                <li className="text-slate-400 italic">No players yet</li>
              ) : null}
            </ul>
          </section>
        ) : null}

        <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">Table</h2>
            {doc.phase === "ready" ? (
              <p className="text-xs text-slate-500">
                Drag from the deck tool onto hands or piles to deal, or onto a
                space canvas to place zones.
              </p>
            ) : null}
          </div>

          <div className="card-table-felt p-4">
            <div className="card-table-play-layout">
              <div className="flex justify-center md:justify-start">
                <patchwork-view
                  doc-url={handle.sub("decks", { id: DEFAULT_DECK_ID }).url}
                  tool-id="secure-deck"
                  class="block min-h-[8rem] w-full max-w-[10rem]"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {doc.hands.map((hand) => {
                  const handUrl = handle.sub("hands", { id: hand.id }).url;
                  return (
                    <div
                      key={hand.id}
                      className="card-table-zone-shell space-y-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {hand.title}
                          {hand.revealedOffsets?.length
                            ? ` · ${hand.revealedOffsets.length} revealed`
                            : hand.revealed
                              ? " · revealed"
                              : ""}
                        </p>
                        <p className="text-xs text-slate-500">
                          {hand.ownerId ? (
                            <ContactName identity={hand.ownerId} />
                          ) : (
                            "Unclaimed"
                          )}
                        </p>
                      </div>
                      <patchwork-view
                        key={handUrl}
                        doc-url={handUrl}
                        tool-id="secure-hand"
                        class="block min-h-[5rem]"
                      />
                    </div>
                  );
                })}
                {doc.piles.map((pile) => {
                  const pileUrl = handle.sub("piles", { id: pile.id }).url;
                  return (
                    <div
                      key={pile.id}
                      className="card-table-zone-shell space-y-2"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {pile.title}
                        {pile.faceUp ? " (face up)" : ""}
                      </p>
                      <patchwork-view
                        key={pileUrl}
                        doc-url={pileUrl}
                        tool-id="secure-pile"
                        class="block min-h-[5rem]"
                      />
                    </div>
                  );
                })}
                {!doc.hands.length && !doc.piles.length ? (
                  <p className="col-span-full text-center text-sm text-emerald-100/80 italic py-8">
                    Drag New hand or New pile from the deck tool, or deal cards
                    directly onto zones.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {doc.phase === "ready" ? (
          <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-medium">Deal from stock</h2>
            <div className="flex flex-wrap gap-2 items-end text-sm">
              <label className="text-xs space-y-1">
                Hand
                <select
                  className="block rounded border border-slate-300 px-2 py-1"
                  value={dealTargetHand}
                  onChange={(e) => {
                    setDealTargetHand(e.target.value);
                    setDealTargetPile("");
                  }}
                >
                  <option value="">—</option>
                  {doc.hands.map((hand) => (
                    <option key={hand.id} value={hand.id}>
                      {hand.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                Pile
                <select
                  className="block rounded border border-slate-300 px-2 py-1"
                  value={dealTargetPile}
                  onChange={(e) => {
                    setDealTargetPile(e.target.value);
                    setDealTargetHand("");
                  }}
                >
                  <option value="">—</option>
                  {doc.piles.map((pile) => (
                    <option key={pile.id} value={pile.id}>
                      {pile.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs space-y-1">
                Count
                <input
                  type="number"
                  min={1}
                  className="block w-16 rounded border border-slate-300 px-2 py-1"
                  value={dealCount}
                  onChange={(e) => setDealCount(Number(e.target.value) || 1)}
                />
              </label>
              <button
                type="button"
                className="rounded-md bg-indigo-700 px-3 py-1.5 text-white disabled:opacity-50"
                disabled={
                  !!busy ||
                  !deckCardCount(doc) ||
                  (!dealTargetHand && !dealTargetPile)
                }
                onClick={() =>
                  deal(
                    {
                      handId: dealTargetHand || undefined,
                      pileId: dealTargetPile || undefined,
                    },
                    dealCount,
                  )
                }
              >
                Deal
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function TableToolView({ docUrl }: { docUrl: AutomergeUrl }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-slate-500">Loading table…</p>}>
      <TableEditor docUrl={docUrl} />
    </Suspense>
  );
}

export const CardTableTool = makeTool(TableToolView);
