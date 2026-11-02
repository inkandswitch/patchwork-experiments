import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { CardTableDatatype } from "./datatype";
import { loadLocalPlayer } from "./crypto/player-keys";
import { publishCardReveal } from "./crypto/reveal";
import { deckCardCount, deckZone, DEFAULT_DECK_ID } from "./ops/deck";
import { addZone, claimZone, dealCards, moveCardByRef } from "./ops/zones";
import type { CardTableDoc } from "./types";
import { ensureAgentIdentity, resolveName } from "./agent/identity";
import {
  advanceProtocol,
  joinTable,
  publishOwnShares,
  readOwnCards,
  readPublicCards,
  serviceKeyRequests,
  type AdvanceResult,
  type RevealedCard,
} from "./agent/runtime";
import type { Workspace } from "./agent/workspace";

function slug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "zone"}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Card-table skill for LLM agents. Lets an agent sit at a table as a real
 * cryptographic player and perform table mechanics (deal, draw, move, reveal,
 * inspect public/private cards) without encoding any game rules.
 */
export default function (workspace: Workspace) {
  const { repo } = workspace;

  async function table(url: AutomergeUrl) {
    const handle = await workspace.find<CardTableDoc>(url);
    await handle.whenReady();
    const agentId = await ensureAgentIdentity(workspace);

    const read = (): CardTableDoc => {
      const doc = handle.doc();
      if (!doc) throw new Error("Card table document is not available");
      return doc;
    };

    const api = {
      /** The agent's stable player id and display name. */
      async whoAmI() {
        return { id: agentId, name: await resolveName(workspace, agentId) };
      },

      /** Sit down at the table and signal readiness to start. */
      join() {
        joinTable(handle, agentId);
        return { joined: true, id: agentId };
      },

      /**
       * Drive the agent's share of keygen + shuffle toward a ready deck.
       * Other players must have their card-table tool open and readied up.
       */
      advance(opts?: { timeoutMs?: number }): Promise<AdvanceResult> {
        return advanceProtocol(url, handle, repo, agentId, opts?.timeoutMs);
      },

      /** Cooperatively answer other players' key-share requests. */
      serviceKeyRequests(opts?: { durationMs?: number }): Promise<number> {
        return serviceKeyRequests(handle, repo, agentId, opts?.durationMs ?? 0);
      },

      /** Snapshot of the table from the agent's perspective. */
      async status() {
        const doc = read();
        const deck = deckZone(doc);
        const participants = await Promise.all(
          doc.shuffleParticipants.map(async (p) => ({
            id: p.id,
            name: await resolveName(workspace, p.id),
            isMe: p.id === agentId,
            readyToStart: p.readyToStart,
            keygenReady: p.keygenReady,
          })),
        );
        const zones = doc.zones
          .filter((z) => z.role !== "deck")
          .map((z) => ({
            id: z.id,
            title: z.title,
            cardCount: z.cards.length,
            mine: z.ownerId === agentId,
            private: !!z.ownerId,
            faceUp: !!z.faceUp,
            revealedCount: z.revealedOffsets?.length ?? 0,
          }));
        return {
          title: doc.title,
          phase: doc.phase,
          ready: doc.phase === "ready",
          deckCount: deck?.cards.length ?? 0,
          participants,
          zones,
        };
      },

      /**
       * Create a zone. Omit `ownerId`/`private` for a shared pile, pass
       * `private: true` for the agent's own hand, or pass an explicit `ownerId`
       * (a participant's id from `status()`) to make a private hand for that
       * player — useful for dealing a human player into a game.
       */
      addZone(opts: {
        title: string;
        ownerId?: string;
        private?: boolean;
        faceUp?: boolean;
      }) {
        const id = slug(opts.title);
        const ownerId = opts.ownerId ?? (opts.private ? agentId : undefined);
        handle.change((doc) => {
          addZone(doc, { id, title: opts.title, ownerId, faceUp: opts.faceUp });
        });
        return { id };
      },

      /** Claim an existing unowned zone as the agent's private hand. */
      claimZone(zoneId: string) {
        handle.change((doc) => claimZone(doc, zoneId, agentId));
        return { id: zoneId };
      },

      /**
       * Publish the agent's key shares so other players can read their own
       * hands and any public cards without waiting for the agent to be online.
       * Runs automatically after deal/draw/move; call it explicitly if a human
       * reports they can't see cards the agent dealt.
       */
      publishShares(): Promise<number> {
        return publishOwnShares(handle, repo, agentId);
      },

      /** Deal `count` cards from the deck into any zone. */
      async deal(opts: { zoneId: string; count: number }) {
        handle.change((doc) => dealCards(doc, opts.zoneId, opts.count));
        await publishOwnShares(handle, repo, agentId);
        return { dealt: opts.count, zoneId: opts.zoneId };
      },

      /**
       * Draw `count` cards from the deck into the agent's private hand,
       * creating that hand if it does not yet exist.
       */
      async draw(opts?: { count?: number; handTitle?: string }) {
        const count = opts?.count ?? 1;
        let handZoneId = read().zones.find((z) => z.ownerId === agentId)?.id;
        if (!handZoneId) {
          handZoneId = slug(opts?.handTitle ?? "AI hand");
          handle.change((doc) => {
            addZone(doc, {
              id: handZoneId!,
              title: opts?.handTitle ?? "AI hand",
              ownerId: agentId,
              faceUp: false,
            });
          });
        }
        handle.change((doc) => dealCards(doc, handZoneId!, count));
        await publishOwnShares(handle, repo, agentId);
        return { drawn: count, zoneId: handZoneId };
      },

      /**
       * Deal `count` cards into a given player's private hand, creating that
       * hand if they don't have one yet. Pass the agent's own id to deal to
       * itself. The dealer cannot read the dealt cards unless they're revealed.
       */
      async dealTo(opts: {
        playerId: string;
        count?: number;
        handTitle?: string;
      }) {
        const count = opts.count ?? 1;
        const doc = read();
        if (!doc.shuffleParticipants.some((p) => p.id === opts.playerId)) {
          throw new Error(`Not a player at this table: ${opts.playerId}`);
        }
        let handZoneId = doc.zones.find(
          (z) => z.ownerId === opts.playerId,
        )?.id;
        if (!handZoneId) {
          handZoneId = slug(opts.handTitle ?? "Hand");
          handle.change((d) => {
            addZone(d, {
              id: handZoneId!,
              title: opts.handTitle ?? "Hand",
              ownerId: opts.playerId,
              faceUp: false,
            });
          });
        }
        handle.change((d) => dealCards(d, handZoneId!, count));
        await publishOwnShares(handle, repo, agentId);
        return { dealt: count, zoneId: handZoneId, playerId: opts.playerId };
      },

      /** Move one card between two zones (by source index). */
      async move(opts: { fromId: string; toId: string; fromIndex: number }) {
        handle.change((doc) =>
          moveCardByRef(
            doc,
            { id: opts.fromId },
            { id: opts.toId },
            opts.fromIndex,
          ),
        );
        await publishOwnShares(handle, repo, agentId);
        return { ok: true };
      },

      /** Publicly reveal one card the agent owns (publishes key shares). */
      async revealCard(opts: { zoneId: string; offset: number }) {
        const doc = read();
        const player = await loadLocalPlayer(repo, doc, agentId);
        if (!player) throw new Error("Agent keys are not available");
        await publishCardReveal(
          handle,
          doc,
          opts.zoneId,
          agentId,
          player,
          opts.offset,
        );
        return { revealed: opts.offset };
      },

      /** Reveal every card currently in one of the agent's owned zones. */
      async revealZone(zoneId: string) {
        const zone = read().zones.find((z) => z.id === zoneId);
        if (!zone) throw new Error(`Zone not found: ${zoneId}`);
        if (zone.ownerId !== agentId) {
          throw new Error("The agent can only reveal cards it owns");
        }
        const player = await loadLocalPlayer(repo, read(), agentId);
        if (!player) throw new Error("Agent keys are not available");
        for (const offset of [...zone.cards]) {
          await publishCardReveal(
            handle,
            read(),
            zoneId,
            agentId,
            player,
            offset,
          );
        }
        return { revealed: zone.cards.length };
      },

      /** Decrypt every publicly-visible card on the table. */
      lookAtPublicCards(opts?: { timeoutMs?: number }): Promise<RevealedCard[]> {
        return readPublicCards(handle, repo, agentId, opts?.timeoutMs);
      },

      /** Decrypt the agent's own private hand. */
      lookAtMyHand(opts?: { timeoutMs?: number }): Promise<RevealedCard[]> {
        return readOwnCards(handle, repo, agentId, opts?.timeoutMs);
      },

      /** Underlying Automerge handle, for advanced use. */
      get handle(): DocHandle<CardTableDoc> {
        return handle;
      },
    };

    return api;
  }

  return {
    /** Create a new card table document in the workspace folder. */
    async createTable(name = "Card Table") {
      const handle = await workspace.create<CardTableDoc>({
        name,
        type: "card-table",
      });
      handle.change((doc) => {
        CardTableDatatype.init(doc, repo);
        doc.title = name;
      });
      return { url: handle.url, table: () => table(handle.url) };
    },

    /** List card-table documents in the workspace folder. */
    async listTables() {
      const docs = await workspace.listDocuments();
      return docs.filter((d) => d.type === "card-table");
    },

    /** Get the agent's interface to an existing card table. */
    getTable(url: AutomergeUrl) {
      return table(url);
    },

    /** The default deck zone id ("deck"). */
    DECK_ID: DEFAULT_DECK_ID,
  };
}

export type { RevealedCard, AdvanceResult };
export { deckCardCount };
