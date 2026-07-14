import type { PostIt, SpaceTimeDoc } from '../types';
import { findPostIt, newPostIt } from '../helpers';

export function ensurePostIts(doc: SpaceTimeDoc): PostIt[] {
  if (!doc.postIts) doc.postIts = [];
  return doc.postIts;
}

export function addPostIt(doc: SpaceTimeDoc, x: number, y: number): string {
  const postIt = newPostIt(x, y);
  ensurePostIts(doc).push(postIt);
  return postIt.id;
}

export function updatePostItText(doc: SpaceTimeDoc, postItId: string, text: string): void {
  const postIt = findPostIt(doc, postItId);
  if (!postIt) return;
  postIt.text = text;
}

export function deletePostIt(doc: SpaceTimeDoc, postItId: string): void {
  const postIts = ensurePostIts(doc);
  const index = postIts.findIndex((p) => p.id === postItId);
  if (index >= 0) postIts.splice(index, 1);
}

export function commitPostItPosition(doc: SpaceTimeDoc, postItId: string, x: number, y: number): void {
  const postIt = findPostIt(doc, postItId);
  if (!postIt) return;
  postIt.x = x;
  postIt.y = y;
}

export function commitPostItSize(
  doc: SpaceTimeDoc,
  postItId: string,
  width: number,
  height: number,
): void {
  const postIt = findPostIt(doc, postItId);
  if (!postIt) return;
  postIt.width = width;
  postIt.height = height;
}

export function getPostIt(doc: SpaceTimeDoc, postItId: string) {
  return findPostIt(doc, postItId);
}
