# Unconference — tiny-patchwork tool

Schedule a single-day team unconference. Anyone with the document link can:

- **Propose sessions** (title, optional description, your name)
- **Indicate interest** in proposed sessions
- **Build the schedule** by assigning sessions to time slots

No sign-in: your name is stored in the browser (and used when proposing / marking interest).

## Usage

1. **Load the tool in your patchwork (e.g. gaios)**  
   Add this module’s URL to your module list (e.g. in your layout doc’s module settings). After building and syncing with pushwork you’ll have an `automerge:` URL for this package; add that to the `modules` array of your module-settings document.

2. **Create an unconference document**  
   In the sidebar, use “Create new” → **Unconference**. (You must have the unconference module loaded so the datatype appears.)

3. **Share the link**  
   Share the document URL (e.g. `https://your-gaios/#doc=...`) with the team. Anyone opening it can propose sessions, mark interest, and edit the schedule.

## Build

```bash
pnpm --filter @tiny-patchwork/unconference build
```

For pushwork sync (to get a shareable module URL):

```bash
pnpm --filter @tiny-patchwork/unconference sync
```

## Data model

- **sessions**: List of proposals (`id`, `title`, `description`, `proposerName`, `interested[]`).
- **timeSlots**: Labels for the day (e.g. `9:00`, `9:30`, …).
- **scheduleSlotSessionIds**: For each slot index, the session id scheduled there (or `""` if empty).

All edits are collaborative (Automerge); the doc syncs with everyone who has the link (via your sync backend).
