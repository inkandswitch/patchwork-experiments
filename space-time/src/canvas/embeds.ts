import type { Embed, SpaceTimeDoc } from '../types';
import { newId } from '../helpers';

export const DEFAULT_EMBED_WIDTH = 420;
export const DEFAULT_EMBED_HEIGHT = 320;
export const MIN_EMBED_WIDTH = 160;
export const MIN_EMBED_HEIGHT = 120;

export function newEmbed(docUrl: string, x: number, y: number, toolId?: string): Embed {
  return {
    id: newId(),
    docUrl,
    ...(toolId ? { toolId } : {}),
    x,
    y,
    width: DEFAULT_EMBED_WIDTH,
    height: DEFAULT_EMBED_HEIGHT,
  };
}

export function findEmbed(doc: SpaceTimeDoc, embedId: string): Embed | undefined {
  return doc.embeds?.find((embed) => embed.id === embedId);
}

export function addEmbed(doc: SpaceTimeDoc, docUrl: string, x: number, y: number, toolId?: string): string {
  if (!doc.embeds) doc.embeds = [];
  const embed = newEmbed(docUrl, x, y, toolId);
  doc.embeds.push(embed);
  return embed.id;
}

export function commitEmbedMove(doc: SpaceTimeDoc, embedId: string, x: number, y: number): void {
  const embed = findEmbed(doc, embedId);
  if (!embed) return;
  embed.x = x;
  embed.y = y;
}

export function commitEmbedResize(
  doc: SpaceTimeDoc,
  embedId: string,
  width: number,
  height: number,
): void {
  const embed = findEmbed(doc, embedId);
  if (!embed) return;
  embed.width = Math.max(MIN_EMBED_WIDTH, width);
  embed.height = Math.max(MIN_EMBED_HEIGHT, height);
}

export function deleteEmbed(doc: SpaceTimeDoc, embedId: string): void {
  if (!doc.embeds) return;
  const index = doc.embeds.findIndex((embed) => embed.id === embedId);
  if (index >= 0) doc.embeds.splice(index, 1);
}
