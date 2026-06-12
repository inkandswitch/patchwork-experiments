import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useEffect, useState } from "react";
import type { ExerciseEntry } from "../types";
import { ExerciseDetail } from "./ExerciseDetail";
import { ExerciseImages } from "./ExerciseImages";

function ExerciseInfoModal({
  exerciseUrl,
  exerciseName,
  onClose,
}: {
  exerciseUrl: AutomergeUrl;
  exerciseName: string;
  onClose: () => void;
}) {
  const [exercise] = useDocument<ExerciseEntry>(exerciseUrl, {
    suspense: false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasDetails =
    exercise &&
    ((exercise.imageUrls?.length ?? 0) > 0 ||
      Boolean(exercise.instructions) ||
      (exercise.muscleGroups?.length ?? 0) > 0 ||
      (exercise.equipment?.length ?? 0) > 0);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-[min(540px,100%)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-semibold text-slate-900">
            {exercise?.name ?? exerciseName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!exercise ? (
            <p className="text-center text-sm text-slate-400">Loading…</p>
          ) : !hasDetails ? (
            <p className="text-center text-sm text-slate-500">
              No reference details for this exercise yet. Add instructions or
              images in the Exercise Library.
            </p>
          ) : (
            <>
              {exercise.imageUrls?.length ? (
                <ExerciseImages urls={exercise.imageUrls} />
              ) : null}
              <ExerciseDetail exercise={exercise} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact "info" affordance that opens a read-only refresher (images +
 * instructions) for the exercise at `exerciseUrl`. Renders nothing when there
 * is no linked exercise document.
 */
export function ExerciseInfoButton({
  exerciseUrl,
  exerciseName,
  className,
}: {
  exerciseUrl?: AutomergeUrl;
  exerciseName: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!exerciseUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          className ??
          "flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 text-xs font-semibold text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
        }
        title={`How to: ${exerciseName}`}
        aria-label={`How to perform ${exerciseName}`}
      >
        i
      </button>
      {open ? (
        <ExerciseInfoModal
          exerciseUrl={exerciseUrl}
          exerciseName={exerciseName}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
