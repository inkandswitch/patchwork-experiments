import { useDocuments } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useEffect, useMemo, useState } from "react";
import type { StrengthFileDoc } from "../types";

/**
 * Thumbnail grid for an exercise's reference images (each a `file` doc holding
 * raw bytes). Clicking a thumbnail opens a full-screen lightbox so the athlete
 * can study the movement.
 */
export function ExerciseImages({
  urls,
  className,
}: {
  urls: AutomergeUrl[];
  className?: string;
}) {
  const [docs] = useDocuments<StrengthFileDoc>(urls, { suspense: false });
  const [zoomed, setZoomed] = useState<number | null>(null);

  const objectUrls = useMemo(() => {
    const created: string[] = [];
    for (const url of urls) {
      const doc = docs.get(url);
      if (doc?.content instanceof Uint8Array) {
        created.push(
          URL.createObjectURL(
            new Blob([doc.content as BlobPart], { type: doc.mimeType }),
          ),
        );
      }
    }
    return created;
  }, [urls, docs]);

  useEffect(() => {
    return () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }, [objectUrls]);

  useEffect(() => {
    if (zoomed === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (objectUrls.length === 0) return null;

  return (
    <>
      <div className={`st-images ${className ?? ""}`}>
        {objectUrls.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setZoomed(i)}
            className="st-images__thumb"
            title="Click to enlarge"
          >
            <img
              src={src}
              alt=""
              className="st-images__img"
            />
          </button>
        ))}
      </div>

      {zoomed !== null ? (
        <div
          className="st-lightbox"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={objectUrls[zoomed]}
            alt=""
            className="st-lightbox__img"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            className="st-lightbox__close"
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}
