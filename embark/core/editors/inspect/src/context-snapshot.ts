// A plain-text dump of the shared context store for the copy-context export:
// every channel's merged value, its writers (scoped slices with owners), and
// its readers (interests with declared keys). One paste answers the usual
// debugging questions — did the card query, did anyone answer, is anything
// listening.
//
// The inspect package deliberately doesn't depend on @embark/context, so the
// store is discovered exactly the way generated cards do it: the DOM request
// event, falling back to the page-global body store. Channels are matched by
// name, so the structural types below are enough to read everything.

type ScopeOwner = { docUrl?: string; embedId?: string; toolId?: string };

type ChannelLike = { name: string; empty: Record<string, unknown> };

type StoreLike = {
  channels(): ChannelLike[];
  read(channel: ChannelLike): Record<string, unknown>;
  scopes(
    channel: ChannelLike,
  ): Array<{ owner: ScopeOwner; slice: Record<string, unknown> }>;
  interests(channel: ChannelLike): Array<{ owner: ScopeOwner; keys?: string[] }>;
};

export function contextSnapshot(element: Element): string {
  const store = findStore(element);
  const repoNote = `window.repo: ${
    (window as { repo?: unknown }).repo ? "present" : "MISSING"
  }`;
  if (!store) {
    return `${repoNote}\n\n(no context store reachable from the inspector)`;
  }
  const channels = store
    .channels()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((channel) => describeChannel(store, channel));
  if (channels.length === 0) {
    return `${repoNote}\n\n(the store knows no channels yet)`;
  }
  return [repoNote, ...channels].join("\n\n");
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

function describeChannel(store: StoreLike, channel: ChannelLike): string {
  const merged = safeJson(store.read(channel), 2500);
  const writers = store
    .scopes(channel)
    .map((scope) => `  - ${ownerLabel(scope.owner)}: ${safeJson(scope.slice, 800)}`);
  const readers = store.interests(channel).map((interest) => {
    const keys = interest.keys
      ? ` keys: ${safeJson(interest.keys, 400)}`
      : " (whole channel)";
    return `  - ${ownerLabel(interest.owner)}${keys}`;
  });
  return [
    `### ${channel.name}`,
    `- merged: ${merged}`,
    `- writers (${writers.length}):`,
    ...(writers.length > 0 ? writers : ["  (none)"]),
    `- readers (${readers.length}):`,
    ...(readers.length > 0 ? readers : ["  (none)"]),
  ].join("\n");
}

function ownerLabel(owner: ScopeOwner): string {
  const parts: string[] = [];
  if (owner.toolId) parts.push(`tool=${owner.toolId}`);
  if (owner.docUrl) parts.push(`doc=${owner.docUrl}`);
  if (owner.embedId) parts.push(`embed=${owner.embedId}`);
  return parts.length > 0 ? parts.join(" ") : "(anonymous)";
}

// JSON that never throws: live objects (codemirror:extensions) and circular
// values degrade to a marker instead of killing the whole snapshot.
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
