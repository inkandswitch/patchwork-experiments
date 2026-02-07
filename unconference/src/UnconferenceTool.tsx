import "./styles.css";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import type { UnconferenceDoc, Session } from "./types";
import { ContactChip } from "./ContactChip";

/** Placeholder when no account doc (avoids passing empty string to useDocument) */
const NO_ACCOUNT_URL = "automerge:0000000000000000000000000" as AutomergeUrl;

/** Current user's contact URL from account doc (if available, e.g. tiny-patchwork with contact) */
function useCurrentContactUrl(): AutomergeUrl | null {
  const accountUrl = (typeof window !== "undefined" &&
    (window as any).accountDocHandle?.url) as AutomergeUrl | undefined;
  const [account] = useDocument<{ contactUrl?: AutomergeUrl }>(
    accountUrl ?? NO_ACCOUNT_URL,
  );
  return account?.contactUrl ?? null;
}

/** Inner component that assumes RepoContext is already provided (e.g. by the wrapper). */
function UnconferenceToolInner({
  docUrl,
  element: _element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) {
  const [doc, changeDoc] = useDocument<UnconferenceDoc>(docUrl, {
    suspense: true,
  });
  const currentContactUrl = useCurrentContactUrl();
  const [proposeTitle, setProposeTitle] = useState("");
  const [proposeDescription, setProposeDescription] = useState("");
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(
    null,
  );
  const [dragOverProposed, setDragOverProposed] = useState(false);
  const [editingTimeSlotIndex, setEditingTimeSlotIndex] = useState<
    number | null
  >(null);
  const [editingTimeDraft, setEditingTimeDraft] = useState("");
  const timeInputRef = useRef<HTMLInputElement>(null);
  const [editingBreakSlotIndex, setEditingBreakSlotIndex] = useState<
    number | null
  >(null);
  const [editingBreakDraft, setEditingBreakDraft] = useState("");
  const breakInputRef = useRef<HTMLInputElement>(null);

  const addSession = useCallback(() => {
    if (!proposeTitle.trim() || !currentContactUrl) return;
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    changeDoc((d) => {
      d.sessions.push({
        id,
        title: proposeTitle.trim(),
        description: proposeDescription.trim(),
        proposerContactUrl: currentContactUrl,
        interestedContactUrls: [],
      });
    });
    setProposeTitle("");
    setProposeDescription("");
  }, [changeDoc, proposeTitle, proposeDescription, currentContactUrl]);

  const toggleInterest = useCallback(
    (sessionId: string) => {
      if (!currentContactUrl) return;
      changeDoc((d) => {
        const session = d.sessions.find((s) => s.id === sessionId);
        if (!session) return;
        const arr = session.interestedContactUrls ?? [];
        const idx = arr.indexOf(currentContactUrl);
        if (idx >= 0) {
          arr.splice(idx, 1);
        } else {
          arr.push(currentContactUrl);
        }
      });
    },
    [changeDoc, currentContactUrl],
  );

  const addSessionToSlot = useCallback(
    (slotIndex: number, sessionId: string) => {
      changeDoc((d) => {
        while (d.scheduleSlots.length <= slotIndex) {
          d.scheduleSlots.push([]);
        }
        if (!d.scheduleSlots[slotIndex]) d.scheduleSlots[slotIndex] = [];
        d.scheduleSlots[slotIndex].push(sessionId);
      });
    },
    [changeDoc],
  );

  const removeSessionFromSlot = useCallback(
    (slotIndex: number, sessionIndexInSlot: number) => {
      changeDoc((d) => {
        const slot = d.scheduleSlots[slotIndex];
        if (slot) slot.splice(sessionIndexInSlot, 1);
      });
    },
    [changeDoc],
  );

  const updateTimeSlot = useCallback(
    (slotIndex: number, label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      changeDoc((d) => {
        if (!d.timeSlots) d.timeSlots = [];
        while (d.timeSlots.length <= slotIndex) {
          d.timeSlots.push("");
        }
        d.timeSlots[slotIndex] = trimmed;
      });
    },
    [changeDoc],
  );

  const startEditingTime = useCallback(
    (slotIndex: number, currentLabel: string) => {
      setEditingTimeSlotIndex(slotIndex);
      setEditingTimeDraft(currentLabel);
    },
    [],
  );

  const commitTimeEdit = useCallback(
    (slotIndex: number) => {
      const trimmed = editingTimeDraft.trim();
      if (trimmed) {
        updateTimeSlot(slotIndex, trimmed);
      }
      setEditingTimeSlotIndex(null);
      setEditingTimeDraft("");
    },
    [editingTimeDraft, updateTimeSlot],
  );

  const cancelTimeEdit = useCallback(() => {
    setEditingTimeSlotIndex(null);
    setEditingTimeDraft("");
  }, []);

  const setSlotAsBreak = useCallback(
    (slotIndex: number, label: string) => {
      const trimmed = label.trim() || "Break";
      changeDoc((d) => {
        while ((d.slotBreakLabel ??= []).length <= slotIndex) {
          d.slotBreakLabel.push("");
        }
        d.slotBreakLabel[slotIndex] = trimmed;
        while (d.scheduleSlots.length <= slotIndex) {
          d.scheduleSlots.push([]);
        }
        d.scheduleSlots[slotIndex] = [];
      });
    },
    [changeDoc],
  );

  const setSlotAsSession = useCallback(
    (slotIndex: number) => {
      changeDoc((d) => {
        while ((d.slotBreakLabel ??= []).length <= slotIndex) {
          d.slotBreakLabel.push("");
        }
        d.slotBreakLabel[slotIndex] = "";
      });
    },
    [changeDoc],
  );

  const updateSlotBreakLabel = useCallback(
    (slotIndex: number, label: string) => {
      const trimmed = label.trim();
      if (trimmed === "") return;
      changeDoc((d) => {
        while ((d.slotBreakLabel ??= []).length <= slotIndex) {
          d.slotBreakLabel.push("");
        }
        d.slotBreakLabel[slotIndex] = trimmed;
      });
    },
    [changeDoc],
  );

  const startEditingBreak = useCallback(
    (slotIndex: number, currentLabel: string) => {
      setEditingBreakSlotIndex(slotIndex);
      setEditingBreakDraft(currentLabel);
    },
    [],
  );

  const commitBreakEdit = useCallback(
    (slotIndex: number) => {
      const trimmed = editingBreakDraft.trim();
      if (trimmed) {
        updateSlotBreakLabel(slotIndex, trimmed);
      }
      setEditingBreakSlotIndex(null);
      setEditingBreakDraft("");
    },
    [editingBreakDraft, updateSlotBreakLabel],
  );

  const cancelBreakEdit = useCallback(() => {
    setEditingBreakSlotIndex(null);
    setEditingBreakDraft("");
  }, []);

  useEffect(() => {
    if (editingTimeSlotIndex === null) return;
    const id = setTimeout(() => {
      timeInputRef.current?.focus();
      timeInputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [editingTimeSlotIndex]);

  useEffect(() => {
    if (editingBreakSlotIndex === null) return;
    const id = setTimeout(() => {
      breakInputRef.current?.focus();
      breakInputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [editingBreakSlotIndex]);

  const handleSlotDragOver = useCallback(
    (slotIndex: number, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "copy";
      setDragOverSlotIndex(slotIndex);
    },
    [],
  );

  const clearDragState = useCallback(() => {
    setDragOverSlotIndex(null);
    setDragOverProposed(false);
  }, []);

  const handleSlotDrop = useCallback(
    (targetSlotIndex: number, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearDragState();
      const sessionId = e.dataTransfer.getData("sessionId");
      if (!sessionId) return;
      const sourceSlot = e.dataTransfer.getData("sourceSlotIndex");
      const sourceIdx = e.dataTransfer.getData("sourceSessionIndexInSlot");
      if (sourceSlot !== "" && sourceIdx !== "") {
        removeSessionFromSlot(
          parseInt(sourceSlot, 10),
          parseInt(sourceIdx, 10),
        );
      }
      addSessionToSlot(targetSlotIndex, sessionId);
    },
    [addSessionToSlot, removeSessionFromSlot],
  );

  const handleProposedDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDragOverProposed(true);
  }, []);

  const handleProposedDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearDragState();
      const sourceSlot = e.dataTransfer.getData("sourceSlotIndex");
      const sourceIdx = e.dataTransfer.getData("sourceSessionIndexInSlot");
      if (sourceSlot !== "" && sourceIdx !== "") {
        removeSessionFromSlot(
          parseInt(sourceSlot, 10),
          parseInt(sourceIdx, 10),
        );
      }
    },
    [removeSessionFromSlot, clearDragState],
  );

  if (!doc) {
    return <div className="unconference p-4 text-base-content">Loading…</div>;
  }

  const timeSlots = doc.timeSlots ?? [];
  const sessions = doc.sessions ?? [];
  const rawSlots = doc.scheduleSlots ?? [];
  const scheduleSlots: string[][] = [...rawSlots];
  while (scheduleSlots.length < timeSlots.length) {
    scheduleSlots.push([]);
  }
  const scheduledSessionIds = new Set(scheduleSlots.flat());
  const proposedSessions = sessions.filter(
    (s) => !scheduledSessionIds.has(s.id),
  );
  const rawSlotBreakLabel = doc.slotBreakLabel ?? [];
  const legacySlotIsSingle = (
    doc as UnconferenceDoc & { slotIsSingle?: boolean[] }
  ).slotIsSingle;
  const slotBreakLabels = timeSlots.map((_, i) => {
    if (i < rawSlotBreakLabel.length)
      return (rawSlotBreakLabel[i] ?? "").trim();
    return legacySlotIsSingle?.[i] ? "Break" : "";
  });
  const isBreakSlot = (i: number) => slotBreakLabels[i] !== "";

  return (
    <div className="unconference h-full min-h-0 overflow-y-auto p-4 flex flex-col gap-6 text-base-content max-w-4xl mx-auto">
      <section>
        <h2 className="text-lg font-semibold mb-2">Proposed sessions</h2>
        <ul
          className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 list-none p-0 m-0 max-w-3xl min-h-[7rem] rounded-lg transition-colors ${
            dragOverProposed ? "bg-primary/10 ring-1 ring-primary/30" : ""
          }`}
          onDragOver={handleProposedDragOver}
          onDragLeave={(e) => {
            const ul = e.currentTarget;
            if (!ul.contains(e.relatedTarget as Node)) {
              setDragOverProposed(false);
            }
          }}
          onDrop={handleProposedDrop}
        >
          {proposedSessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              currentContactUrl={currentContactUrl}
              onToggleInterest={() => toggleInterest(session.id)}
              onDragEnd={clearDragState}
            />
          ))}
          {currentContactUrl && (
            <NewSessionPostit
              proposeTitle={proposeTitle}
              setProposeTitle={setProposeTitle}
              proposeDescription={proposeDescription}
              setProposeDescription={setProposeDescription}
              onAdd={addSession}
              canAdd={!!proposeTitle.trim()}
            />
          )}
        </ul>
        {!currentContactUrl && (
          <p className="text-base-content/70 text-sm mt-2">
            Sign in with a contact to propose sessions.
          </p>
        )}
      </section>

      {/* Schedule for the day */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Schedule for the day</h2>
        <p className="text-sm text-base-content/70 mb-3">
          Drag session post-its from above into a time slot. Anyone can edit the
          schedule.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th className="w-20">Time</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {timeSlots.map((time, slotIndex) => {
                const slotSessionIds = scheduleSlots[slotIndex] ?? [];
                const isBreak = isBreakSlot(slotIndex);
                const breakLabel = slotBreakLabels[slotIndex];
                return (
                  <tr key={slotIndex}>
                    <td className="font-mono text-sm align-top pt-2 w-20">
                      <div className="flex flex-col gap-0.5">
                        {editingTimeSlotIndex === slotIndex ? (
                          <input
                            ref={timeInputRef}
                            type="text"
                            className="input input-sm input-bordered w-full font-mono"
                            value={editingTimeDraft}
                            onChange={(e) =>
                              setEditingTimeDraft(e.target.value)
                            }
                            onBlur={() => commitTimeEdit(slotIndex)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitTimeEdit(slotIndex);
                              }
                              if (e.key === "Escape") {
                                e.preventDefault();
                                cancelTimeEdit();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <button
                            type="button"
                            className="text-left hover:bg-base-200 rounded px-1 -mx-1 py-1 min-h-[2rem] cursor-pointer w-full border-0 bg-transparent"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditingTime(slotIndex, time);
                            }}
                            title="Click to edit time"
                          >
                            {time}
                          </button>
                        )}
                        {!isBreak && (
                          <button
                            type="button"
                            className="text-xs opacity-70 hover:opacity-100 text-left px-1 -mx-1 py-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSlotAsBreak(slotIndex, "Break");
                            }}
                            title="Mark as break (e.g. lunch, coffee)"
                          >
                            Break
                          </button>
                        )}
                      </div>
                    </td>
                    <td
                      className={`align-top ${
                        !isBreak && dragOverSlotIndex === slotIndex
                          ? "bg-primary/10 ring-1 ring-primary/30 transition-colors"
                          : isBreak
                            ? "text-base-content/80"
                            : "transition-colors"
                      }`}
                      {...(isBreak
                        ? {}
                        : {
                            onDragOver: (e: React.DragEvent) =>
                              handleSlotDragOver(slotIndex, e),
                            onDragLeave: (e: React.DragEvent) => {
                              const td = e.currentTarget;
                              if (!td.contains(e.relatedTarget as Node)) {
                                setDragOverSlotIndex(null);
                              }
                            },
                            onDrop: (e: React.DragEvent) =>
                              handleSlotDrop(slotIndex, e),
                          })}
                    >
                      {isBreak ? (
                        <div className="flex flex-col gap-1">
                          {editingBreakSlotIndex === slotIndex ? (
                            <input
                              ref={breakInputRef}
                              type="text"
                              className="input input-sm input-bordered w-full max-w-xs"
                              value={editingBreakDraft}
                              onChange={(e) =>
                                setEditingBreakDraft(e.target.value)
                              }
                              onBlur={() => commitBreakEdit(slotIndex)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  commitBreakEdit(slotIndex);
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelBreakEdit();
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder="e.g. Lunch, Coffee"
                            />
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="text-left hover:bg-base-200 rounded px-1 -mx-1 py-0.5 cursor-pointer border-0 bg-transparent font-medium"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditingBreak(slotIndex, breakLabel);
                                }}
                                title="Click to edit break label"
                              >
                                {breakLabel}
                              </button>
                              <button
                                type="button"
                                className="text-xs opacity-70 hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSlotAsSession(slotIndex);
                                }}
                                title="Allow sessions in this slot"
                              >
                                Allow sessions
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-w-3xl min-h-[7rem]">
                          {slotSessionIds.map((sessionId, sessionIndex) => {
                            const session = sessions.find(
                              (s) => s.id === sessionId,
                            );
                            if (!session) return null;
                            return (
                              <ScheduledSessionPostit
                                key={`${sessionId}-${sessionIndex}`}
                                session={session}
                                slotIndex={slotIndex}
                                sessionIndexInSlot={sessionIndex}
                                onRemove={() =>
                                  removeSessionFromSlot(slotIndex, sessionIndex)
                                }
                                onDragEnd={clearDragState}
                                onSlotDragOver={handleSlotDragOver}
                                onSlotDrop={handleSlotDrop}
                              />
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** Wraps inner tool with RepoContext so useDocument works when loaded as an external tool (separate React root). */
export function UnconferenceTool({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) {
  // Host provides element.repo; type may differ across bundle boundaries (e.g. automerge-repo 2.5.0 vs 2.5.1)
  const repo = window.repo as any;
  return (
    <RepoContext.Provider value={repo}>
      <UnconferenceToolInner docUrl={docUrl} element={element} />
    </RepoContext.Provider>
  );
}

const POSTIT_SIZE = "w-full aspect-square min-h-0";

function ScheduledSessionPostit({
  session,
  slotIndex,
  sessionIndexInSlot,
  onRemove,
  onDragEnd,
  onSlotDragOver,
  onSlotDrop,
}: {
  session: Session;
  slotIndex: number;
  sessionIndexInSlot: number;
  onRemove: () => void;
  onDragEnd?: () => void;
  onSlotDragOver: (slotIndex: number, e: React.DragEvent) => void;
  onSlotDrop: (slotIndex: number, e: React.DragEvent) => void;
}) {
  const interestedUrls = session.interestedContactUrls ?? [];
  const mouseDownOnButton = useRef(false);
  const hash = session.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const tilt = (hash % 7) - 3;
  const tints = [
    "",
    "postit-tint-pink",
    "postit-tint-blue",
    "postit-tint-green",
  ];
  const tint = tints[hash % tints.length];
  return (
    <div
      className={`postit ${tint} ${POSTIT_SIZE} p-3 flex flex-col relative cursor-grab active:cursor-grabbing`}
      style={{ transform: `rotate(${tilt * 0.4}deg)` }}
      draggable
      onMouseDown={(e) => {
        mouseDownOnButton.current = !!(
          e.target instanceof HTMLElement && e.target.closest("button")
        );
      }}
      onDragStart={(e) => {
        if (mouseDownOnButton.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("sessionId", session.id);
        e.dataTransfer.setData("text/plain", session.title);
        e.dataTransfer.setData("sourceSlotIndex", String(slotIndex));
        e.dataTransfer.setData(
          "sourceSessionIndexInSlot",
          String(sessionIndexInSlot),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onSlotDragOver(slotIndex, e)}
      onDrop={(e) => {
        onSlotDrop(slotIndex, e);
        onDragEnd?.();
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-xs absolute top-1 right-1 shrink-0 z-10"
        onClick={onRemove}
        aria-label="Remove from slot"
      >
        ✕
      </button>
      <div className="font-medium text-base-content/90 text-sm line-clamp-2 break-words pr-6">
        {session.title}
      </div>
      <div className="text-xs text-base-content/60 mt-0.5 flex items-center gap-1 flex-wrap shrink-0">
        {session.proposerContactUrl ? (
          <ContactChip contactUrl={session.proposerContactUrl} />
        ) : (
          "Anonymous"
        )}
      </div>
      {session.description ? (
        <p className="text-xs text-base-content/80 mt-1 line-clamp-3 flex-1 min-h-0 overflow-hidden break-words">
          {session.description}
        </p>
      ) : (
        <div className="flex-1 min-h-0" />
      )}
      {interestedUrls.length > 0 && (
        <div className="text-xs text-base-content/60 mt-1 shrink-0">
          {interestedUrls.length} interested
        </div>
      )}
    </div>
  );
}

function NewSessionPostit({
  proposeTitle,
  setProposeTitle,
  proposeDescription,
  setProposeDescription,
  onAdd,
  canAdd,
}: {
  proposeTitle: string;
  setProposeTitle: (v: string) => void;
  proposeDescription: string;
  setProposeDescription: (v: string) => void;
  onAdd: () => void;
  canAdd: boolean;
}) {
  return (
    <li className={`postit ${POSTIT_SIZE} p-3 flex flex-col gap-2`}>
      <input
        type="text"
        className="bg-transparent border-none outline-none font-medium text-base-content/90 placeholder-base-content/40 w-full text-sm"
        placeholder="Session title…"
        value={proposeTitle}
        onChange={(e) => setProposeTitle(e.target.value)}
      />
      <textarea
        className="bg-transparent border-none outline-none text-sm text-base-content/80 placeholder-base-content/40 resize-none flex-1 min-h-0 w-full"
        placeholder="Description…"
        value={proposeDescription}
        onChange={(e) => setProposeDescription(e.target.value)}
        rows={3}
      />
      <button
        type="button"
        className="btn btn-sm btn-primary mt-auto self-start"
        onClick={onAdd}
        disabled={!canAdd}
      >
        Add
      </button>
    </li>
  );
}

function SessionCard({
  session,
  currentContactUrl,
  onToggleInterest,
  onDragEnd,
}: {
  session: Session;
  currentContactUrl: AutomergeUrl | null;
  onToggleInterest: () => void;
  onDragEnd?: () => void;
}) {
  const interestedUrls = session.interestedContactUrls ?? [];
  const isInterested =
    !!currentContactUrl && interestedUrls.includes(currentContactUrl);
  const mouseDownOnButton = useRef(false);

  const hash = session.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const tilt = (hash % 7) - 3;
  const tints = [
    "",
    "postit-tint-pink",
    "postit-tint-blue",
    "postit-tint-green",
  ];
  const tint = tints[hash % tints.length];
  return (
    <li
      className={`postit ${tint} ${POSTIT_SIZE} p-3 flex flex-col cursor-grab active:cursor-grabbing`}
      style={{ transform: `rotate(${tilt * 0.4}deg)` }}
      draggable
      onMouseDown={(e) => {
        mouseDownOnButton.current = !!(
          e.target instanceof HTMLElement && e.target.closest("button")
        );
      }}
      onDragStart={(e) => {
        if (mouseDownOnButton.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("sessionId", session.id);
        e.dataTransfer.setData("text/plain", session.title);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={onDragEnd}
    >
      <div className="font-medium text-base-content/90 text-sm line-clamp-2 break-words">
        {session.title}
      </div>
      <div className="text-xs text-base-content/60 mt-0.5 flex items-center gap-1 flex-wrap shrink-0">
        {session.proposerContactUrl ? (
          <ContactChip contactUrl={session.proposerContactUrl} />
        ) : (
          "Anonymous"
        )}
      </div>
      {session.description ? (
        <p className="text-xs text-base-content/80 mt-1 line-clamp-3 flex-1 min-h-0 overflow-hidden break-words">
          {session.description}
        </p>
      ) : (
        <div className="flex-1 min-h-0" />
      )}
      {interestedUrls.length > 0 && (
        <div className="text-xs text-base-content/60 mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 shrink-0">
          <span>{interestedUrls.length} interested</span>
        </div>
      )}
      <button
        type="button"
        className={`btn btn-sm mt-auto self-start ${isInterested ? "btn-primary" : "btn-outline"}`}
        onClick={onToggleInterest}
        disabled={!currentContactUrl}
        title={
          currentContactUrl
            ? "Toggle your interest"
            : "Sign in with a contact to indicate interest"
        }
      >
        {isInterested ? "✓" : "Interest"}
      </button>
    </li>
  );
}
