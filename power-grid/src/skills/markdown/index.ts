import type { DocHandle } from '@automerge/automerge-repo';
import { updateText } from '@automerge/automerge-repo';

type MarkdownDoc = {
  content: string;
};

function toSwPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', '/automerge%3A');
}

export const skillUrl =
  `${toSwPath(__ROOT_DIR_URL__)}/dist/skills/markdown/index.js`;

// ─── API factory ──────────────────────────────────────────────────────────────

export default function createApi(handle: DocHandle<MarkdownDoc>) {
  return {
    /** Return the full markdown content of the document. */
    read(): string {
      return handle.doc()?.content ?? '';
    },

    /** Replace the entire document content with the given markdown string. */
    write(text: string): void {
      handle.change((d) => {
        updateText(d, ['content'], text);
      });
    },
  };
}

// ─── System prompt description ────────────────────────────────────────────────

export const apiDescription = `\
  api.read()            — returns the full markdown content as a string
  api.write(text)       — replaces the entire document content with the given markdown string

  console.log(...)      — output text (captured and shown to you)
  return value          — return a value from the script (shown to you as output)`;
