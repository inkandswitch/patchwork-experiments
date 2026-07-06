import type { AutomergeUrl } from "@automerge/automerge-repo";
import { For, Index, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import { runCardGeneration } from "./llm/run";
import type { CardDocLike, ContentBlock, Message } from "./llm/types";

// The regeneration footer under the Spec tab: a button that runs the LLM loop
// (rewrite the card's behavior module to match the spec) plus a streaming log
// of the assistant's text and script blocks. Only rendered when the inspected
// document is a card — the loop needs a card doc to repoint at the new module.
export function RegeneratePanel(props: {
  packageUrl: AutomergeUrl;
  documentUrl: AutomergeUrl;
}) {
  const repo = useRepo();
  const cardHandle = useDocHandle<CardDocLike>(() => props.documentUrl);
  const [cardDoc] = useDocument<CardDocLike>(() => props.documentUrl);
  const isCard = () => cardDoc()?.["@patchwork"]?.type === "card";

  const [messages, setMessages] = createSignal<Message[]>([]);
  const [running, setRunning] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  let abort: AbortController | undefined;

  const start = async () => {
    const handle = cardHandle();
    if (!handle || running()) return;
    abort = new AbortController();
    setRunning(true);
    setNotice(null);
    setMessages([]);
    try {
      const result = await runCardGeneration({
        repo,
        packageUrl: props.packageUrl,
        cardHandle: handle,
        signal: abort.signal,
        onUpdate: setMessages,
      });
      if (result.error) {
        setNotice(`Generation failed: ${result.error}`);
      } else if (abort.signal.aborted) {
        setNotice("Stopped.");
      } else if (!result.sourceWasSet) {
        setNotice(
          "The run finished without repointing the card at a new module — the behavior may not have reloaded.",
        );
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => abort?.abort();
  onCleanup(() => abort?.abort());

  // Only the assistant's side of the exchange is worth showing — the seeded
  // user message repeats the spec and module source visible right above.
  const blocks = () =>
    messages().flatMap<ContentBlock>((msg) => {
      if (msg.role !== "assistant") return [];
      return typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : msg.content;
    });

  // Keep the newest output in view as it streams.
  let logEl: HTMLDivElement | undefined;
  createEffect(() => {
    blocks();
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  });

  return (
    <Show when={isCard()}>
      <div class="embark-inspect-regen">
        <div class="embark-inspect-regen__bar">
          <button
            type="button"
            class="embark-inspect-regen__button"
            classList={{ "embark-inspect-regen__button--stop": running() }}
            on:pointerdown={(event) => event.stopPropagation()}
            on:click={() => (running() ? stop() : void start())}
          >
            {running() ? "Stop" : "Regenerate code"}
          </button>
          <Show when={running()}>
            <span class="embark-inspect-regen__status">Generating…</span>
          </Show>
        </div>

        <Show when={notice()}>
          {(text) => <div class="embark-inspect-regen__notice">{text()}</div>}
        </Show>

        <Show when={blocks().length > 0}>
          <div class="embark-inspect-regen__log" ref={logEl}>
            <Index each={blocks()}>
              {(block) => <LogBlock block={block()} />}
            </Index>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function LogBlock(props: { block: ContentBlock }) {
  return (
    <Show
      when={props.block.type === "script" ? props.block : null}
      fallback={
        <div class="embark-inspect-regen__text">
          {props.block.type === "text" ? props.block.text : ""}
        </div>
      }
    >
      {(script) => (
        <div class="embark-inspect-regen__script">
          <Show when={script().description}>
            <div class="embark-inspect-regen__script-desc">
              {script().description}
            </div>
          </Show>
          <pre class="embark-inspect-regen__code">{script().code}</pre>
          <For each={scriptResults(script())}>
            {(result) => (
              <pre
                class="embark-inspect-regen__result"
                classList={{
                  "embark-inspect-regen__result--error": result.kind === "error",
                }}
              >
                {result.text}
              </pre>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}

function scriptResults(
  script: Extract<ContentBlock, { type: "script" }>,
): Array<{ kind: "output" | "error"; text: string }> {
  const results: Array<{ kind: "output" | "error"; text: string }> = [];
  if (script.output) results.push({ kind: "output", text: script.output });
  if (script.error) results.push({ kind: "error", text: script.error });
  return results;
}
