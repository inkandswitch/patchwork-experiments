// Protocol for a drop target to claim a canvas embed it received via the
// synthetic move bridge — i.e. "I took this, delete the source embed". We can't
// use `DataTransfer.dropEffect` for this: the bridge's DataTransfer is created
// in script (`new DataTransfer()`), and browsers ignore the effect setters on a
// DataTransfer that isn't part of a real drag, so it always reads back "none".
// A plain expando on the event object, however, survives `dispatchEvent` and is
// readable by the canvas afterwards.
//
// Targets that don't call `markEmbedClaimed` (e.g. the parts bin, which keeps a
// copy) leave it unset, so the canvas springs the original back as before.

const CLAIMED = "__embarkEmbedClaimed";

type ClaimableEvent = Event & { [CLAIMED]?: boolean };

// Called by a drop target inside its drop handler to claim the embed.
export function markEmbedClaimed(event: Event): void {
  (event as ClaimableEvent)[CLAIMED] = true;
}

// Read back by the canvas after dispatching the synthetic drop.
export function wasEmbedClaimed(event: Event): boolean {
  return (event as ClaimableEvent)[CLAIMED] === true;
}
