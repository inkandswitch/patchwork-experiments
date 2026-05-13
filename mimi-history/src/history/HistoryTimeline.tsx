import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import { Show } from "solid-js";
import { $selectedDocUrls } from "@inkandswitch/annotations-selection";
import { useSubscribe } from "@inkandswitch/subscribables-solid";
import { DocHistoryView } from "./components/DocHistoryView";
import "../styles.css";

export interface PatchworkToolProps {
  repo: Repo;
}

/**
 * Main timeline component that renders history for the primary selected
 * document (the first URL in the selection). Ignores additional selected URLs
 * that may appear when interacting with the document, so that clicking in the
 * editor never spawns a second history panel below the original.
 */
export function HistoryTimeline(props: PatchworkToolProps) {
  const selectedDocUrls = useSubscribe($selectedDocUrls);
  const primaryUrl = () => selectedDocUrls()[0] as AutomergeUrl | undefined;

  return (
    <div class="flex flex-col h-full">
      <Show when={primaryUrl()} keyed>
        {(url) => (
          <DocHistoryView
            url={url}
            repo={props.repo}
          />
        )}
      </Show>
    </div>
  );
}
