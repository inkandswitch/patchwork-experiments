import "./styles.css";
import {
  RepoContext,
  useDocument,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import type { UnconferenceDoc, Session } from "./types";

/** Parse time string like "9:00", "9:30", "14:00" to minutes since midnight. */
function parseTimeMinutes(label: string): number {
  const t = label.trim();
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 0;
  const h = parseInt(match[1], 10);
  const m = match[2] != null ? parseInt(match[2], 10) : 0;
  return h * 60 + m;
}

/** Current local time as minutes since midnight. */
function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const PIXELS_PER_MINUTE = 2;
const NOW_LINE_HEIGHT = 2;

function ScheduleViewToolInner({
  docUrl,
  element: _element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) {
  const [doc] = useDocument<UnconferenceDoc>(docUrl, { suspense: true });
  const [now, setNow] = useState(nowMinutes);

  useEffect(() => {
    const interval = setInterval(() => setNow(nowMinutes), 60_000);
    return () => clearInterval(interval);
  }, []);

  const {
    timeSlots,
    scheduleSlots,
    slotBreakLabels,
    sessionsById,
    dayStart,
    dayEnd,
    totalHeightPx,
    slotLayout,
  } = useMemo(() => {
    const timeSlots = doc?.timeSlots ?? [];
    const rawSlots = doc?.scheduleSlots ?? [];
    const scheduleSlots: string[][] = [];
    for (let i = 0; i < timeSlots.length; i++) {
      scheduleSlots.push(rawSlots[i] ?? []);
    }
    const rawBreak = doc?.slotBreakLabel ?? [];
    const slotBreakLabels = timeSlots.map((_, i) => (rawBreak[i] ?? "").trim());
    const sessions = doc?.sessions ?? [];
    const sessionsById = new Map(sessions.map((s) => [s.id, s]));

    if (timeSlots.length === 0) {
      return {
        timeSlots,
        scheduleSlots,
        slotBreakLabels,
        sessionsById,
        dayStart: 0,
        dayEnd: 0,
        totalHeightPx: 0,
        slotLayout: [] as {
          topPx: number;
          heightPx: number;
          startMin: number;
          endMin: number;
        }[],
      };
    }

    const startMinutes = timeSlots.map(parseTimeMinutes);
    let top = 0;
    const layout = startMinutes.map((startMin, i) => {
      const endMin =
        i + 1 < startMinutes.length ? startMinutes[i + 1] : startMin + 30;
      const heightPx = Math.max((endMin - startMin) * PIXELS_PER_MINUTE, 24);
      const topPx = top;
      top += heightPx;
      return { topPx, heightPx, startMin, endMin };
    });

    const dayStart = startMinutes[0];
    const dayEnd =
      layout.length > 0 ? layout[layout.length - 1].endMin : dayStart + 60;
    const totalHeightPx = top;

    return {
      timeSlots,
      scheduleSlots,
      slotBreakLabels,
      sessionsById,
      dayStart,
      dayEnd,
      totalHeightPx,
      slotLayout: layout,
    };
  }, [doc]);

  const nowY = useMemo(() => {
    if (totalHeightPx <= 0) return -1;
    const minutesFromStart = now - dayStart;
    if (minutesFromStart < 0) return 0;
    const y = minutesFromStart * PIXELS_PER_MINUTE;
    return y > totalHeightPx ? totalHeightPx : y;
  }, [now, dayStart, totalHeightPx]);

  if (!doc) {
    return <div className="unconference unconference--message">Loading…</div>;
  }

  if (timeSlots.length === 0) {
    return (
      <div className="unconference unconference--message">
        No time slots defined. Add times in the main Unconference view.
      </div>
    );
  }

  return (
    <div className="unconference unconference--schedule">
      <h2>Schedule for the day</h2>
      <div className="daygrid" style={{ minHeight: totalHeightPx + 24 }}>
        {/* Red "now" line */}
        {nowY >= 0 && (
          <div
            className="nowline"
            style={{
              top: nowY - NOW_LINE_HEIGHT / 2,
              height: NOW_LINE_HEIGHT,
            }}
          >
            <div className="nowline__time">
              {Math.floor(now / 60)}:{(now % 60).toString().padStart(2, "0")}
            </div>
            <div className="nowline__bar" />
          </div>
        )}

        {/* Time slots */}
        {timeSlots.map((time, slotIndex) => {
          const layout = slotLayout[slotIndex];
          if (!layout) return null;
          const { topPx, heightPx, startMin, endMin } = layout;
          const isBreak = slotBreakLabels[slotIndex] !== "";
          const breakLabel = slotBreakLabels[slotIndex];
          const slotSessionIds = scheduleSlots[slotIndex] ?? [];
          const isCurrentSlot = now >= startMin && now < endMin;

          return (
            <div
              key={slotIndex}
              className="dayslot"
              data-current={isCurrentSlot || undefined}
              style={{
                top: topPx,
                minHeight: heightPx,
                paddingTop: 4,
                paddingBottom: 4,
                paddingLeft: 4,
              }}
            >
              <div
                className="dayslot__time"
                style={{ paddingTop: 2 }}
              >
                {time}
              </div>
              <div className="dayslot__body">
                {isBreak ? (
                  <span className="dayslot__break">
                    {breakLabel || "Break"}
                  </span>
                ) : (
                  <ul className="dayslot__list">
                    {slotSessionIds.map((id) => {
                      const session = sessionsById.get(id);
                      return (
                        <li
                          key={id}
                          className="dayslot__session"
                          title={session?.description}
                        >
                          {session?.title ?? id}
                        </li>
                      );
                    })}
                    {slotSessionIds.length === 0 && (
                      <li className="dayslot__empty">—</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Wraps with RepoContext for use as an external tool. */
export function ScheduleViewTool({
  docUrl,
  element,
}: {
  docUrl: AutomergeUrl;
  element: ToolElement;
}) {
  const repo = element.repo as unknown as React.ComponentProps<
    typeof RepoContext.Provider
  >["value"];
  return (
    <RepoContext.Provider value={repo}>
      <ScheduleViewToolInner docUrl={docUrl} element={element} />
    </RepoContext.Provider>
  );
}

export function renderScheduleViewTool(
  handle: { url: AutomergeUrl },
  element: ToolElement
) {
  const root = createRoot(element);
  root.render(<ScheduleViewTool docUrl={handle.url} element={element} />);
  return () => root.unmount();
}
