import { AutomergeUrl } from "@automerge/automerge-repo/slim";

export type Session = {
  id: string;
  title: string;
  description: string;
  /** Contact doc URL of the proposer */
  proposerContactUrl: AutomergeUrl;
  /** Contact doc URLs of people who indicated interest */
  interestedContactUrls: AutomergeUrl[];
};

export type UnconferenceDoc = {
  title: string;
  /** Proposed sessions (open for proposals and interest) */
  sessions: Session[];
  /** Time labels for the day, e.g. ["9:00", "9:30", "10:00"] */
  timeSlots: string[];
  /** For each time slot index, if non-empty this slot is a break with this label (e.g. "Lunch", "Coffee"); empty = session slot */
  slotBreakLabel?: string[];
  /** For each time slot index, the session ids scheduled there (multiple per slot) */
  scheduleSlots: string[][];
};
