# Talk & Draw for Patchwork

Ask Claude about, or to change, anything on screen in Patchwork by talking and drawing
with disappearing ink at the same time. Ported from Livelymerge's Talk & Draw
(`livelymerge/src/assist/`, design in `livelymerge/TALK_AND_DRAW.md`).

- **Install:** add the module URL (`pushwork url`) in Packages. It registers a
  `system-tray` component (so it loads in any frame that mounts tray components) and an
  unlisted `*` title-bar tool, following the `universal-dnd` pattern.
- **Use:** ctrl-space (or cmd-space) starts a session. Talk, draw on the page, then press Esc.
  Click the tray button or the badge for the drawer (API key, model, prompt, notes,
  transcript).
- **Preloading:** the mic permission and Whisper load when the module loads. The tab
  capture (screenshots) is requested on the first click or keypress, because Chrome
  only allows it from a user gesture.

## How it differs from the Livelymerge version

| | Livelymerge | Patchwork |
|---|---|---|
| Pixels | its own canvas | a capture of this tab (`getDisplayMedia`, `src/screen.ts`) |
| Input | events on the one canvas | events on the element under the pointer, through shadow roots, plus emulated default actions (click, focus, caret, `insertText`, scroll) (`src/events.ts`) |
| eval | LM `runtime.printIt` | async page JS with `tad` helpers (`src/tad.ts`) |
| Notes | `aiNotes` in the LM heap | an Automerge doc whose URL is in localStorage (`src/notes.ts`) |

`tad` reads and writes documents (`doc`, `change`) and plugin source in pushwork
folders. It handles both the flat `vfs` shape and the nested `patchwork-folder` shape.
For a `vfs` root, `write` re-pins heads-pinned `dist/` files and bumps `lastSyncAt` so
the ModuleWatcher reloads the module. `window.tad` and `window.talkAndDraw` are available
in the console.
