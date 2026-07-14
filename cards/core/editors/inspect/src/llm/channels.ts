import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { createFilesApi } from "./files";

// The channels API handed to the LLM's script blocks: live introspection of
// the shared context store plus provenance-following. `list` answers "what
// channels exist right now, who writes and reads them, and which package
// defines each"; `spec`/`definition` follow a channel's `definedBy`/`spec`
// attribution (automerge urls into the owning package) so the model can read
// the owning package's contract and canonical channel module before importing
// it.
//
// The store is discovered exactly the way generated cards do it (the DOM
// request event, falling back to the page-global body store), so what the
// model sees is what its card will see.

export type Channels = {
  list(): ChannelSummary[];
  read(name: string): Record<string, unknown>;
  spec(name: string): Promise<string>;
  definition(name: string): Promise<string>;
};

export type ChannelSummary = {
  name: string;
  // The canonical channel module's automerge url (`automerge:<pkg>/channels.js`)
  // — the module consumers import. Absent for channels defined inline by a
  // writer that carries no attribution.
  definedBy?: string;
  // The owning package's spec (`automerge:<pkg>/spec.md`).
  spec?: string;
  set?: boolean;
  writers: string[];
  readers: Array<{ owner: string; keys?: string[] }>;
  // A truncated preview of the merged value; use `read(name)` for the full value.
  merged: string;
};

type ScopeOwner = { docUrl?: string; embedId?: string; toolId?: string };

type ChannelLike = {
  name: string;
  empty: Record<string, unknown>;
  set?: true;
  definedBy?: string;
  spec?: string;
};

type StoreLike = {
  channels(): ChannelLike[];
  read(channel: ChannelLike): Record<string, unknown>;
  scopes(
    channel: ChannelLike,
  ): Array<{ owner: ScopeOwner; slice: Record<string, unknown> }>;
  interests(channel: ChannelLike): Array<{ owner: ScopeOwner; keys?: string[] }>;
};

export function createChannelsApi(repo: Repo, storeElement: Element): Channels {
  const channelByName = (name: string): ChannelLike => {
    const store = findStore(storeElement);
    if (!store) throw new Error("no context store reachable from the inspector");
    const channel = store.channels().find((c) => c.name === name);
    if (!channel) {
      const known = store
        .channels()
        .map((c) => c.name)
        .sort()
        .join(", ");
      throw new Error(`Unknown channel: ${name}. Live channels: ${known}`);
    }
    return channel;
  };

  return {
    list() {
      const store = findStore(storeElement);
      if (!store) {
        throw new Error("no context store reachable from the inspector");
      }
      return store
        .channels()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((channel) => summarize(store, channel));
    },

    read(name) {
      const store = findStore(storeElement);
      if (!store) {
        throw new Error("no context store reachable from the inspector");
      }
      return store.read(channelByName(name));
    },

    async spec(name) {
      const channel = channelByName(name);
      if (!channel.spec) {
        throw new Error(
          `Channel ${name} carries no spec attribution (it was defined inline by a writer).`,
        );
      }
      return readPackageFile(repo, channel.spec);
    },

    async definition(name) {
      const channel = channelByName(name);
      if (!channel.definedBy) {
        throw new Error(
          `Channel ${name} carries no definedBy attribution (it was defined inline by a writer).`,
        );
      }
      return readPackageFile(repo, channel.definedBy);
    },
  };
}

function summarize(store: StoreLike, channel: ChannelLike): ChannelSummary {
  const summary: ChannelSummary = {
    name: channel.name,
    writers: store.scopes(channel).map((scope) => ownerLabel(scope.owner)),
    readers: store.interests(channel).map((interest) => ({
      owner: ownerLabel(interest.owner),
      ...(interest.keys ? { keys: interest.keys } : {}),
    })),
    merged: safeJson(store.read(channel), 600),
  };
  if (channel.definedBy) summary.definedBy = channel.definedBy;
  if (channel.spec) summary.spec = channel.spec;
  if (channel.set) summary.set = true;
  return summary;
}

// Read a `automerge:<packageId>/<path…>` attribution url through the same
// files-as-text lens the rest of the loop uses.
async function readPackageFile(repo: Repo, url: string): Promise<string> {
  const match = /^(automerge:[^/]+)\/(.+)$/.exec(url);
  if (!match) throw new Error(`Not a package file url: ${url}`);
  const packageUrl = match[1] as AutomergeUrl;
  const path = match[2];
  return createFilesApi(repo, packageUrl).read(path);
}

function findStore(element: Element): StoreLike | undefined {
  const detail: { store?: StoreLike } = {};
  element.dispatchEvent(
    new CustomEvent("patchwork:context-request", {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
  const bodyStore = (
    document.body as unknown as Record<symbol, StoreLike | undefined>
  )[Symbol.for("patchwork.context-store.v1")];
  return detail.store ?? bodyStore;
}

function ownerLabel(owner: ScopeOwner): string {
  const parts: string[] = [];
  if (owner.toolId) parts.push(`tool=${owner.toolId}`);
  if (owner.docUrl) parts.push(`doc=${owner.docUrl}`);
  if (owner.embedId) parts.push(`embed=${owner.embedId}`);
  return parts.length > 0 ? parts.join(" ") : "(anonymous)";
}

// JSON that never throws: live objects (codemirror:extensions) and circular
// values degrade to a marker instead of failing the whole listing.
function safeJson(value: unknown, max: number): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_key, v) => {
      if (typeof v === "function") return "[function]";
      return v;
    });
  } catch {
    const keys =
      value !== null && typeof value === "object"
        ? Object.keys(value as Record<string, unknown>).join(", ")
        : String(value);
    text = `[unserializable; keys: ${keys}]`;
  }
  if (text === undefined) text = String(value);
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}
