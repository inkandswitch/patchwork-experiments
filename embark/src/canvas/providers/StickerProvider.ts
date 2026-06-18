import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { accept, type SubscribeEvent } from "@inkandswitch/patchwork-providers";
import {
  STICKERS_ON_DOCUMENT,
  STICKERS_REGISTRY,
  type StickerRegistryDoc,
} from "../../stickers/types";

// The sticker broker. Like the search broker, it sits on the canvas element and
// bridges two roles that can't talk directly (the provider protocol only flows
// up the DOM, and sticker sources / renderers are sibling embeds):
//
//   - contributor  subscribe({ type: STICKERS_REGISTRY })            -> registry doc url
//   - renderer     subscribe({ type: STICKERS_ON_DOCUMENT, url })    -> sticker sub-urls
//
// A contributor is handed a fresh, ephemeral `StickerRegistryDoc` (keyed by
// target *document* url) to write its stickers into. A renderer asks "what
// targets this document?" and gets back the sub-urls of every sticker any
// contributor stored under that document — each resolvable via `repo.find` to a
// live `Sticker`. The broker re-emits to a renderer only when its document's
// slice actually changes.
type RegistrySubscriber = {
  url: AutomergeUrl;
  respond: (urls: AutomergeUrl[]) => void;
  last?: AutomergeUrl[];
};

export function StickerProvider(element: ToolElement): () => void {
  const repo = element.repo;
  // Renderers waiting on stickers for a specific document.
  const subscribers = new Set<RegistrySubscriber>();
  // Every live contributor's registry doc handle.
  const contributors = new Set<DocHandle<StickerRegistryDoc>>();

  const onSubscribe = (event: SubscribeEvent) => {
    const { type } = event.detail.selector;
    if (type === STICKERS_REGISTRY) acceptContributor(event);
    else if (type === STICKERS_ON_DOCUMENT) acceptRenderer(event);
  };

  // A contributor joins: mint a fresh registry doc, relay its writes, and clean
  // the doc up when the contributor unsubscribes.
  const acceptContributor = (event: SubscribeEvent) => {
    accept<AutomergeUrl>(event, (respond) => {
      const handle = repo.create<StickerRegistryDoc>({});
      contributors.add(handle);
      const onChange = () => emitAll();
      handle.on("change", onChange);
      respond(handle.url);

      return () => {
        contributors.delete(handle);
        handle.off("change", onChange);
        handle.delete();
        emitAll();
      };
    });
  };

  // A renderer registers for one document. Respond with the current sticker
  // sub-urls and re-emit whenever that document's slice changes.
  const acceptRenderer = (event: SubscribeEvent) => {
    const url = event.detail.selector.url as AutomergeUrl | undefined;
    if (!url) return;
    accept<AutomergeUrl[]>(event, (respond) => {
      const subscriber: RegistrySubscriber = { url, respond };
      subscribers.add(subscriber);
      writeSubscriber(subscriber);
      return () => subscribers.delete(subscriber);
    });
  };

  // The sticker sub-urls every contributor stored under `target`. Each is
  // `registryHandle.sub(target, index).url` — a native automerge sub-url
  // pointing at the sticker object, which the renderer resolves with
  // `repo.find`.
  const stickerUrlsForTarget = (target: AutomergeUrl): AutomergeUrl[] => {
    const out: AutomergeUrl[] = [];
    for (const handle of contributors) {
      const stickers = handle.doc()?.[target];
      if (!stickers) continue;
      for (let index = 0; index < stickers.length; index++) {
        out.push(handle.sub(target, index).url);
      }
    }
    return out;
  };

  // Push a subscriber's current sticker urls, but only when they differ so an
  // unrelated contributor edit doesn't churn the renderer.
  const writeSubscriber = (subscriber: RegistrySubscriber) => {
    const next = stickerUrlsForTarget(subscriber.url);
    if (subscriber.last && sameUrls(subscriber.last, next)) return;
    subscriber.last = next;
    subscriber.respond(next);
  };

  const emitAll = () => {
    for (const subscriber of subscribers) writeSubscriber(subscriber);
  };

  element.addEventListener("patchwork:subscribe", onSubscribe);

  return () => {
    element.removeEventListener("patchwork:subscribe", onSubscribe);
    subscribers.clear();
    for (const handle of contributors) handle.delete();
    contributors.clear();
  };
}

function sameUrls(a: AutomergeUrl[], b: AutomergeUrl[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((url, index) => url === b[index]);
}
