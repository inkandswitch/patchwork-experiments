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
      className="st-modal st-modal--dim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="st-modal__panel st-modal__panel--info"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="st-panel__head">
          <h3 className="st-panel__title">
            {exercise?.name ?? exerciseName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="st-close"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="st-info__body">
          {!exercise ? (
            <p className="st-loading">Loading…</p>
          ) : !hasDetails ? (
            <p className="st-loading st-loading--strong">
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
        className={className ?? "st-info-button"}
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
