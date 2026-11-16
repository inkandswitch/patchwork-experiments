import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import { useRepo } from "@automerge/automerge-repo-react-hooks";
import { subscribe } from "@inkandswitch/patchwork-providers";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DRAFT_STATE_PROVIDER, SCOPE_ATTR } from "./drafts";

/**
 * A document's own providers, as threepane gives its one document: the draft
 * state (bound to the doc) and overlay, any `document-provider` components,
 * then comments and focus. Everything about that document lives inside it —
 * its view, and the drawer of context tools describing it — so a context tool
 * talks to *this* document's providers: History and Drafts see the
 * checked-out draft and checkpoint through the overlay and move them through
 * the draft state; Comments and the editor share one focus doc, so a click on
 * a comment can ask for the comments view (see {@link CommentsOpener}).
 */

/** One provider in a {@link DocScope}, outermost first. */
export type ScopedProvider = { id: string; docUrl?: AutomergeUrl };

/**
 * Nests `providers` (outermost first) around `children`.
 *
 * A view must not mount until every provider above it is listening: a
 * document it asks for before then (`repo:handle-descriptor`) is answered by
 * the root's pass-through, and it keeps that answer for good, so no draft or
 * history scrub ever reaches it. So the chain is built in order, as
 * threepane's is — each provider is rendered only once the one outside it has
 * reported `patchwork:mounted`, and the children only once the last has.
 * The listener counting those is on an element rendered before any provider,
 * so a provider that mounts the moment it's connected is still heard. There is
 * no time-out: a provider that never mounts leaves the panel empty (and says
 * so in the console) rather than showing a document its scrubs can't reach.
 *
 * A different list of providers (drafts registering after the panel opened,
 * say) is a different scope, built afresh: reusing the elements would turn
 * them into other providers in place while the view beneath them stays.
 *
 * When the stack includes the draft state provider, `onScope` gets its element
 * once the chain is complete (and `null` after), for the frame-wide relay
 * (overlays) to forward draft requests to.
 */
export const DocScope = (props: {
  leafId: string;
  providers: ScopedProvider[];
  onScope?: (leafId: string, scope: HTMLElement | null) => void;
  children: ReactNode;
}) => {
  const key = props.providers
    .map((p) => `${p.id}@${p.docUrl ?? ""}`)
    .join("|");
  return <ProviderChain key={key} {...props} />;
};

/** How long (ms) to wait on a provider before saying so in the console. */
const PROVIDER_SLOW_MS = 10_000;

const ProviderChain = ({
  leafId,
  providers,
  onScope,
  children,
}: {
  leafId: string;
  providers: ScopedProvider[];
  onScope?: (leafId: string, scope: HTMLElement | null) => void;
  children: ReactNode;
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [listening, setListening] = useState(false);
  // How many providers, outermost first, have mounted.
  const [ready, setReady] = useState(0);
  const draftState = useRef<HTMLElement | null>(null);
  const complete = listening && ready === providers.length;

  // One listener for the scope's life, attached before the first provider is
  // rendered; a provider is rendered only after the one before it is counted,
  // so each mount lands on a listener that's already there. Only the provider
  // being waited on counts (the views' own mounts and nested components bubble
  // here too).
  useEffect(() => {
    if (!anchor) return;
    let count = 0;
    const onMounted = (event: Event) => {
      const id = (event as CustomEvent<{ componentId?: string }>).detail
        ?.componentId;
      if (count >= providers.length || id !== providers[count].id) return;
      setReady(++count);
    };
    anchor.addEventListener("patchwork:mounted", onMounted);
    setListening(true);
    return () => anchor.removeEventListener("patchwork:mounted", onMounted);
    // `providers` is fixed for this chain: DocScope keys it on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  useEffect(() => {
    if (!listening || ready >= providers.length) return;
    const waiting = providers[ready].id;
    const slow = setTimeout(
      () => console.warn(`[tiling] still waiting for ${waiting} to mount`),
      PROVIDER_SLOW_MS,
    );
    return () => clearTimeout(slow);
  }, [listening, ready, providers]);

  useEffect(() => {
    if (!complete || !onScope || !draftState.current) return;
    onScope(leafId, draftState.current);
    return () => onScope(leafId, null);
  }, [complete, leafId, onScope]);

  const nest = (i: number): ReactNode => {
    if (i === providers.length) return complete ? children : null;
    if (!listening || ready < i) return null;
    const provider = providers[i];
    const isDraftState = provider.id === DRAFT_STATE_PROVIDER;
    return (
      <patchwork-view
        component={provider.id}
        doc-url={provider.docUrl}
        style={{ display: "contents" }}
        ref={(el: HTMLElement | null) => {
          if (isDraftState) draftState.current = el;
        }}
        {...(isDraftState ? { [SCOPE_ATTR]: leafId } : {})}
      >
        {ready > i ? nest(i + 1) : null}
      </patchwork-view>
    );
  };
  return (
    <div ref={setAnchor} style={{ display: "contents" }}>
      {nest(0)}
    </div>
  );
};

type FocusDoc = {
  commentViewOpeners?: Record<string, true>;
  openCommentView?: number;
};

/**
 * Lets an editor bring a comments view up, as threepane's does. While
 * `enabled`, it lists `id` in its scope's focus doc as something that can
 * open a comments view; when an editor bumps `openCommentView` (a comment was
 * clicked with no comments view on screen), `onOpen` runs. Only asks made
 * after it starts listening count. Must render inside the focus provider.
 */
export const CommentsOpener = ({
  id,
  enabled,
  onOpen,
}: {
  id: string;
  enabled: boolean;
  onOpen: () => void;
}) => {
  const repo = useRepo();
  const ref = useRef<HTMLSpanElement>(null);
  const [focusUrl, setFocusUrl] = useState<AutomergeUrl | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return subscribe<AutomergeUrl>(el, { type: "patchwork:focus" }, setFocusUrl);
  }, []);

  useEffect(() => {
    if (!focusUrl || !enabled) return;
    let cancelled = false;
    let handle: DocHandle<FocusDoc> | null = null;
    let stopListening = () => {};
    void repo.find<FocusDoc>(focusUrl).then((found) => {
      if (cancelled) return;
      handle = found;
      found.change((doc) => {
        if (!doc.commentViewOpeners) doc.commentViewOpeners = {};
        doc.commentViewOpeners[id] = true;
      });
      let seen = found.doc()?.openCommentView ?? 0;
      const onChange = ({ doc }: { doc?: FocusDoc }) => {
        const asked = doc?.openCommentView ?? 0;
        if (asked === seen) return;
        seen = asked;
        onOpenRef.current();
      };
      found.on("change", onChange);
      stopListening = () => found.off("change", onChange);
    });
    return () => {
      cancelled = true;
      stopListening();
      handle?.change((doc) => {
        if (doc.commentViewOpeners) delete doc.commentViewOpeners[id];
      });
    };
  }, [focusUrl, enabled, id, repo]);

  return <span ref={ref} hidden />;
};
