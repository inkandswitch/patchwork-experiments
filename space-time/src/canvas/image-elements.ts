import type { SpaceTimeDoc } from '../types';
import { resolveSourceUrl } from '../helpers';

/**
 * Loads full-resolution `HTMLImageElement`s for inline images so they stay
 * crisp when scaled up on the canvas (the filmstrip thumbnails are only ~96px
 * tall, too soft for moodboard-sized display). Keyed by source id and cached by
 * resolved URL; `notify` fires as images finish loading so the canvas repaints.
 */
export type ImageElementStore = {
  ensure: (doc: SpaceTimeDoc) => void;
  /** Synchronous lookup map for drawing (image may still be decoding). */
  imageMap: Map<string, HTMLImageElement>;
  dispose: () => void;
};

export function createImageElementStore(notify: () => void): ImageElementStore {
  const urls = new Map<string, string>();
  const imageMap = new Map<string, HTMLImageElement>();
  let disposed = false;

  const ensure = (doc: SpaceTimeDoc) => {
    if (disposed) return;
    const seen = new Set<string>();
    for (const inline of doc.images ?? []) {
      const sourceId = inline.sourceId;
      const source = doc.sources[sourceId];
      if (!source || source.type !== 'image') continue;
      seen.add(sourceId);
      const url = resolveSourceUrl(source.url);
      if (urls.get(sourceId) === url) continue;

      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      urls.set(sourceId, url);
      imageMap.set(sourceId, image);
      image.addEventListener(
        'load',
        () => {
          if (disposed || urls.get(sourceId) !== url) return;
          notify();
        },
        { once: true },
      );
      image.src = url;
    }

    for (const sourceId of [...urls.keys()]) {
      if (!seen.has(sourceId)) {
        urls.delete(sourceId);
        imageMap.delete(sourceId);
      }
    }
  };

  const dispose = () => {
    disposed = true;
    urls.clear();
    imageMap.clear();
  };

  return { ensure, imageMap, dispose };
}
