import type { InlineImage, SpaceTimeDoc } from '../types';
import { newId } from '../helpers';

export function ensureInlineImages(doc: SpaceTimeDoc): InlineImage[] {
  if (!doc.images) doc.images = [];
  return doc.images;
}

export function findInlineImage(doc: SpaceTimeDoc, imageId: string): InlineImage | undefined {
  return (doc.images ?? []).find((img) => img.id === imageId);
}

export function addInlineImage(
  doc: SpaceTimeDoc,
  sourceId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const image: InlineImage = { id: newId(), sourceId, x, y, width, height };
  ensureInlineImages(doc).push(image);
  return image.id;
}

export function deleteInlineImage(doc: SpaceTimeDoc, imageId: string): void {
  const images = ensureInlineImages(doc);
  const index = images.findIndex((img) => img.id === imageId);
  if (index >= 0) images.splice(index, 1);
}

export function commitInlineImagePosition(
  doc: SpaceTimeDoc,
  imageId: string,
  x: number,
  y: number,
): void {
  const image = findInlineImage(doc, imageId);
  if (!image) return;
  image.x = x;
  image.y = y;
}

export function commitInlineImageSize(
  doc: SpaceTimeDoc,
  imageId: string,
  width: number,
  height: number,
): void {
  const image = findInlineImage(doc, imageId);
  if (!image) return;
  image.width = width;
  image.height = height;
}
