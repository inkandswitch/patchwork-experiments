# Schedule

A card that reads your notes, highlights every clock time and duration, and
quietly does the time math — showing as a
[sticker](automerge:2fygfMPPm6BdmtgRXbpQvVBbizRL) when each step finishes.

Within a paragraph it keeps a running clock:

- a time like `8:00` sets the clock
- a duration like `1 hour` or `30 min` advances it, and the new time appears
  after the duration — consecutive durations chain
- an embedded doc with a `duration` (e.g. a route card) counts as a duration too
- mentioning another time resets the clock to it
- a blank line starts a fresh schedule

So this:

- start at 8:00
- clean kitchen for 1 hour
- at the church by 10:00
- meditate 30 minutes

reads as `8:00` → `1 hour` `9:00`, then `10:00` resets the clock →
`30 minutes` `10:30`.

If a computed time lands after the next target still ahead in the paragraph,
its time turns **red** — you're running late:

- start at 8:00
- clean kitchen for 1 hour `9:00`
- clean kitchen for 2 hours `11:00` ← red, it overruns the 10:00 below
- be at the church by 10:00

Times, durations, and 24-hour clocks (`8:00`, `14:30`) are supported.
