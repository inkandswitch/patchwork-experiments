# Solid.js Idiomacy Refactor — Chat Tool

## Context

The Solid code was written with React idioms: imperative `.then()` chains for async data, a centralized `msgCache` store that eagerly loads every message doc upfront, `Index` instead of `For`, early returns that break reactivity, and `createMemo` used for side effects. This refactor makes it idiomatic Solid: resources for async, `<Suspense>` for loading boundaries, `<For>` keyed by identity, `mapArray` for the message→accessor mapping, and reactive access patterns throughout.

## Files to Modify

1. **`src/context.tsx`** — Remove `msgCache`/`resolveMessageDoc`/`blobCache` from context. Add `useBlobUrl(url)` and `useAudioUrl(url)` resource helpers. Keep the emoticon cache and other imperative state.
2. **`src/Chat.tsx`** — Remove `msgCache`, `msgDocSubscribed`, `resolveMessageDoc`, `blobCache`, `blobPromises`. Simplify `mapArray` to just map entries to stable identifiers. Stop passing `messageAccessors()` (unwrapped) — pass the accessor itself. Remove `totalRefs`/`loadedRefs` loading bar (replaced by per-message Suspense).
3. **`src/MessageList.tsx`** — Use `<For>` keyed by `entry.url || entry.id`. Each item wraps its content in `<Suspense>`. Remove `Index` double-accessor pattern. Remove loading bar.
4. **`src/Message.tsx`** — Each ref message uses `useDocument(url)` from `@automerge/automerge-repo-solid-primitives` to lazily load its doc. Replace all `.then(setBlobUrl)` patterns with `useBlobUrl()`. Fix early returns → `<Show>`/`<Switch>`. Fix `createMemo` side effect in Avatar → `createResource`.
5. **`src/types.ts`** — Simplify `ResolvedMessage` (remove `_ref` / `_unavailable` / `_docUrl` — handle states via resource state instead).

## Detailed Changes

### 1. New helper: `useBlobUrl` / `useAudioUrl` (in context.tsx or new file)

```ts
// Module-level shared cache so multiple components don't refetch
const blobUrlCache = new Map<string, Promise<string | null>>()

export function useBlobUrl(url: Accessor<string | undefined>): Resource<string | null> {
  const [res] = createResource(url, async (automergeUrl) => {
    if (blobUrlCache.has(automergeUrl)) return blobUrlCache.get(automergeUrl)!
    const p = (async () => {
      const fh = await window.repo.find(automergeUrl)
      const d = fh.doc()
      if (!d?.content) return null
      const bytes = d.content instanceof Uint8Array ? d.content : new Uint8Array(d.content)
      return URL.createObjectURL(new Blob([bytes], d.mimeType ? {type: d.mimeType} : {}))
    })()
    blobUrlCache.set(automergeUrl, p)
    return p
  })
  return res
}
```

Similar for `useAudioUrl`.

### 2. Chat.tsx — mapArray simplification

```ts
// Instead of resolving docs here, just pass stable entries
const messages = mapArray(
  () => (doc.messages || []) as MessageEntry[],
  (entry, idx) => ({ entry, idx })
)
```

Pass `messages` (the accessor) to MessageList. Don't unwrap it.

### 3. MessageList.tsx — `<For>` + `<Suspense>`

```tsx
<For each={messages()}>
  {(item) => (
    <Suspense fallback={<div class="chat-msg-skeleton" />}>
      <MessageItem entry={item.entry} idx={item.idx} allMessages={messages} />
    </Suspense>
  )}
</For>
```

Each `MessageItem` internally does:
- If `entry.ref && entry.url` → `useDocument(entry.url)` to lazily load
- Otherwise uses inline data directly

### 4. Message.tsx — Fix reactivity anti-patterns

**Early returns → `<Show>` / `<Switch><Match>`:**
```tsx
// WRONG (kills reactivity)
if (msg().action) return <ActionMessage ... />

// RIGHT
<Switch>
  <Match when={msg()._unavailable}><UnavailableMessage ... /></Match>
  <Match when={msg().action}><ActionMessage ... /></Match>
  <Match when={props.isContinuation}><ContinuationMessage ... /></Match>
  <Match when={true}><FullMessage ... /></Match>
</Switch>
```

**Avatar — `createMemo` with side effect → `useBlobUrl`:**
```tsx
// WRONG
createMemo(() => {
  const src = avatarSrc()
  if (src) ctx.loadBlobUrl(src).then(u => setBlobUrl(u))
})

// RIGHT
const blobUrl = useBlobUrl(() => props.msg.gifSelfieUrl || props.msg.avatarUrl)
```

**Same pattern for:** `ReplyRef`, `GifInline`, `ImageAttachment`, `FileAttachment`, `PresenceAvatar`, `EmoticonButton`

**Reactions — early return → `<Show>`:**
```tsx
// WRONG
if (!reactions() || Object.keys(reactions()!).length === 0) return null

// RIGHT — just wrap the whole body in <Show>
<Show when={...}>...</Show>
```

### 5. MessageItem component — lazy doc loading

```tsx
function MessageItem(props: { entry: MessageEntry; idx: Accessor<number>; ... }) {
  // For ref entries, lazily load the doc
  const [doc, handle] = isRef(props.entry)
    ? useDocument<MessageData>(props.entry.url)
    : [() => props.entry, undefined]

  const msg = (): ResolvedMessage | undefined => {
    const d = doc()
    if (!d) return undefined
    return { ...d, _rawIdx: props.idx(), _handle: handle?.() }
  }

  return (
    <Show when={msg()}>
      {(m) => <Message msg={m()} isContinuation={...} allMessages={...} />}
    </Show>
  )
}
```

The `useDocument` call is a Solid resource — it suspends until loaded. Combined with the `<Suspense>` boundary in MessageList, this means messages load lazily as they render, not all upfront.

### 6. Context slimming

Remove from ChatContextValue:
- `blobCache`, `loadBlobUrl`, `loadAudioUrl` → replaced by `useBlobUrl`/`useAudioUrl` helpers
- `msgCache`, `resolveMessageDoc` → replaced by per-component `useDocument`
- `emoticonBlobCache`, `loadEmoticonBlobUrl` → replaced by `useBlobUrl`

Keep in context (these are genuinely shared mutable state):
- `handle`, `repo`, identity signals, presence, reactions, reply, files, recording, GIF, send, etc.

### 7. toggleReaction / deleteMessage — callback approach

These currently use `msgCache[url]` to find handles. Instead, Message passes its handle directly into the callbacks:

```ts
// context toggleReaction becomes:
toggleReaction: (rawIdx: number, emoji: string, msgHandle?: DocHandle<any>) => void

// Message calls:
ctx.toggleReaction(rawIdx(), emoji, handle)
```

Same for `deleteMessage`. The context functions check if a handle was passed; if so, use it for ref messages. If not (inline messages), mutate the chat doc directly as before.

## Verification

1. `cd /Users/chee/soft/inkandswitch/patchwork-tools/chat && pnpm build` — must compile clean
2. Verify messages load lazily (only visible messages trigger `repo.find`)
3. Verify reactions, replies, delete still work on ref messages
4. Verify blob URLs load for avatars, images, voice notes
5. Verify presence, typing, notifications unchanged
