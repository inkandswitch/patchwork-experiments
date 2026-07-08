import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import { For, Index, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { useDocHandle, useDocument, useRepo } from "solid-automerge";
import {
  formatTranscript,
  modulePathOf,
  readOptional,
  runCardGeneration,
} from "./llm/run";
import { createFilesApi } from "./llm/files";
import { contextSnapshot } from "./context-snapshot";
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
      } else if (!result.moduleChanged) {
        setNotice(
          "The run finished without touching the card's module — the behavior was not changed.",
        );
      }
    } finally {
      setRunning(false);
    }
  };

  const stop = () => abort?.abort();
  onCleanup(() => abort?.abort());

  // One-click debugging export: the card doc, spec, current module source,
  // this session's LLM transcript, and a live context-store snapshot as a
  // single pasteable markdown blob.
  const [copied, setCopied] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;
  const copyContext = async () => {
    const handle = cardHandle();
    if (!handle) return;
    try {
      const text = await buildDebugContext(
        repo,
        props.packageUrl,
        handle,
        messages(),
        rootEl ?? document.body,
      );
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setNotice(
        `Copy failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Only the assistant's side of the exchange is worth showing — the seeded
  // user message repeats the spec and module source visible right above.
  const blocks = () =>
    messages().flatMap<ContentBlock>((msg) => {
      if (msg.role !== "assistant") return [];
      return typeof msg.content === "string"
        ? [{ type: "text", text: msg.content }]
        : msg.content;
    });

  // Keep the newest output in view as it streams, but only while the log is
  // already at its tail — scrolling up pauses the follow so earlier output
  // stays readable mid-run, and scrolling back to the bottom resumes it.
  let logEl: HTMLDivElement | undefined;
  let followTail = true;
  const onLogScroll = () => {
    if (!logEl) return;
    followTail =
      logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 24;
  };
  createEffect(() => {
    blocks();
    if (logEl && followTail) logEl.scrollTop = logEl.scrollHeight;
  });

  return (
    <Show when={isCard()}>
      <div class="embark-inspect-regen" ref={rootEl}>
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
          <button
            type="button"
            class="embark-inspect-regen__button"
            on:pointerdown={(event) => event.stopPropagation()}
            on:click={() => void copyContext()}
          >
            Copy context
          </button>
          <Show when={running()}>
            <span class="embark-inspect-regen__status">Generating…</span>
          </Show>
          <Show when={copied()}>
            <span class="embark-inspect-regen__status">Copied.</span>
          </Show>
        </div>

        <Show when={notice()}>
          {(text) => <div class="embark-inspect-regen__notice">{text()}</div>}
        </Show>

        <Show when={blocks().length > 0}>
          <div
            class="embark-inspect-regen__log"
            ref={logEl}
            on:scroll={onLogScroll}
            on:pointerdown={(event) => event.stopPropagation()}
          >
            <Index each={blocks()}>
              {(block) => <LogBlock block={block()} />}
            </Index>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// Everything someone debugging a broken card needs, as one markdown document:
// which inspector build produced it, the card document as it stands, the spec,
// the module the card is currently pointed at, the LLM exchange from this
// session's regeneration run (if any), and a live snapshot of the shared
// context store (merged values, writers, readers per channel).
async function buildDebugContext(
  repo: Repo,
  packageUrl: AutomergeUrl,
  cardHandle: DocHandle<CardDocLike>,
  messages: Message[],
  snapshotFrom: Element,
): Promise<string> {
  const files = createFilesApi(repo, packageUrl);

  const spec = await readOptional(files, "spec.md");
  const modulePath = modulePathOf(cardHandle, packageUrl);
  const source = modulePath ? await readOptional(files, modulePath) : null;
  const transcript =
    messages.length > 0
      ? formatTranscript(messages)
      : "(no regeneration run in this session)";

  return [
    "# Card debug context",
    [
      `- inspector build: ${__BUILD_TIME__}`,
      `- card url: ${cardHandle.url}`,
      `- package url: ${packageUrl}`,
    ].join("\n"),
    `## Card document\n\n\`\`\`json\n${JSON.stringify(cardHandle.doc(), null, 2)}\n\`\`\``,
    `## spec.md\n\n${spec ?? "(missing)"}`,
    `## Current module (${modulePath ?? "src does not point into this package"})\n\n\`\`\`js\n${source ?? "(no readable module source)"}\n\`\`\``,
    `## LLM run log\n\n${transcript}`,
    `## Context store snapshot\n\n${contextSnapshot(snapshotFrom)}`,
  ].join("\n\n");
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
