# Chat Tool

A patchwork chat tool with Discord/IRC-style layout, built as a single vanilla JS file (`chat.js`) with no framework dependencies.

## Architecture

- **Pure DOM** — no React/Solid/Svelte, just `document.createElement` and manual rendering
- **Single file** — everything (styles, GIF encoder, emoji data, UI, datatype) lives in `chat.js`
- **Re-renders fully** on every `handle.on("change")` — rebuilds the entire messages DOM each time
- **Ephemeral messaging** for presence/typing via `handle.broadcast()` / `handle.on("ephemeral-message")`
- **No build step** — `package.json` has no build script, `main` points directly to `chat.js`

## Document Schema

```js
{
  title: string,
  messages: [{
    id: string,           // generateId() — random + timestamp
    name: string,         // sender display name
    text: string,
    timestamp: number,
    font?: string,        // from contact.chat.font
    avatarUrl?: string,   // automerge URL to avatar file doc
    replyTo?: string,     // id of message being replied to
    imageUrl?: string,    // automerge URL to pasted image file doc
    imageName?: string,
    voiceUrl?: string,    // automerge URL to recording doc
    voiceDuration?: number,
    gifSelfieUrl?: string, // automerge URL to GIF file doc
    reactions?: { [emoji: string]: string[] }  // emoji -> array of user names
  }],
  docs: DocLink[]  // {url, type, name} — all files (images, voice notes, gifs) referenced by messages
}
```

## Features

### Messages & Layout
- Discord/IRC-style: avatar left, name + timestamp right, message below
- Consecutive messages from same author within 5 min are grouped (continuation rows — no avatar/name repeated)
- Replies always break continuation (show full avatar + name)
- Messages with `font` render in that font family

### Emoji Reactions
- Hover actions bar (top-right) with reply + react buttons
- Full emoji picker overlay with 160+ emojis and search
- Reactions display as badges with count; clicking toggles your reaction
- `+` button on reaction row opens picker to add more

### Presence & Typing
- Broadcasts presence every 10s via ephemeral messages
- Green dot + name in presence bar for active users
- Typing indicator at bottom (above input) when someone is typing
- 30s timeout for presence, 3s timeout for typing indicator

### Image Paste
- Paste images from clipboard into the textarea
- Shows preview bar before sending
- Creates a file doc (`@patchwork.type: "file"`) with image content as Uint8Array
- Stores DocLink in chat's `.docs` array

### Voice Notes
- Mic button to start/stop recording
- Uses `audio/webm;codecs=opus` when supported, falls back to `audio/webm`
- Creates a recording doc (`@patchwork.type: "recording"`) pointing to a separate audio data doc
- Recordings < 0.5s are discarded
- Playback with play/pause button, random waveform visualization, duration display

### Reply System
- Click reply button on any message to set reply context
- Reply bar shows above input with original message preview
- Reply reference renders above the message with original author avatar + name + text snippet
- Clicking reply reference scrolls to and highlights the original message

### GIF Selfie Mode
- Camera toggle button (left of input bar) — shows live camera feed when active
- On send: captures 10 frames over 2 seconds, encodes to GIF89a with LZW compression
- Built-in `SimpleGIFEncoder` class handles quantization + encoding
- GIF replaces avatar for that message (square `border-radius:4px` to distinguish from circular avatars)
- In continuation rows, GIF shows as inline thumbnail aligned with avatar column
- Recording feedback: button dims with spinner, input row shows processing state

### Theme System
- Single `--theme` oklch color drives the entire UI via `color-mix(in oklch, ...)`
- Dark mode: theme mixed 15-40% into black
- Light mode (L > 0.65): theme mixed 5-20% into white
- `contrast-color()` used where supported for text/accent foreground
- Theme picker popover with:
  - 14 preset dots (Indigo, Rose, Emerald, Amber, Cyan, Purple, Slate, Light Pink, Light Blue, Light Green, Lavender, Peach, White, Black)
  - Hue slider (0-360)
  - Luminosity slider (0-100)
  - Chroma slider (0-40)
- Saved to `localStorage("chat-theme-color")`

### Avatars & Cat Ears
- Reads `avatarUrl` from contact doc, renders in circle
- Clicking any avatar toggles CSS cat ears (triangle pseudo-elements)
- Cat ears state is per-session (not persisted)

## User Identity

Resolved from `window.accountDocHandle`:
```js
const ad = accountDocHandle.doc()
const contact = await repo.find(ad.contactUrl)
// contact.doc().name        -> display name
// contact.doc().chat?.font  -> custom font
// contact.doc().avatarUrl   -> avatar file doc URL
```

## Event Handling (tldraw embedding issue)

The tool uses `e.preventDefault()` + `e.stopPropagation()` on critical button clicks (theme, GIF toggle) to prevent parent tool event handlers from interfering when embedded. This was added because clicks weren't working when the chat was embedded inside tldraw. The CLAUDE.md in the parent repo notes: only `stopPropagation()` on `pointerDown`/`pointerUp`, never on `click` — but this tool had to work around tldraw's event handling. The send button and Enter key handler may still have issues when embedded.

## Icons

All UI icons are inline SVGs (defined in `SVG_ICONS` object) — no emoji used for UI chrome. The emoji list itself (`EMOJI_LIST`) is only used as data for the reaction picker.

## Sync

Run `pushwork sync` from this directory to sync to automerge. There is no build step.
