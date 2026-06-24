import { useContactName } from "../hooks/use-contact-name";
import type { ShuffleParticipant } from "../types";

export function ContactName({
  identity,
  fallback = "Player",
  className,
}: {
  identity: string | undefined;
  fallback?: string;
  className?: string;
}) {
  const name = useContactName(identity, fallback);
  return <span className={className}>{name}</span>;
}

export function ContactHandLabel({
  ownerId,
  isOwner,
}: {
  ownerId: string;
  isOwner: boolean;
}) {
  const name = useContactName(ownerId, "Player");
  if (isOwner) return <>Your hand</>;
  return <>{name}&apos;s hand</>;
}

export function ShuffleParticipantRow({
  participant,
  active,
  showReady = false,
}: {
  participant: ShuffleParticipant;
  active: boolean;
  showReady?: boolean;
}) {
  const name = useContactName(participant.id, "Player");
  return (
    <>
      {active ? "→ " : ""}
      {name}
      {showReady && participant.readyToStart === true ? " ✓ ready" : ""}
      {participant.keygenReady ? " ✓ keys" : ""}
      {participant.shuffleDone ? " ✓ shuffled" : ""}
    </>
  );
}
