import type { Repo } from '@automerge/automerge-repo';

export type EmbedMeta = {
  id: string;
  docUrl: string;
  docType: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export async function resolveEmbedMetadata(
  repo: Repo,
  shapes: Record<string, any>,
): Promise<EmbedMeta[]> {
  const embeds = Object.values(shapes).filter((s) => s?.type === 'embed' && s?.docUrl);
  return Promise.all(
    embeds.map(async (s) => {
      let docType = s.docType ?? 'unknown';
      let title = 'Untitled';
      try {
        const handle = await repo.find<any>(s.docUrl);
        const doc = await handle.doc();
        if (doc) {
          docType = doc['@patchwork']?.type ?? docType;
          title = extractTitle(doc);
        }
      } catch {
        // leave defaults
      }
      return {
        id: s.id,
        docUrl: s.docUrl,
        docType,
        title,
        x: Math.round(s.x),
        y: Math.round(s.y),
        width: Math.round(s.width ?? 0),
        height: Math.round(s.height ?? 0),
      };
    }),
  );
}

export function buildCanvasContextText(
  paperDocUrl: string,
  shapes: object,
  embeds: EmbedMeta[],
): string {
  const embedsSection =
    embeds.length === 0
      ? '(none)'
      : embeds
          .map(
            (e) =>
              `- id: ${e.id} | type: ${e.docType} | title: "${e.title}" | position: (${e.x}, ${e.y}) | size: ${e.width}×${e.height} | docUrl: ${e.docUrl}`,
          )
          .join('\n');

  return `You are working on a spatial canvas called Paper (doc URL: ${paperDocUrl}).

Use the \`paper\` skill to read and modify it:
\`\`\`javascript
const { getPaper } = await importSkillApi('paper');
const paper = await getPaper(repo, '${paperDocUrl}');
\`\`\`

Rules for this canvas:
- Always use \`paper.getShapes()\` to understand what is already on the canvas before making changes.
- When you create new documents in response to the user's request, always place them on the canvas using \`paper.placeEmbed(newDocUrl, docType)\` so they appear in the user's view.
- Prefer adding and arranging content visually over returning plain text answers.
- Use smart placement (no explicit x/y) so new shapes never overlap existing ones.

Embeds currently on canvas:
${embedsSection}

Current canvas state — all shapes:
\`\`\`json
${JSON.stringify(shapes, null, 2)}
\`\`\``;
}

function extractTitle(doc: Record<string, any>): string {
  if (typeof doc.title === 'string' && doc.title.trim()) return doc.title.trim();
  if (typeof doc.content === 'string') {
    const match = doc.content.match(/^#\s+(.+)/m);
    if (match) return match[1].trim();
  }
  return 'Untitled';
}
