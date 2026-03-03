import type { Repo, AutomergeUrl } from '@automerge/automerge-repo';
import type { ProcessDoc, OutputBlock } from '../process/types';

export async function serializeProcess(
  repo: Repo,
  processUrl: AutomergeUrl,
): Promise<string> {
  const handle = await repo.find<ProcessDoc>(processUrl);
  const doc = handle.doc();
  if (!doc) return '';

  const parts: string[] = [];
  parts.push(`Prompt: ${doc.prompt}`);

  const outputText = serializeOutputBlocks(doc.output ?? []);
  if (outputText) {
    parts.push(`Output:\n${outputText}`);
  }

  return parts.join('\n');
}

function serializeOutputBlocks(blocks: OutputBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.content);
    } else if (block.type === 'script') {
      const desc = block.description ? ` (${block.description})` : '';
      parts.push(`[Script${desc}]`);
      if (block.output) parts.push(`[Output: ${block.output}]`);
      if (block.error) parts.push(`[Error: ${block.error}]`);
    }
  }

  return parts.join('\n');
}

export async function buildHistory(
  repo: Repo,
  processUrls: AutomergeUrl[],
): Promise<string> {
  const sections: string[] = [];

  for (let i = 0; i < processUrls.length; i++) {
    const summary = await serializeProcess(repo, processUrls[i]);
    if (summary) {
      sections.push(`--- Run ${i + 1} ---\n${summary}`);
    }
  }

  return sections.join('\n\n');
}
