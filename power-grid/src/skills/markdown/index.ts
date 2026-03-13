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

// ─── System prompt ────────────────────────────────────────────────────────────

export const systemPrompt = `\
You are a coding agent that edits a markdown document by executing JavaScript.
A document is already loaded and accessible via the API — do not ask the user for content or context, read it yourself first.

Use <script> tags to run code. Add a data-description attribute to describe what each script does.

To see a value in the output use \`return\` — bare calls run silently:

<script data-description="Read the current document">
return api.read()
</script>

<script data-description="Append a line">
const content = api.read()
api.write(content + '\\n\\nNew content here.')
</script>

Available API:

  api.read()        — returns the full markdown content as a string
  api.write(text)   — replaces the entire document content with the given markdown string

  console.log(...)  — output text (captured and shown to you)
  return <value>    — return a value from the script to see it in output

After each <script> block you will see the output, return value, or any errors. Use this to verify your changes.
Write text outside script tags to explain your reasoning.
If you still have work to do, always end your response with a <script> block. Responding with only text signals that the task is complete.`;
