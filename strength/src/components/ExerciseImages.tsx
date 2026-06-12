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
      <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
        {objectUrls.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setZoomed(i)}
            className="overflow-hidden rounded-md border border-slate-200 transition hover:border-emerald-400 hover:shadow-sm"
            title="Click to enlarge"
          >
            <img
              src={src}
              alt=""
              className="h-32 w-32 object-cover"
            />
          </button>
        ))}
      </div>

      {zoomed !== null ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomed(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={objectUrls[zoomed]}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setZoomed(null)}
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-white"
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}
