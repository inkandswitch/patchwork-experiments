/**
 * Chat Tool - Enhanced Patchwork Chat
 *
 * Features:
 * - Emoji reactions (any emoji via picker)
 * - Presence & typing indicators
 * - Image paste, voice notes, replies
 * - User fonts, colors, avatars from contact doc
 * - Cat ears on avatar click
 * - GIF selfie mode (inline camera toggle left of input)
 * - IRC/Discord-style layout
 * - Themeable via single oklch base color + CSS variables
 */

import {parseAutomergeUrl} from "@automerge/automerge-repo"

// ============================================================================
// Helpers
// ============================================================================

function generateId() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

const BUILD_TIME = new Date().toLocaleString()
console.log("[Chat] loaded build:", BUILD_TIME)

function formatTime(ts) {
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
	})
}

function formatDuration(s) {
	const m = Math.floor(s / 60)
	return (
		m +
		":" +
		Math.floor(s % 60)
			.toString()
			.padStart(2, "0")
	)
}

function escapeHtml(str) {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
}

const URL_RE = /https?:\/\/[^\s<>]+/g

function formatText(text, emoticonBlobUrls) {
	// Split by code spans first to avoid formatting inside them
	const parts = text.split(/(`[^`]+`)/g)
	let out = ""
	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			// Code span
			out += "<code>" + escapeHtml(parts[i].slice(1, -1)) + "</code>"
			continue
		}
		let s = escapeHtml(parts[i])
		// Extract :emoticon: tokens before underscore formatting can mangle them
		const emoticonSlots = []
		s = s.replace(/:([a-zA-Z0-9_+-]+):/g, (match, name) => {
			const placeholder = "\x00EMO" + emoticonSlots.length + "\x00"
			// Custom emoticon first
			if (emoticonBlobUrls) {
				const blobUrl = emoticonBlobUrls[name]
				if (blobUrl) {
					emoticonSlots.push(
						'<img class="chat-emoticon-inline" src="' +
							blobUrl +
							'" alt=":' +
							escapeHtml(name) +
							':" title=":' +
							escapeHtml(name) +
							':">'
					)
					return placeholder
				}
			}
			// Shortcode alias (e.g. :+1: :tada: :heart:)
			const aliasLower = name.toLowerCase()
			if (EMOJI_ALIASES[aliasLower]) {
				emoticonSlots.push(
					'<span title=":' +
						escapeHtml(name) +
						':">' +
						EMOJI_ALIASES[aliasLower] +
						"</span>"
				)
				return placeholder
			}
			// Unicode emoji by full name
			const lower = aliasLower.replace(/[-_]/g, " ")
			const found = EMOJI_DATA.find(e => e.name.toLowerCase() === lower)
			if (found) {
				emoticonSlots.push(
					'<span title=":' + escapeHtml(name) + ':">' + found.emoji + "</span>"
				)
				return placeholder
			}
			return match
		})
		// Order matters: specific delimiters first
		// ._text_. → subscript
		s = s.replace(/\._([^_]+?)_\./g, "<sub>$1</sub>")
		// .^text^. → superscript
		s = s.replace(/\.\^([^^]+?)\^\./g, "<sup>$1</sup>")
		// ___text___ → underline + italic
		s = s.replace(/___([^_]+?)___/g, "<u><em>$1</em></u>")
		// __text__ → underline
		s = s.replace(/__([^_]+?)__/g, "<u>$1</u>")
		// _text_ → italic
		s = s.replace(/(?<![_\w])_([^_]+?)_(?![_.\w])/g, "<em>$1</em>")
		// *text* → bold
		s = s.replace(/\*([^*]+?)\*/g, "<strong>$1</strong>")
		// ||text|| → spoiler
		s = s.replace(/\|\|([^|]+?)\|\|/g, '<span class="chat-spoiler">$1</span>')
		// <>text<> → marquee
		s = s.replace(/&lt;&gt;(.+?)&lt;&gt;/g, "<marquee>$1</marquee>")
		// %%text%% → inverted
		s = s.replace(/%%([^%]+?)%%/g, '<span class="chat-inverted">$1</span>')
		// ~~text~~ → strikethrough
		s = s.replace(/~~([^~]+?)~~/g, "<s>$1</s>")
		// Restore emoticon placeholders
		for (let j = 0; j < emoticonSlots.length; j++) {
			s = s.replace("\x00EMO" + j + "\x00", emoticonSlots[j])
		}
		// URLs → clickable links
		s = s.replace(
			URL_RE,
			url =>
				'<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>"
		)
		out += s
	}
	return out
}

function isEmojiOnly(text) {
	// Strip :custom: emoticon tokens and unicode emoji, see if anything non-whitespace remains
	const stripped = text
		.replace(/:[a-zA-Z0-9_+\-]+:/g, "")
		.replace(
			/[\p{Emoji_Presentation}\p{Extended_Pictographic}\u200d\ufe0f\ufe0e\u20e3\u{1f3fb}-\u{1f3ff}\u{e0061}-\u{e007a}\u{e007f}]/gu,
			""
		)
		.trim()
	return stripped.length === 0 && text.trim().length > 0
}

// ============================================================================
// Styles with CSS custom properties derived from a single theme color
// ============================================================================

function createStyles() {
	const style = document.createElement("style")
	style.textContent = /* css */ `
    /* ================================================================
       THEME SYSTEM
       Everything derives from --theme, a single oklch color.
       --theme-fg uses contrast-color (with fallback).
       ================================================================ */
    .chat-root {
      /* All theme variables are set dynamically by setTheme() in JS.
         These are just fallback defaults. */
      --theme: oklch(0.55 0.18 270);
      --bg-darkest:  oklch(0.12 0.02 270);
      --bg-dark:     oklch(0.15 0.03 270);
      --bg-mid:      oklch(0.19 0.03 270);
      --bg-hover:    oklch(0.22 0.04 270);
      --bg-input:    oklch(0.17 0.03 270);
      --border:      oklch(0.28 0.05 270);
      --accent:      oklch(0.55 0.18 270);
      --accent-hover: oklch(0.45 0.15 270);
      --accent-soft: oklch(0.55 0.18 270 / 0.15);
      --accent-fg:   oklch(1 0 0);
      --text-primary:   oklch(1 0 0);
      --text-secondary: oklch(1 0 0 / 0.6);
      --text-muted:     oklch(1 0 0 / 0.4);
      --link:           oklch(0.75 0.15 250);
    }

    /* ---- Reset ---- */
    .chat-root {
      display:flex; flex-direction:row;
      position:absolute; inset:0;
      font-family:system-ui,-apple-system,sans-serif;
      background:var(--bg-dark); color:var(--text-primary);
      box-sizing:border-box; font-size:15px;
      overflow:hidden; user-select:text; -webkit-user-select:text;
    }
    .chat-root *, .chat-root *::before, .chat-root *::after { box-sizing:border-box; }
    .chat-root a { color:var(--link); text-decoration:underline; }
    .chat-root a:hover { text-decoration:none; }

    /* Theme button */
    .chat-theme-btn {
      background:none; border:none; color:var(--text-muted); cursor:pointer;
      font-size:16px; padding:2px 6px; border-radius:4px; position:relative;
    }
    .chat-theme-btn:hover, .chat-notify-btn:hover { background:var(--bg-hover); color:var(--text-primary); }
    .chat-notify-btn {
      background:none; border:none; color:var(--text-muted); cursor:pointer;
      padding:2px 4px; border-radius:4px; display:flex; align-items:center;
      position:relative;
    }
    .chat-notify-menu {
      display:none; position:absolute; top:100%; right:0; margin-top:4px;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:8px;
      padding:8px; min-width:180px; z-index:100;
    }
    .chat-notify-menu.show { display:block; }
    .chat-notify-menu-row {
      display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding:6px 4px; font-size:13px; color:var(--text-secondary); cursor:pointer;
      border-radius:4px;
    }
    .chat-notify-menu-row:hover { background:var(--bg-hover); }
    .chat-notify-toggle {
      width:32px; height:18px; border-radius:9px; border:none; cursor:pointer;
      background:var(--bg-hover); position:relative; transition:background 0.15s;
      flex-shrink:0;
    }
    .chat-notify-toggle.on { background:var(--accent); }
    .chat-notify-toggle::after {
      content:""; position:absolute; top:2px; left:2px; width:14px; height:14px;
      border-radius:50%; background:white; transition:transform 0.15s;
    }
    .chat-notify-toggle.on::after { transform:translateX(14px); }

    /* Theme picker popover */
    .chat-theme-popover {
      display:none; position:absolute; top:100%; right:0; margin-top:4px;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:8px;
      padding:12px; z-index:50; min-width:200px;
      box-shadow:0 4px 20px rgba(0,0,0,0.4);
    }
    .chat-theme-popover.show { display:block; }
    .chat-theme-popover label { font-size:13px; color:var(--text-secondary); display:block; margin-bottom:6px; }
    .chat-theme-presets { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px; }
    .chat-theme-preset {
      width:28px; height:28px; border-radius:50%; border:2px solid transparent; cursor:pointer;
      transition: border-color 0.15s;
    }
    .chat-theme-preset:hover, .chat-theme-preset.active { border-color:var(--text-primary); }
    .chat-theme-hue-row { display:flex; align-items:center; gap:8px; }
    .chat-theme-hue-row input[type=range] { flex:1; accent-color:var(--accent); }
    .chat-theme-hue-row input[type=number] { width:50px; background:var(--bg-input); border:1px solid var(--border); color:var(--text-primary); border-radius:4px; padding:2px 4px; font-size:13px; }

    /* ---- Presence bar ---- */
    .chat-presence-bar {
      padding:4px 16px; background:var(--bg-darkest);
      border-bottom:1px solid var(--border);
      display:flex; gap:8px; align-items:center; flex-shrink:0; min-height:24px;
    }
    .chat-presence-user { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text-secondary); transition:opacity 0.2s; }
    .chat-presence-user.away { opacity:0.9; }
    .chat-presence-avatar {
      width:18px; height:18px; border-radius:50%; overflow:hidden; flex-shrink:0;
      background:var(--bg-hover); display:flex; align-items:center; justify-content:center;
      font-size:10px; color:var(--text-muted);
    }
    .chat-presence-avatar img { width:100%; height:100%; object-fit:cover; }

    /* ---- Messages ---- */
    .chat-messages { flex:1; overflow-y:auto; padding:8px 0; display:flex; flex-direction:column; min-height:0; }

    .chat-msg-group { padding:2px 16px; display:flex; gap:12px; position:relative; }
    .chat-msg-group:hover { background:var(--bg-hover); }

    /* Avatar */
    .chat-avatar-col { width:40px; flex-shrink:0; padding-top:2px; }
    .chat-avatar {
      width:40px; height:40px; border-radius:50%; background:var(--accent);
      display:flex; align-items:center; justify-content:center;
      font-size:18px; font-weight:700; color:var(--accent-fg);
      overflow:hidden; cursor:pointer; position:relative; user-select:none;
    }
    .chat-avatar img { width:100%; height:100%; object-fit:cover; }
    .chat-avatar.gif-selfie { border-radius:4px; }
    .chat-avatar.gif-selfie img { border-radius:4px; }
    .chat-avatar.cat-ears::before {
      content:""; position:absolute; top:-6px; left:2px;
      border-left:8px solid transparent; border-right:8px solid transparent;
      border-bottom:12px solid var(--accent); z-index:2;
    }
    .chat-avatar.cat-ears::after {
      content:""; position:absolute; top:-6px; right:2px;
      border-left:8px solid transparent; border-right:8px solid transparent;
      border-bottom:12px solid var(--accent); z-index:2;
    }

    /* Message body */
    .chat-msg-body { flex:1; min-width:0; }
    .chat-msg-header { display:flex; align-items:baseline; gap:8px; }
    .chat-msg-name { font-weight:600; font-size:15px; color:var(--text-primary); cursor:pointer; }
    .chat-msg-name:hover { text-decoration:underline; }
    .chat-msg-time { font-size:11px; color:var(--text-muted); }
    .chat-msg-text { color:var(--text-primary); line-height:1.45; margin-top:2px; white-space:pre-wrap; word-wrap:break-word; }
    .chat-msg-text.emoji-only { font-size:2em; line-height:1.2; }
    .chat-msg-text.emoji-only .chat-emoticon-inline { height:2em; }
    .chat-msg-text code {
      background:var(--bg-hover); padding:1px 4px; border-radius:3px;
      font-family:ui-monospace,monospace; font-size:0.9em;
    }
    .chat-msg-text a { color:var(--link); text-decoration:underline; }
    .chat-msg-text a:hover { text-decoration:none; }
    .chat-msg-text.streaming::after {
      content:""; display:inline-block; width:6px; height:1em; background:var(--accent);
      margin-left:2px; vertical-align:text-bottom; border-radius:1px;
      animation: blink-cursor 0.8s step-end infinite;
    }
    @keyframes blink-cursor { 0%,100%{opacity:1;} 50%{opacity:0;} }
    .chat-streaming-cancel {
      margin-top:4px; padding:2px 10px; border-radius:4px; border:1px solid var(--border);
      background:var(--bg-hover); color:var(--text-muted); cursor:pointer; font-size:11px;
    }
    .chat-streaming-cancel:hover { color:var(--text-primary); background:var(--bg-mid); }
    .chat-spoiler {
      background:var(--text-primary); color:transparent; border-radius:3px;
      padding:0 3px; cursor:pointer; transition:all 0.2s;
    }
    .chat-spoiler.revealed { background:var(--bg-hover); color:var(--text-primary); }
    .chat-inverted {
      background:var(--text-primary); color:var(--bg-dark); padding:0 3px; border-radius:3px;
    }
    .chat-msg-action {
      padding:4px 16px; font-style:italic; color:var(--text-secondary); font-size:14px;
      position:relative;
    }
    .chat-msg-action:hover { background:var(--bg-hover); }
    .chat-msg-action .chat-msg-action-name { font-weight:600; color:var(--text-primary); }
    .chat-time-gap { margin-top:16px; }

    /* Input */
    .chat-input-wrap { position:relative; flex:1; min-width:0; }
    .chat-input-wrap .cm-editor { background:transparent; }
    .chat-input-wrap .cm-editor .cm-content { max-height:120px; }
    .chat-input-wrap .cm-editor .cm-scroller { max-height:120px; }

    /* Continuation messages */
    .chat-msg-continuation { padding:0 16px 0 68px; position:relative; }
    .chat-msg-continuation.has-gif { padding-left:16px; display:flex; gap:12px; align-items:flex-start; }
    .chat-msg-continuation:hover { background:var(--bg-hover); }
    .chat-msg-inline-time {
      font-size:10px; color:var(--text-muted);
      position:absolute; top:100%; right:0; white-space:nowrap;
      margin-top:2px; pointer-events:none;
    }

    /* GIF selfie shown inline in continuation */
    .chat-msg-gif-inline {
      width:40px; height:40px; border-radius:4px; object-fit:cover;
      border:none; display:block; margin-right:6px; flex-shrink:0;
    }

    /* Reply ref */
    .chat-msg-reply-ref {
      display:flex; align-items:center; gap:6px; font-size:13px; color:var(--text-muted);
      margin-bottom:2px; padding-left:36px; cursor:pointer; position:relative;
    }
    .chat-msg-reply-ref::before {
      content:""; position:absolute; left:20px; top:50%; width:12px; height:12px;
      border-left:2px solid var(--border); border-top:2px solid var(--border);
      border-radius:6px 0 0 0; transform:translateY(-20%);
    }
    .chat-msg-reply-ref:hover { color:var(--text-primary); }
    .chat-msg-reply-ref-avatar { width:16px; height:16px; border-radius:50%; overflow:hidden; flex-shrink:0; }
    .chat-msg-reply-ref-avatar img { width:100%; height:100%; object-fit:cover; }
    .chat-msg-reply-ref-name { font-weight:600; color:var(--text-primary); }
    .chat-msg-reply-ref-text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }

    /* Images */
    .chat-msg-image-wrap {
      position:relative; display:inline-block; margin-top:4px; max-width:100%;
    }
    .chat-msg-image {
      display:block; border-radius:8px; cursor:pointer; width:100%; height:100%; object-fit:cover;
    }

    /* Patchwork doc embed */
    .chat-msg-embed {
      margin-top:6px; border:1px solid var(--border); border-radius:8px;
      width:100%; height:300px; position:relative;
      background:var(--bg-surface); display:flex; flex-direction:column;
    }
    .chat-msg-embed patchwork-view { width:100%; flex:1; min-height:0; display:block; overflow:hidden; }
    .chat-msg-embed-title {
      padding:0 8px 0 0; font-weight:500; color:var(--text-primary);
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex-shrink:1; min-width:0;
    }
    .chat-embed-infobar {
      display:flex; align-items:center; gap:4px; padding:3px 6px;
      background:var(--bg-darkest); border-top:1px solid var(--border);
      font-size:11px; overflow:hidden; flex-wrap:wrap;
    }
    .chat-embed-pill {
      display:inline-flex; align-items:center; gap:3px;
      background:var(--bg-hover); border:1px solid var(--border); border-radius:10px;
      padding:1px 8px; font-size:10px; color:var(--text-secondary);
      white-space:nowrap; cursor:default; max-width:200px;
      overflow:hidden; text-overflow:ellipsis; flex-shrink:0;
    }
    .chat-embed-pill.clickable { cursor:pointer; }
    .chat-embed-pill.clickable:hover { color:var(--text-primary); border-color:var(--accent); background:var(--bg-input); }
    .chat-embed-pill-label { opacity:0.6; font-size:9px; text-transform:uppercase; letter-spacing:0.3px; }
    .chat-embed-tool-input {
      background:var(--bg-darkest); border:1px solid var(--accent); border-radius:10px;
      color:var(--text-primary); font-size:10px; padding:1px 8px; outline:none;
      width:120px;
    }
    .chat-embed-tool-menu {
      position:absolute; top:100%; left:0; z-index:20;
      background:var(--bg-surface); border:1px solid var(--border); border-radius:6px;
      padding:2px; box-shadow:0 2px 8px rgba(0,0,0,0.3); white-space:nowrap;
      min-width:140px; max-height:200px; overflow-y:auto;
    }
    .chat-embed-tool-menu button {
      display:block; width:100%; text-align:left; background:none; border:none;
      color:var(--text-secondary); font-size:11px; padding:4px 8px; cursor:pointer;
      border-radius:4px;
    }
    .chat-embed-tool-menu button:hover { background:var(--bg-hover); color:var(--text-primary); }
    .chat-embed-tool-menu button.active { color:var(--accent); font-weight:600; }
    .chat-embed-tool-menu .tool-menu-input-row {
      display:flex; gap:4px; padding:4px; border-top:1px solid var(--border); margin-top:2px;
    }
    .chat-embed-tool-menu .tool-menu-input-row input {
      flex:1; background:var(--bg-darkest); border:1px solid var(--border); border-radius:4px;
      color:var(--text-primary); font-size:10px; padding:2px 6px; outline:none; min-width:0;
    }
    .chat-embed-tool-menu .tool-menu-input-row input:focus { border-color:var(--accent); }
    .chat-embed-url-menu {
      position:absolute; top:100%; left:0; z-index:20;
      background:var(--bg-surface); border:1px solid var(--border); border-radius:6px;
      padding:2px; box-shadow:0 2px 8px rgba(0,0,0,0.3); white-space:nowrap;
    }
    .chat-embed-url-menu button {
      display:block; width:100%; text-align:left; background:none; border:none;
      color:var(--text-secondary); font-size:11px; padding:4px 10px; cursor:pointer;
      border-radius:4px;
    }
    .chat-embed-url-menu button:hover { background:var(--bg-hover); color:var(--text-primary); }

    /* Resize handle */
    .chat-resize-handle {
      position:absolute; bottom:0; right:0; width:16px; height:16px; cursor:nwse-resize;
      display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.15s;
      z-index:5;
    }
    .chat-msg-image-wrap:hover .chat-resize-handle,
    .chat-msg-embed:hover .chat-resize-handle { opacity:0.6; }
    .chat-resize-handle:hover { opacity:1 !important; }
    .chat-resize-handle svg { width:10px; height:10px; color:var(--text-muted); }

    /* Voice note */
    .chat-voice-note {
      display:flex; align-items:center; gap:8px; margin-top:4px; padding:8px 12px;
      background:var(--bg-darkest); border-radius:8px; max-width:300px;
    }
    .chat-voice-play-btn {
      width:32px; height:32px; border-radius:50%; background:var(--accent); color:var(--accent-fg);
      border:none; font-size:14px; cursor:pointer; display:flex; align-items:center;
      justify-content:center; flex-shrink:0;
    }
    .chat-voice-play-btn:hover { background:var(--accent-hover); }
    .chat-voice-waveform { flex:1; height:24px; display:flex; align-items:center; gap:2px; }
    .chat-voice-bar { width:3px; background:var(--accent); border-radius:2px; min-height:3px; }
    .chat-voice-duration { font-size:12px; color:var(--text-muted); flex-shrink:0; }

    /* Reactions */
    .chat-reactions { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
    .chat-reaction {
      display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:8px;
      border:1px solid var(--border); background:var(--bg-dark); font-size:15px;
      cursor:pointer; user-select:none; transition:all 0.1s;
    }
    .chat-reaction:hover { border-color:var(--accent); background:var(--bg-hover); }
    .chat-reaction.mine { border-color:var(--accent); background:var(--accent-soft); }
    .chat-reaction-count { font-size:12px; color:var(--text-secondary); font-weight:500; }
    .chat-reaction-add {
      display:inline-flex; align-items:center; justify-content:center;
      width:28px; height:28px; border-radius:8px; border:1px dashed var(--border);
      background:transparent; font-size:16px; cursor:pointer; color:var(--text-muted); transition:all 0.1s;
    }
    .chat-reaction-add:hover { border-color:var(--accent); color:var(--text-primary); background:var(--bg-hover); }

    /* Emoticon/reaction tooltip */
    .chat-emoticon-tooltip {
      position:absolute; z-index:200; pointer-events:none;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:8px;
      padding:8px 12px; box-shadow:0 4px 16px rgba(0,0,0,0.3);
      display:none; flex-direction:column; align-items:center; gap:4px; max-width:200px;
    }
    .chat-emoticon-tooltip.show { display:flex; pointer-events:auto; }
    .chat-emoticon-tooltip-preview { font-size:48px; line-height:1; }
    .chat-emoticon-tooltip-preview img { width:48px; height:48px; object-fit:contain; }
    .chat-emoticon-tooltip-name { font-size:12px; color:var(--text-muted); }
    .chat-emoticon-tooltip-names { font-size:11px; color:var(--text-secondary); text-align:center; }
    .chat-emoticon-tooltip-adopt {
      background:var(--accent); color:var(--accent-fg); border:none; cursor:pointer;
      font-size:11px; padding:2px 10px; border-radius:4px; font-weight:600;
    }
    .chat-emoticon-tooltip-adopt:hover { opacity:0.85; }

    /* Message hover actions */
    .chat-msg-actions {
      position:absolute; top:-14px; right:16px; display:none;
      background:var(--bg-darkest); border:1px solid var(--border);
      border-radius:4px; z-index:10;
    }
    .chat-msg-group:hover .chat-msg-actions,
    .chat-msg-continuation:hover .chat-msg-actions,
    .chat-msg-action:hover .chat-msg-actions { display:flex; }
    .chat-msg-action-btn {
      background:none; border:none; color:var(--text-secondary);
      padding:6px 8px; cursor:pointer; font-size:16px;
    }
    .chat-msg-action-btn:hover { background:var(--bg-hover); color:var(--text-primary); }

    /* Emoji picker overlay */
    .chat-emoji-picker-overlay {
      position:fixed; top:0; left:0; right:0; bottom:0; z-index:100; display:none;
    }
    .chat-emoji-picker-overlay.show { display:block; }
    .chat-emoji-picker {
      position:absolute; background:var(--bg-darkest); border:1px solid var(--border);
      border-radius:8px; padding:8px; box-shadow:0 4px 20px rgba(0,0,0,0.3);
      z-index:101; max-width:280px; width:280px; display:flex; flex-direction:column;
      max-height:320px;
    }
    .chat-emoji-picker-scroll {
      overflow-y:auto; overscroll-behavior:contain; min-height:0; flex:1;
    }
    .chat-emoji-grid {
      display:flex; flex-wrap:wrap; gap:2px;
    }
    .chat-emoji-grid button {
      background:none; border:none; font-size:22px; cursor:pointer; padding:4px;
      border-radius:4px; width:36px; height:36px; display:flex; align-items:center; justify-content:center;
    }
    .chat-emoji-grid button:hover { background:var(--bg-hover); }
    .chat-emoji-active { background:var(--accent) !important; outline:2px solid var(--accent); outline-offset:-2px; opacity:0.8; }
    .chat-emoji-picker-search {
      width:100%; padding:6px 10px; background:var(--bg-input); border:1px solid var(--border);
      border-radius:4px; color:var(--text-primary); font-size:14px; margin-bottom:6px; outline:none;
      flex-shrink:0;
    }
    .chat-emoji-picker-search:focus { border-color:var(--accent); }

    /* Emoticon section in emoji picker */
    .chat-emoticon-section { border-bottom:1px solid var(--border); padding-bottom:6px; margin-bottom:6px; }
    .chat-emoticon-section-header {
      display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;
      font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;
    }
    .chat-emoticon-add-btn {
      background:none; border:1px dashed var(--border); color:var(--text-muted); cursor:pointer;
      font-size:11px; padding:2px 8px; border-radius:4px;
    }
    .chat-emoticon-add-btn:hover { border-color:var(--accent); color:var(--text-primary); }
    .chat-emoticon-grid { display:flex; flex-wrap:wrap; gap:2px; }
    .chat-emoticon-grid button {
      background:none; border:none; cursor:pointer; padding:2px; border-radius:4px;
      width:36px; height:36px; display:flex; align-items:center; justify-content:center;
      position:relative;
    }
    .chat-emoticon-grid button:hover { background:var(--bg-hover); }
    .chat-emoticon-grid button img { width:28px; height:28px; object-fit:contain; }
    .chat-emoticon-adopt {
      position:absolute; top:-2px; right:-2px; width:14px; height:14px; border-radius:50%;
      background:var(--accent); color:var(--accent-fg); border:none; cursor:pointer;
      font-size:10px; display:none; align-items:center; justify-content:center; line-height:1;
    }
    .chat-emoticon-grid button:hover .chat-emoticon-adopt { display:flex; }
    .chat-emoticon-remove {
      position:absolute; top:-4px; right:-4px; width:16px; height:16px; border-radius:50%;
      background:var(--bg-hover); color:var(--text-muted); border:1px solid var(--border); cursor:pointer;
      font-size:10px; display:none; align-items:center; justify-content:center; line-height:1;
    }
    .chat-emoticon-grid button:hover .chat-emoticon-remove { display:flex; }
    .chat-emoticon-remove:hover { background:#ed4245 !important; color:#fff !important; border-color:#ed4245 !important; }
    .chat-emoticon-remove.confirm { background:#ed4245; color:#fff; border-color:#ed4245; display:flex; }

    /* Inline emoticon in message text */
    .chat-emoticon-inline { height:1.5em; vertical-align:middle; display:inline; }

    /* Emoticon add dialog */
    .chat-emoticon-dialog {
      padding:8px; display:flex; flex-direction:column; gap:8px;
    }
    .chat-emoticon-dialog input[type=text] {
      width:100%; padding:6px 10px; background:var(--bg-input); border:1px solid var(--border);
      border-radius:4px; color:var(--text-primary); font-size:14px; outline:none;
    }
    .chat-emoticon-dialog input[type=text]:focus { border-color:var(--accent); }
    .chat-emoticon-dialog-preview {
      width:80px; height:80px; border-radius:4px; background:var(--bg-hover);
      display:flex; align-items:center; justify-content:center; overflow:hidden; align-self:center;
      color:var(--text-muted); font-size:24px;
    }
    .chat-emoticon-dialog-preview:hover { background:var(--bg-input); border:1px dashed var(--border); }
    .chat-emoticon-dialog-preview img { width:100%; height:100%; object-fit:contain; }
    .chat-emoticon-dialog-counter {
      font-size:11px; color:var(--text-muted); text-align:center;
    }
    .chat-emoticon-dialog-btns { display:flex; gap:6px; justify-content:flex-end; }
    .chat-emoticon-dialog-btns button {
      padding:4px 12px; border-radius:4px; font-size:13px; cursor:pointer; border:none;
    }
    .chat-emoticon-dialog .cancel-btn { background:var(--bg-hover); color:var(--text-primary); }
    .chat-emoticon-dialog .save-btn { background:var(--accent); color:var(--accent-fg); font-weight:600; }
    .chat-emoticon-dialog .save-btn:disabled { opacity:0.5; cursor:default; }

    /* Font add dialog (reuses emoticon dialog overlay) */
    .chat-font-dialog {
      padding:8px; display:flex; flex-direction:column; gap:8px;
    }
    .chat-font-dialog input[type=text] {
      width:100%; padding:6px 10px; background:var(--bg-input); border:1px solid var(--border);
      border-radius:4px; color:var(--text-primary); font-size:14px; outline:none;
    }
    .chat-font-dialog input[type=text]:focus { border-color:var(--accent); }
    .chat-font-dialog-preview {
      padding:10px; border-radius:4px; background:var(--bg-hover);
      text-align:center; font-size:18px; color:var(--text-primary);
      min-height:48px; display:flex; align-items:center; justify-content:center;
    }
    .chat-font-dialog-filebtn {
      background:none; border:1px dashed var(--border); color:var(--text-muted); cursor:pointer;
      font-size:13px; padding:6px 12px; border-radius:4px; text-align:center;
    }
    .chat-font-dialog-filebtn:hover { border-color:var(--accent); color:var(--text-primary); }
    .chat-font-dialog-btns { display:flex; gap:6px; justify-content:flex-end; }
    .chat-font-dialog-btns button {
      padding:4px 12px; border-radius:4px; font-size:13px; cursor:pointer; border:none;
    }
    .chat-font-dialog .cancel-btn { background:var(--bg-hover); color:var(--text-primary); }
    .chat-font-dialog .save-btn { background:var(--accent); color:var(--accent-fg); font-weight:600; }
    .chat-font-dialog .save-btn:disabled { opacity:0.5; cursor:default; }

    /* Font list in font dialog */
    .chat-font-list { display:flex; flex-direction:column; gap:2px; max-height:120px; overflow-y:auto; overscroll-behavior:contain; }
    .chat-font-list-item {
      display:flex; align-items:center; justify-content:space-between; padding:4px 8px;
      border-radius:4px; font-size:13px; color:var(--text-primary);
    }
    .chat-font-list-item:hover { background:var(--bg-hover); }
    .chat-font-list-item .font-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chat-font-list-remove {
      width:18px; height:18px; border-radius:50%; background:var(--bg-hover); color:var(--text-muted);
      border:1px solid var(--border); cursor:pointer; font-size:10px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
    }
    .chat-font-list-remove:hover { background:#ed4245; color:#fff; border-color:#ed4245; }
    .chat-font-list-remove.confirm { background:#ed4245; color:#fff; border-color:#ed4245; }

    /* Message context menu (... button) */
    .chat-msg-menu-wrap { position:relative; }
    .chat-msg-menu {
      display:none; position:absolute; top:100%; right:0; margin-top:2px;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:6px;
      padding:4px 0; min-width:120px; z-index:20;
      box-shadow:0 4px 12px rgba(0,0,0,0.3);
    }
    .chat-msg-menu.show { display:block; }
    .chat-msg-menu-item {
      display:flex; align-items:center; gap:8px; width:100%; padding:6px 12px;
      background:none; border:none; color:var(--text-primary); font-size:13px;
      cursor:pointer; text-align:left;
    }
    .chat-msg-menu-item:hover { background:var(--bg-hover); }
    .chat-msg-menu-item.danger { color:#ed4245; }
    .chat-msg-menu-item.danger:hover { background:rgba(237,66,69,0.1); }

    /* ---- Bottom area ---- */
    .chat-typing-bar {
      padding:0 16px; min-height:22px; font-size:12px;
      color:var(--text-muted); font-style:italic; flex-shrink:0;
    }
    .chat-input-wrapper { flex-shrink:0; padding:0 16px 16px; position:relative; }

    /* Emoji/emoticon autocomplete popup */
    .chat-autocomplete {
      display:none; position:absolute; bottom:100%; left:0; right:0;
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:8px;
      max-height:200px; overflow-y:auto; overscroll-behavior:contain;
      box-shadow:0 -4px 16px rgba(0,0,0,0.3); z-index:50; margin-bottom:4px;
    }
    .chat-autocomplete.show { display:block; }
    .chat-autocomplete-item {
      display:flex; align-items:center; gap:8px; padding:6px 12px; cursor:pointer;
      font-size:14px; color:var(--text-primary);
    }
    .chat-autocomplete-item:hover, .chat-autocomplete-item.active {
      background:var(--bg-hover);
    }
    .chat-autocomplete-item-emoji { font-size:20px; width:28px; text-align:center; flex-shrink:0; }
    .chat-autocomplete-item-emoji img { width:24px; height:24px; object-fit:contain; }
    .chat-autocomplete-item-name { color:var(--text-secondary); font-size:12px; }
    .chat-autocomplete-item-desc { color:var(--text-muted); font-size:11px; margin-left:auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:50%; }
    .chat-autocomplete-item-cmd { font-weight:600; font-size:14px; color:var(--text-primary); min-width:0; }

    .chat-reply-bar {
      display:none; padding:8px 12px; background:var(--bg-mid);
      border-radius:8px 8px 0 0; border-left:3px solid var(--accent);
      align-items:center; gap:8px; font-size:13px; color:var(--text-secondary);
    }
    .chat-reply-bar.show { display:flex; }
    .chat-reply-bar-text { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .chat-reply-bar-close { background:none; border:none; font-size:16px; cursor:pointer; color:var(--text-secondary); }
    .chat-reply-bar-close:hover { color:var(--text-primary); }

    .chat-paste-preview {
      display:none; padding:8px 12px; background:var(--bg-mid); align-items:center; gap:8px;
      flex-wrap:wrap;
    }
    .chat-paste-preview.show { display:flex; }
    .chat-paste-preview img { max-height:50px; border-radius:4px; }
    .chat-paste-preview video { max-height:50px; border-radius:4px; }
    .chat-paste-preview-close { background:none; border:none; font-size:16px; cursor:pointer; color:var(--text-secondary); margin-left:auto; }
    .chat-paste-file {
      display:flex; align-items:center; gap:6px; background:var(--bg-hover);
      border-radius:6px; padding:4px 8px; font-size:12px; color:var(--text-secondary);
      max-width:200px;
    }
    .chat-paste-file-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chat-paste-file-remove {
      background:none; border:none; cursor:pointer; color:var(--text-secondary);
      padding:0; display:flex; align-items:center;
    }
    .chat-paste-file-remove:hover { color:var(--text-primary); }
    .chat-paste-embed {
      display:flex; align-items:center; gap:6px; background:var(--bg-hover);
      border-radius:6px; padding:4px 8px; font-size:12px; color:var(--text-secondary);
      max-width:200px;
    }
    .chat-paste-embed-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chat-paste-embed-remove {
      background:none; border:none; cursor:pointer; color:var(--text-secondary);
      padding:0; display:flex; align-items:center;
    }
    .chat-paste-embed-remove:hover { color:var(--text-primary); }
    .chat-sidebar-pinned-wrap { position:relative; }
    .chat-sidebar-pinned-wrap[data-drop-position="above"]::before {
      content:""; position:absolute; top:-2px; left:4px; right:4px;
      height:2px; background:var(--accent); border-radius:1px; z-index:10;
    }
    .chat-sidebar-pinned-wrap[data-drop-position="below"]::after {
      content:""; position:absolute; bottom:-2px; left:4px; right:4px;
      height:2px; background:var(--accent); border-radius:1px; z-index:10;
    }
    .chat-sidebar-pinned-wrap.dragging { opacity:0.4; }
    .chat-drop-overlay {
      display:none; position:absolute; inset:0; z-index:100;
      background:color-mix(in oklch, var(--theme) 20%, black 60%);
      align-items:center; justify-content:center;
      font-size:18px; color:var(--text-primary); font-weight:600;
      border:3px dashed var(--accent); border-radius:12px; pointer-events:none;
    }
    .chat-drop-overlay.show { display:flex; }
    .chat-msg-video-wrap { max-width:350px; border-radius:8px; overflow:hidden; margin-top:4px; position:relative; }
    .chat-msg-video { width:100%; display:block; border-radius:8px; cursor:pointer; }

    /* Lightbox */
    .chat-lightbox {
      display:none; position:absolute; inset:0; z-index:200;
      background:rgba(0,0,0,0.85); align-items:center; justify-content:center;
      cursor:zoom-out;
    }
    .chat-lightbox.show { display:flex; }
    .chat-lightbox img, .chat-lightbox video {
      max-width:95%; max-height:95%; object-fit:contain; border-radius:4px;
      cursor:default;
    }
    .chat-lightbox video { background:#000; }
    .chat-msg-file {
      display:inline-flex; align-items:center; gap:6px; background:var(--bg-hover);
      border-radius:6px; padding:6px 10px; margin-top:4px; font-size:13px;
      color:var(--text-secondary); cursor:pointer; text-decoration:none;
    }
    .chat-msg-file:hover { background:var(--bg-input); color:var(--text-primary); }
    .chat-msg-file-icon { flex-shrink:0; }

    .chat-input-row {
      display:flex; gap:0; background:var(--bg-input); border-radius:8px;
      padding:4px; align-items:flex-end;
    }
    .chat-input {
      width:100%; padding:8px 12px; border:none; font-size:15px; outline:none;
      background:transparent; color:var(--text-primary);
      font-family:inherit; resize:none; max-height:120px; min-height:24px; line-height:1.4;
      position:relative; z-index:1;
    }
    .chat-input::placeholder { color:var(--text-muted); }

    .chat-input-btn {
      width:36px; height:36px; background:none; border:none; color:var(--text-muted);
      cursor:pointer; font-size:20px; border-radius:4px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
    }
    .chat-input-btn:hover { color:var(--text-primary); }
    .chat-input-btn.recording { color:#ed4245; animation:pulse 1s infinite; }
    @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }

    /* Voice recording bar (replaces input row while recording) */
    .chat-recording-bar {
      display:flex; align-items:center; gap:10px; background:var(--bg-input); border-radius:8px;
      padding:8px 12px; animation:fadeIn 0.15s ease;
    }
    @keyframes fadeIn { from{opacity:0;transform:scale(0.98)} to{opacity:1;transform:scale(1)} }
    .chat-recording-dot {
      width:10px; height:10px; border-radius:50%; background:#ed4245; flex-shrink:0;
      animation:recPulse 1s ease-in-out infinite;
    }
    @keyframes recPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
    .chat-recording-time { font-size:14px; color:var(--text-primary); font-variant-numeric:tabular-nums; min-width:40px; }
    .chat-recording-viz {
      flex:1; height:24px; display:flex; align-items:center; gap:2px; overflow:hidden;
    }
    .chat-recording-viz-bar {
      width:3px; border-radius:2px; background:var(--accent); min-height:3px;
      transition:height 0.1s ease;
    }
    .chat-recording-cancel {
      background:none; border:none; color:var(--text-muted); cursor:pointer;
      font-size:13px; padding:4px 10px; border-radius:4px;
    }
    .chat-recording-cancel:hover { color:var(--text-primary); background:var(--bg-hover); }
    .chat-recording-send {
      background:var(--accent); color:var(--accent-fg); border:none; cursor:pointer;
      padding:6px 14px; border-radius:6px; font-size:13px; font-weight:600;
    }
    .chat-recording-send:hover { background:var(--accent-hover); }

    /* GIF camera toggle (left of input) */
    .chat-gif-toggle {
      width:36px; height:36px; border:none; cursor:pointer; border-radius:4px;
      display:flex; align-items:center; justify-content:center; flex-shrink:0;
      background:none; color:var(--text-muted); font-size:20px; position:relative;
      overflow:hidden;
    }
    .chat-gif-toggle:hover { color:var(--text-primary); }
    .chat-gif-toggle.active { color:var(--accent); }
    .chat-gif-toggle video {
      position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:4px;
      display:none;
    }
    .chat-gif-toggle.active video { display:block; }
    .chat-gif-toggle.active .chat-gif-icon { display:none; }

    /* GIF recording/processing feedback */
    .chat-gif-toggle.recording {
      pointer-events:none; position:relative; overflow:visible;
    }
    .chat-gif-progress {
      position:absolute; top:-10px; left:-10px; width:calc(100% + 20px); height:calc(100% + 20px);
      z-index:20; pointer-events:none;
    }
    .chat-gif-progress circle.chat-gif-progress-bg {
      fill:none; stroke:rgba(0,0,0,0.15); stroke-width:2;
    }
    .chat-gif-progress circle.chat-gif-progress-fg {
      fill:none; stroke:var(--accent); stroke-width:2; stroke-linecap:round;
      transform:rotate(-90deg); transform-origin:center;
      transition:stroke-dashoffset 100ms linear;
    }

    .chat-input-row.processing .chat-input,
    .chat-input-row.processing .chat-input-wrap,
    .chat-input-row.processing .chat-input-btn { opacity:0.5; pointer-events:none; }

    .chat-empty {
      flex:1; display:flex; align-items:center; justify-content:center;
      color:var(--text-muted); font-size:16px;
    }
    @keyframes chat-skeleton-pulse {
      0%, 100% { opacity:0.3; }
      50% { opacity:0.6; }
    }
    .chat-msg-loading { opacity:0.5; }
    .chat-skeleton {
      background:var(--bg-hover); animation:chat-skeleton-pulse 1.5s ease-in-out infinite;
    }
    .chat-skeleton-line {
      height:14px; background:var(--bg-hover); border-radius:4px; margin:4px 0;
      animation:chat-skeleton-pulse 1.5s ease-in-out infinite;
      width:60%;
    }
    .chat-skeleton-line.short { width:30%; }

    /* ================================================================
       SIDEBAR
       ================================================================ */
    .chat-main {
      display:flex; flex-direction:column; flex:1; min-width:0; position:relative;
    }
    .chat-sidebar {
      display:none; flex-direction:column; width:40%; min-width:15%;
      border-left:1px solid var(--border); background:var(--bg-darkest);
      overflow:hidden; position:relative;
    }
    .chat-sidebar.visible { display:flex; }
    .chat-sidebar.drop-target {
      display:flex; min-width:60px; width:60px;
      align-items:center; justify-content:center;
      border:2px dashed var(--accent); background:color-mix(in oklch, var(--accent) 10%, var(--bg-darkest));
    }
    .chat-sidebar.drop-target::after {
      content:"Pin"; font-size:11px; color:var(--accent); font-weight:600;
      pointer-events:none;
    }
    .chat-sidebar.visible.drop-target { width:40%; min-width:15%; }
    .chat-sidebar.visible.drop-target::after { display:none; }
    .chat-sidebar.collapsed { width:0!important; min-width:0!important; border-left:none; overflow:hidden; }
    .chat-root.sidebar-left { flex-direction:row-reverse; }
    .chat-root.sidebar-left .chat-sidebar { border-left:none; border-right:1px solid var(--border); }
    .chat-root.sidebar-left .chat-sidebar-resize { left:auto; right:-3px; }
    .chat-sidebar-resize {
      position:absolute; left:-3px; top:0; bottom:0; width:6px; cursor:col-resize; z-index:10;
    }
    .chat-sidebar-resize:hover, .chat-sidebar-resize.dragging {
      background:var(--accent); opacity:0.3;
    }
    .chat-sidebar-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:4px 6px; border-bottom:1px solid var(--border); flex-shrink:0;
    }
    .chat-sidebar-header-title { font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; }
    .chat-sidebar-collapse-btn {
      background:none; border:none; cursor:pointer; padding:2px 4px; color:var(--text-muted);
      display:flex; align-items:center;
    }
    .chat-sidebar-collapse-btn:hover { color:var(--text-primary); }
    .chat-sidebar-pinned {
      flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:4px; padding:4px;
    }
    .chat-sidebar-pinned:empty { display:none; }
    .chat-sidebar-pinned-wrap {
      position:relative; display:flex; flex-direction:column; flex:1; min-height:200px;
    }
    .chat-sidebar-pinned-toolbar {
      position:absolute; top:4px; right:4px; z-index:5;
      display:flex; gap:2px; opacity:0; transition:opacity 0.15s;
    }
    .chat-sidebar-pinned-wrap:hover .chat-sidebar-pinned-toolbar { opacity:1; }
    .chat-sidebar-pinned-toolbar button {
      background:var(--bg-darkest); border:1px solid var(--border); border-radius:4px;
      color:var(--text-muted); cursor:pointer; padding:2px 4px; font-size:10px;
      display:flex; align-items:center; gap:2px; line-height:1;
    }
    .chat-sidebar-pinned-toolbar button:hover { color:var(--text-primary); background:var(--bg-mid); }
    .chat-sidebar-pinned-toolbar button svg { width:12px; height:12px; }
    .chat-sidebar-pinned iframe {
      width:100%; flex:1; border:none; border-radius:4px; min-height:200px;
      background:var(--bg-mid);
    }
    .chat-sidebar-status {
      padding:4px 8px; font-size:11px; color:var(--text-muted); text-align:center;
    }

    .chat-sidebar-toggle-btn {
      background:none; border:none; color:var(--text-muted); cursor:pointer;
      padding:2px 4px; border-radius:4px; display:flex; align-items:center;
    }
    .chat-sidebar-toggle-btn:hover { background:var(--bg-hover); color:var(--text-primary); }

    /* Pin button on embeds */
    .chat-embed-pin { cursor:pointer; }
    .chat-embed-pin.pinned { color:var(--accent); }

    /* Computer messages */
    .chat-msg-name-computer { color:var(--accent); font-style:italic; }
    .chat-avatar.computer {
      background:var(--accent-soft); overflow:hidden;
    }
    .chat-avatar.computer img {
      width:100%; height:100%; object-fit:cover; display:block;
    }
    .computer-presence img {
      width:100%; height:100%; object-fit:cover; display:block; border-radius:50%;
    }
  `
	return style
}

// ============================================================================
// Emoji data — loaded from unicode-emoji-json via esm.sh
// ============================================================================
let EMOJI_DATA = [] // [{emoji, name, group}]
let EMOJI_LOADED = false

// Common shortcode aliases (GitHub/Discord/Slack style)
const EMOJI_ALIASES = {
	"+1": "👍",
	"-1": "👎",
	thumbsup: "👍",
	thumbsdown: "👎",
	heart: "❤️",
	broken_heart: "💔",
	smile: "😄",
	laughing: "😆",
	blush: "😊",
	smiley: "😃",
	grinning: "😀",
	wink: "😉",
	heart_eyes: "😍",
	kissing_heart: "😘",
	stuck_out_tongue: "😛",
	sweat_smile: "😅",
	joy: "😂",
	rofl: "🤣",
	sob: "😭",
	cry: "😢",
	rage: "😡",
	angry: "😠",
	thinking: "🤔",
	flushed: "😳",
	scream: "😱",
	pensive: "😔",
	confused: "😕",
	disappointed: "😞",
	worried: "😟",
	triumph: "😤",
	unamused: "😒",
	sweat: "😰",
	weary: "😩",
	sunglasses: "😎",
	nerd: "🤓",
	innocent: "😇",
	smirk: "😏",
	relieved: "😌",
	yum: "😋",
	drooling_face: "🤤",
	lying_face: "🤥",
	zipper_mouth: "🤐",
	nauseated_face: "🤢",
	sneezing_face: "🤧",
	cold_face: "🥶",
	hot_face: "🥵",
	exploding_head: "🤯",
	cowboy: "🤠",
	partying_face: "🥳",
	disguised_face: "🥸",
	ghost: "👻",
	skull: "💀",
	poop: "💩",
	clown: "🤡",
	alien: "👽",
	robot: "🤖",
	wave: "👋",
	ok_hand: "👌",
	pinched_fingers: "🤌",
	v: "✌️",
	crossed_fingers: "🤞",
	metal: "🤘",
	call_me: "🤙",
	muscle: "💪",
	pray: "🙏",
	handshake: "🤝",
	clap: "👏",
	raised_hands: "🙌",
	open_hands: "👐",
	palms_up: "🤲",
	fire: "🔥",
	tada: "🎉",
	sparkles: "✨",
	star: "⭐",
	zap: "⚡",
	100: "💯",
	boom: "💥",
	trophy: "🏆",
	medal: "🏅",
	crown: "👑",
	eyes: "👀",
	eye: "👁️",
	brain: "🧠",
	tongue: "👅",
	lips: "👄",
	baby: "👶",
	dog: "🐶",
	cat: "🐱",
	fox: "🦊",
	bear: "🐻",
	panda: "🐼",
	unicorn: "🦄",
	butterfly: "🦋",
	rainbow: "🌈",
	sun: "☀️",
	moon: "🌙",
	cloud: "☁️",
	umbrella: "☂️",
	snowflake: "❄️",
	pizza: "🍕",
	burger: "🍔",
	fries: "🍟",
	taco: "🌮",
	sushi: "🍣",
	coffee: "☕",
	beer: "🍺",
	wine: "🍷",
	cocktail: "🍸",
	cake: "🎂",
	rocket: "🚀",
	airplane: "✈️",
	car: "🚗",
	bike: "🚲",
	ship: "🚢",
	warning: "⚠️",
	no_entry: "⛔",
	x: "❌",
	white_check_mark: "✅",
	check: "✅",
	question: "❓",
	exclamation: "❗",
	bulb: "💡",
	bell: "🔔",
	mega: "📣",
	lock: "🔒",
	key: "🔑",
	link: "🔗",
	gem: "💎",
	gift: "🎁",
	memo: "📝",
	book: "📖",
	pen: "🖊️",
	scissors: "✂️",
	pushpin: "📌",
	calendar: "📅",
	chart: "📈",
	mailbox: "📬",
	package: "📦",
	hash: "#️⃣",
	keycap_star: "*️⃣",
	zero: "0️⃣",
	one: "1️⃣",
	two: "2️⃣",
	recycle: "♻️",
	peace: "☮️",
	atom: "⚛️",
	infinity: "♾️",
	yin_yang: "☯️",
}

// Fallback while loading
const FALLBACK_EMOJIS = [
	"😀",
	"😃",
	"😄",
	"😁",
	"😆",
	"😅",
	"🤣",
	"😂",
	"🙂",
	"😉",
	"😊",
	"😇",
	"🥰",
	"😍",
	"🤩",
	"😘",
	"😋",
	"😛",
	"😜",
	"🤪",
	"😝",
	"🤗",
	"🤭",
	"🤫",
	"🤔",
	"😐",
	"😏",
	"🙄",
	"😬",
	"😌",
	"😴",
	"🤮",
	"🥵",
	"🥶",
	"🤯",
	"🤠",
	"🥳",
	"😎",
	"🤓",
	"😢",
	"😭",
	"😱",
	"😤",
	"😡",
	"😈",
	"💀",
	"💩",
	"🤡",
	"👻",
	"👽",
	"🤖",
	"❤️",
	"🧡",
	"💛",
	"💚",
	"💙",
	"💜",
	"🖤",
	"🤍",
	"💔",
	"👍",
	"👎",
	"👊",
	"✊",
	"🤞",
	"✌️",
	"🤟",
	"🤘",
	"👌",
	"👋",
	"💪",
	"🙏",
	"🎉",
	"🎊",
	"🏆",
	"🔥",
	"⭐",
	"✨",
	"⚡",
	"💥",
	"💯",
	"🎵",
	"🎶",
]

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"]

// Load full emoji catalog async
import("https://esm.sh/unicode-emoji-json@0.6.0")
	.then(mod => {
		const data = mod.default
		EMOJI_DATA = Object.entries(data).map(([emoji, info]) => ({
			emoji,
			name: info.name || "",
			group: info.group || "",
		}))
		EMOJI_LOADED = true
	})
	.catch(e => console.warn("[Chat] emoji load failed, using fallback:", e))

// ============================================================================
// CodeMirror 6 — available via importmap
// ============================================================================
const cmPromise = Promise.all([
	import("@codemirror/view"),
	import("@codemirror/state"),
]).then(([viewMod, stateMod]) => ({...viewMod, ...stateMod}))

// ============================================================================
// GIF Encoder
// ============================================================================
class SimpleGIFEncoder {
	constructor(w, h, transparent = false) {
		this.width = w
		this.height = h
		this.frames = []
		this.transparent = transparent
	}

	addFrame(canvas, delay = 100) {
		const ctx = canvas.getContext("2d")
		this.frames.push({
			data: ctx.getImageData(0, 0, this.width, this.height).data,
			delay,
		})
	}

	addFrameData(imageData, delay = 100) {
		this.frames.push({data: imageData, delay})
	}

	// Median-cut quantization — full 8-bit per channel, no binning
	_quantize(pixels) {
		const max = this.transparent ? 255 : 256
		// Collect unique colours as [r,g,b]
		const colors = []
		for (let i = 0; i < pixels.length; i += 4) {
			if (this.transparent && pixels[i + 3] < 128) continue
			colors.push([pixels[i], pixels[i + 1], pixels[i + 2]])
		}
		if (colors.length === 0) {
			const p = []
			while (p.length < 256) p.push([0, 0, 0])
			return p
		}

		// Median cut: recursively split colour buckets along the channel with the widest range
		let buckets = [colors]
		while (buckets.length < max) {
			// Find the bucket with the largest range to split
			let bestIdx = 0,
				bestRange = -1,
				bestCh = 0
			for (let bi = 0; bi < buckets.length; bi++) {
				const b = buckets[bi]
				if (b.length < 2) continue
				for (let ch = 0; ch < 3; ch++) {
					let lo = 255,
						hi = 0
					for (const c of b) {
						if (c[ch] < lo) lo = c[ch]
						if (c[ch] > hi) hi = c[ch]
					}
					const range = hi - lo
					if (range > bestRange) {
						bestRange = range
						bestIdx = bi
						bestCh = ch
					}
				}
			}
			if (bestRange <= 0) break
			const bucket = buckets[bestIdx]
			bucket.sort((a, b) => a[bestCh] - b[bestCh])
			const mid = bucket.length >> 1
			buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid))
		}

		// Average each bucket to get the palette colour
		const pal = buckets.map(b => {
			let r = 0,
				g = 0,
				bl = 0
			for (const c of b) {
				r += c[0]
				g += c[1]
				bl += c[2]
			}
			const n = b.length || 1
			return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)]
		})
		while (pal.length < 256) pal.push([0, 0, 0])
		return pal
	}

	_closest(p, r, g, b) {
		let best = 0,
			bd = Infinity
		for (let i = 0; i < p.length; i++) {
			const dr = r - p[i][0],
				dg = g - p[i][1],
				db = b - p[i][2],
				d = dr * dr + dg * dg + db * db
			if (d < bd) {
				bd = d
				best = i
			}
		}
		return best
	}

	encode() {
		if (!this.frames.length) return null
		const bytes = []
		const wb = b => bytes.push(b & 0xff),
			ws = s => {
				wb(s)
				wb(s >> 8)
			},
			wr = s => {
				for (let i = 0; i < s.length; i++) wb(s.charCodeAt(i))
			}
		const transIdx = this.transparent ? 255 : 0

		// GIF header — no global colour table (each frame has its own local table)
		wr("GIF89a")
		ws(this.width)
		ws(this.height)
		wb(0x70) // no GCT, 8-bit colour resolution
		wb(0)
		wb(0)
		// NETSCAPE looping extension
		wb(0x21)
		wb(0xff)
		wb(11)
		wr("NETSCAPE2.0")
		wb(3)
		wb(1)
		ws(0)
		wb(0)

		for (const frame of this.frames) {
			// Per-frame palette via median cut
			const pal = this._quantize(frame.data)

			// Graphic control extension
			wb(0x21)
			wb(0xf9)
			wb(4)
			wb(this.transparent ? 0x09 : 0x04)
			ws(Math.round(frame.delay / 10))
			wb(transIdx)
			wb(0)

			// Image descriptor with local colour table flag
			wb(0x2c)
			ws(0)
			ws(0)
			ws(this.width)
			ws(this.height)
			wb(0x87) // local colour table, 256 entries (2^(7+1))

			// Write local colour table
			for (const [r, g, b] of pal) {
				wb(r)
				wb(g)
				wb(b)
			}

			const mcs = 8
			wb(mcs)
			const w = this.width,
				h = this.height,
				px = frame.data,
				idx = new Uint8Array(w * h)
			for (let i = 0; i < w * h; i++) {
				if (this.transparent && px[i * 4 + 3] < 128) idx[i] = transIdx
				else
					idx[i] = this._closest(pal, px[i * 4], px[i * 4 + 1], px[i * 4 + 2])
			}
			const lzw = this._lzw(mcs, idx)
			let pos = 0
			while (pos < lzw.length) {
				const c = Math.min(255, lzw.length - pos)
				wb(c)
				for (let i = 0; i < c; i++) bytes.push(lzw[pos++])
			}
			wb(0)
		}
		wb(0x3b)
		return new Uint8Array(bytes)
	}

	_lzw(mcs, pixels) {
		const cc = 1 << mcs,
			eoi = cc + 1
		let cs = mcs + 1,
			nc = eoi + 1
		const tbl = new Map(),
			out = []
		let buf = 0,
			bb = 0
		const emit = c => {
			buf |= c << bb
			bb += cs
			while (bb >= 8) {
				out.push(buf & 0xff)
				buf >>= 8
				bb -= 8
			}
		}
		const reset = () => {
			tbl.clear()
			for (let i = 0; i < cc; i++) tbl.set(String(i), i)
			nc = eoi + 1
			cs = mcs + 1
		}
		emit(cc)
		reset()
		if (!pixels.length) {
			emit(eoi)
			if (bb > 0) out.push(buf & 0xff)
			return out
		}
		let cur = String(pixels[0])
		for (let i = 1; i < pixels.length; i++) {
			const nx = cur + "," + pixels[i]
			if (tbl.has(nx)) {
				cur = nx
			} else {
				emit(tbl.get(cur))
				if (nc < 4096) {
					tbl.set(nx, nc++)
					if (nc > 1 << cs && cs < 12) cs++
				} else {
					emit(cc)
					reset()
				}
				cur = String(pixels[i])
			}
		}
		emit(tbl.get(cur))
		emit(eoi)
		if (bb > 0) out.push(buf & 0xff)
		return out
	}
}

// ============================================================================
// Theme presets
// ============================================================================
const THEME_PRESETS = [
	{name: "Indigo", color: "oklch(0.55 0.18 270)"},
	{name: "Rose", color: "oklch(0.55 0.18 350)"},
	{name: "Emerald", color: "oklch(0.55 0.18 155)"},
	{name: "Cyan", color: "oklch(0.75 0.30 200)"},
	{name: "Yellow", color: "oklch(0.90 0.35 95)"},
	{name: "Neon Mint", color: "oklch(0.85 0.30 160)"},
	{name: "Purple", color: "oklch(0.50 0.20 300)"},
	{name: "Light Pink", color: "oklch(0.80 0.12 350)"},
	{name: "Light Blue", color: "oklch(0.80 0.10 240)"},
	{name: "Lavender", color: "oklch(0.75 0.14 300)"},
	{name: "Slate", color: "oklch(0.45 0.02 260)"},
	{name: "White", color: "oklch(1.00 0 0)"},
	{name: "Black", color: "oklch(0.15 0 0)"},
]

// ============================================================================
// Tool
// ============================================================================

// SVG Icons
const SVG_ICONS = {
	reply:
		'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
	react:
		'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
	send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
	mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
	micStop:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
	camera:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12v12H4z"/><path d="M16 6l4-3v18l-4-3"/><circle cx="10" cy="12" r="2.5"/><text x="6" y="22" font-size="5" font-weight="bold" fill="currentColor" stroke="none" font-family="system-ui">GIF</text></svg>',
	theme:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.7-.1 2.5-.3a1 1 0 0 0 .7-1.1l-.5-3a1 1 0 0 1 1-1.2h2.8a1 1 0 0 0 1-1.1A10 10 0 0 0 12 2z"/></svg>',
	play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
	pause:
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
	close:
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
	plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
	trash:
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
	more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
	file: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
	bellOutline:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
	bellFilled:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
	bellOff:
		'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
	pin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
	robot:
		'<svg width="16" height="16" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
		'<rect x="4" y="10" width="24" height="18" rx="4" />' + // body
		'<rect x="11" y="4" width="10" height="7" rx="2" />' + // top hat/antenna
		'<circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />' + // left eye
		'<circle cx="20" cy="18" r="1.5" fill="currentColor" stroke="none" />' + // right eye
		'<line x1="10" y1="23" x2="22" y2="23" />' + // mouth
		'</svg>',
	phone:
		'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
	externalLink:
		'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
}

export function Tool(handle, element, options) {
	const style = createStyles()
	element.appendChild(style)

	// Ensure the host element is a positioning context for the absolute root
	if (getComputedStyle(element).position === "static") {
		element.style.position = "relative"
	}

	const root = document.createElement("div")
	root.className = "chat-root"
	if (localStorage.getItem("chat-sidebar-side") === "left") root.classList.add("sidebar-left")
	element.appendChild(root)

	// Prevent tldraw (or other parent tools) from eating pointer events on our
	// interactive elements. tldraw calls stopPropagation on pointerdown which
	// prevents click events from ever firing. We stop pointerdown propagation
	// on the root so our clicks work. Per patchwork rules: only stopPropagation
	// on pointerDown/pointerUp, never on click.
	// Note: Do NOT blanket-stopPropagation on root for pointer/wheel/touch events.
	// When embedded in tldraw, PatchworkDocShape handles event isolation in the
	// capture phase when the shape is focused. Blanket stopping interferes with
	// the focus mechanism. Only stop propagation on specific interactive elements.

	let myName = "Anonymous"
	let myFont = null
	let myAvatarUrl = null
	let myColor = null
	let myAvatarBlobUrl = null
	let isLightBg = false
	let replyToId = null
	let pendingFiles = [] // { blob, dataUrl?, name, mimeType }
	let pendingEmbeds = [] // { docUrl, toolId?, title?, type? }
	let isRecording = false
	let mediaRecorder = null
	let recordingChunks = []
	let recordingStartTime = 0
	let gifModeEnabled = false
	let gifStream = null
	let catEarsSet = new Set()
	const avatarCache = new Map()

	// ---- Pinned docs state ----
	const pinnedDocLogs = new Map() // url -> [{level, args, ts}]
	const pinnedIframes = new Map() // url -> iframe element
	const cleanupListeners = [] // {target, event, handler} for teardown

	// ---- LLM state ----
	let llmReady = false
	const llmCallbacks = new Map() // id -> {resolve, reject}
	let computerActive = false
	let computerAutoMode = false
	let computerFolderUrl = null
	let lastComputerProcessedIndex = 0
	const computerAvatarSrc = new URL("./computer.png", import.meta.url).href

	// ---- Moonshine transcription state ----
	let whisperWorker = null
	let whisperReady = false
	const pendingTranscriptions = new Map() // recordingUrl -> true

	// ---- Recording doc cache (for transcription) ----
	const recordingDocCache = new Map() // recordingUrl -> { data, handle }
	const recordingDocSubscribed = new Set()

	async function resolveRecordingDoc(url) {
		if (recordingDocCache.has(url)) return recordingDocCache.get(url)
		try {
			const repo = window.repo
			if (!repo) return null
			const rh = await repo.find(url)
			const data = rh.doc()
			if (data) recordingDocCache.set(url, {data, handle: rh})
			if (!recordingDocSubscribed.has(url)) {
				recordingDocSubscribed.add(url)
				rh.on("change", () => {
					const prev = recordingDocCache.get(url)
					const updated = rh.doc()
					if (updated) {
						recordingDocCache.set(url, {data: updated, handle: rh})
						// Only re-render if transcription changed
						if (updated.transcription !== prev?.data?.transcription) {
							scheduleRender()
						}
					}
				})
			}
			// Re-render now that we have the recording doc loaded
			scheduleRender()
			return recordingDocCache.get(url)
		} catch (e) {
			return null
		}
	}

	const PRESENCE_TIMEOUT = 30000
	const TYPING_TIMEOUT = 3000
	let presenceInterval = null
	const presenceMap = new Map()

	// ---- Chat profile doc & read tracking ----
	let chatProfileHandle = null
	let contactHandle = null
	let lastKnownMessageCount = 0
	let hasUnread = false
	let baseTitle = "Chat"
	const chatUrl = handle.url

	// ---- Draft sync (persisted across refreshes/devices) ----
	let draftHandle = null
	let draftSyncTimer = null
	let draftIsLocal = false // true while we're writing, to ignore our own changes

	function syncDraftToDoc() {
		if (!draftHandle) return
		const text = getInputValue()
		const current = draftHandle.doc()?.text || ""
		if (text === current) return
		draftIsLocal = true
		draftHandle.change(d => {
			d.text = text
		})
		// Reset flag after a tick so we don't ignore remote changes forever
		setTimeout(() => {
			draftIsLocal = false
		}, 50)
	}

	function scheduleDraftSync() {
		if (draftSyncTimer) clearTimeout(draftSyncTimer)
		draftSyncTimer = setTimeout(syncDraftToDoc, 300)
	}

	function clearDraft() {
		if (draftSyncTimer) {
			clearTimeout(draftSyncTimer)
			draftSyncTimer = null
		}
		if (!draftHandle) return
		draftIsLocal = true
		draftHandle.change(d => {
			d.text = ""
		})
		setTimeout(() => {
			draftIsLocal = false
		}, 50)
	}

	async function initDraftDoc() {
		if (!chatProfileHandle) return
		const repo = window.repo
		if (!repo) return
		const profile = chatProfileHandle.doc()
		const existingUrl = profile?.drafts?.[chatUrl]
		if (existingUrl) {
			try {
				draftHandle = await repo.find(existingUrl)
			} catch (e) {
				console.warn("[Chat] draft doc find failed:", e)
			}
		}
		if (!draftHandle) {
			draftHandle = await repo.create2({text: ""})
			chatProfileHandle.change(d => {
				if (!d.drafts) d.drafts = {}
				d.drafts[chatUrl] = draftHandle.url
			})
		}
		// Restore draft into editor
		const saved = draftHandle.doc()?.text
		if (saved && !getInputValue()) {
			setInputValue(saved)
		}
		// Listen for remote changes (other device editing the draft)
		draftHandle.on("change", () => {
			if (draftIsLocal) return
			const remote = draftHandle.doc()?.text || ""
			if (remote !== getInputValue()) {
				const pos = getInputCursor()
				if (cmView) {
					cmView.dispatch({
						changes: {from: 0, to: cmView.state.doc.length, insert: remote},
						selection: {anchor: Math.min(pos, remote.length)},
					})
				}
			}
		})
	}

	// ---- Notifications & Sound ----
	let notificationsEnabled =
		localStorage.getItem("chat-notifications-enabled") === "true"
	let soundEnabled = localStorage.getItem("chat-sound-enabled") !== "false" // default on
	let notifyBtn = null

	function updateNotifyBtn() {
		if (!notifyBtn) return
		if (soundEnabled || notificationsEnabled) {
			notifyBtn.innerHTML = SVG_ICONS.bellFilled
			notifyBtn.title = "Notification settings"
		} else {
			notifyBtn.innerHTML = SVG_ICONS.bellOutline
			notifyBtn.title = "Notification settings"
		}
	}

	async function toggleNotifications() {
		if (typeof Notification === "undefined") return
		if (!notificationsEnabled) {
			const perm =
				Notification.permission === "granted"
					? "granted"
					: await Notification.requestPermission()
			if (perm === "granted") {
				notificationsEnabled = true
				localStorage.setItem("chat-notifications-enabled", "true")
			}
		} else {
			notificationsEnabled = false
			localStorage.setItem("chat-notifications-enabled", "false")
		}
		updateNotifyBtn()
	}

	function toggleSound() {
		soundEnabled = !soundEnabled
		localStorage.setItem("chat-sound-enabled", soundEnabled ? "true" : "false")
		updateNotifyBtn()
	}

	function showOSNotification(authorName, text, avatarBlobUrl) {
		if (!notificationsEnabled || typeof Notification === "undefined") return
		if (Notification.permission !== "granted") return
		try {
			const n = new Notification("New message from " + authorName, {
				body: (text || "").slice(0, 200),
				icon: avatarBlobUrl || undefined,
				tag: chatUrl,
			})
			n.onclick = () => {
				window.focus()
				n.close()
			}
		} catch (e) {
			console.warn("[Chat] notification:", e)
		}
	}

	// Notification sound — loaded lazily from ./3beep.mp3
	let notificationAudio = null
	async function getNotificationSound() {
		if (notificationAudio) return notificationAudio
		try {
			const resp = await fetch(new URL("./3beep.mp3", import.meta.url))
			const blob = await resp.blob()
			notificationAudio = new Audio(URL.createObjectURL(blob))
			notificationAudio.volume = 0.5
			return notificationAudio
		} catch (e) {
			console.warn("[Chat] notification sound:", e)
			return null
		}
	}

	// ---- Emoticons ----
	// allEmoticons: merged map of name → { url (automerge), owner (user name), mine (boolean) }
	let myEmoticons = {} // name → automerge url
	const peerEmoticons = new Map() // peerName → { name → automerge url }
	const emoticonBlobCache = new Map() // automerge url → blob url

	function getAllEmoticons() {
		const all = {}
		// Own emoticons first
		for (const [name, url] of Object.entries(myEmoticons)) {
			all[name] = {url, owner: myName, mine: true}
		}
		// Chat doc emoticons (shared, persistent)
		const chatDoc = handle.doc()
		if (chatDoc?.emoticons) {
			for (const [name, entry] of Object.entries(chatDoc.emoticons)) {
				if (!all[name] && entry?.url) {
					all[name] = {
						url: entry.url,
						owner: entry.addedBy || "unknown",
						mine: entry.addedBy === myName,
						fromChat: true,
					}
				}
			}
		}
		// Peer emoticons (don't overwrite own or chat doc)
		for (const [peerName, emoticons] of peerEmoticons) {
			for (const [name, url] of Object.entries(emoticons)) {
				if (!all[name]) all[name] = {url, owner: peerName, mine: false}
			}
		}
		return all
	}

	function addEmoticonToChatDoc(name, url) {
		handle.change(d => {
			if (!d.emoticons) d.emoticons = {}
			d.emoticons[name] = {url, addedBy: myName}
		})
	}

	async function loadEmoticonBlobUrl(automergeUrl) {
		if (emoticonBlobCache.has(automergeUrl))
			return emoticonBlobCache.get(automergeUrl)
		const blobUrl = await loadBlobUrl(automergeUrl)
		if (blobUrl) emoticonBlobCache.set(automergeUrl, blobUrl)
		return blobUrl
	}

	async function addEmoticon(name, file) {
		const ext = file.name?.split(".").pop()?.toLowerCase() || "png"
		const mime = file.type || "image/" + ext
		const repo = window.repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await file.arrayBuffer())
		const fh = await repo.create2({
			content: u8,
			extension: ext,
			mimeType: mime,
			name: name + "." + ext,
			"@patchwork": {type: "file"},
		})
		const url = fh.url
		myEmoticons[name] = url
		if (chatProfileHandle) {
			chatProfileHandle.change(d => {
				if (!d.emoticons) d.emoticons = {}
				d.emoticons[name] = url
			})
		}
		addEmoticonToChatDoc(name, url)
		broadcastPresence(false)
		if (rebuildEmojiDecorations) rebuildEmojiDecorations()
		return url
	}

	function removeEmoticon(name) {
		delete myEmoticons[name]
		if (chatProfileHandle) {
			chatProfileHandle.change(d => {
				if (d.emoticons) delete d.emoticons[name]
			})
		}
		handle.change(d => {
			if (d.emoticons) delete d.emoticons[name]
		})
		broadcastPresence(false)
		if (rebuildEmojiDecorations) rebuildEmojiDecorations()
	}

	function adoptEmoticon(name, url) {
		if (myEmoticons[name]) return // already have it
		myEmoticons[name] = url
		if (chatProfileHandle) {
			chatProfileHandle.change(d => {
				if (!d.emoticons) d.emoticons = {}
				d.emoticons[name] = url
			})
		}
		addEmoticonToChatDoc(name, url)
		broadcastPresence(false)
		if (rebuildEmojiDecorations) rebuildEmojiDecorations()
	}

	// ---- Custom Fonts ----
	let myFonts = {} // name → automerge url
	const peerFonts = new Map() // peerName → { name → automerge url }
	const loadedFontFaces = new Set() // font names already injected via FontFace

	function getAllFonts() {
		const all = {}
		for (const [name, url] of Object.entries(myFonts)) {
			all[name] = {url, owner: myName, mine: true}
		}
		for (const [peerName, fonts] of peerFonts) {
			for (const [name, url] of Object.entries(fonts)) {
				if (!all[name]) all[name] = {url, owner: peerName, mine: false}
			}
		}
		return all
	}

	async function ensureFontLoaded(fontName) {
		if (loadedFontFaces.has(fontName)) return
		// Check own fonts, peer fonts, and chat doc fonts
		const all = getAllFonts()
		let url = all[fontName]?.url
		if (!url) {
			const chatDocFonts = handle.doc()?.fonts
			if (chatDocFonts?.[fontName]?.url) url = chatDocFonts[fontName].url
		}
		if (!url) return
		try {
			const blobUrl = await loadBlobUrl(url)
			if (!blobUrl) return
			const face = new FontFace(fontName, "url(" + blobUrl + ")")
			await face.load()
			document.fonts.add(face)
			loadedFontFaces.add(fontName)
		} catch (e) {
			console.warn("[Chat] font load failed:", fontName, e)
		}
	}

	async function addFont(name, file) {
		const repo = window.repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await file.arrayBuffer())
		const fh = await repo.create2({
			content: u8,
			extension: "woff2",
			mimeType: "font/woff2",
			name: name + ".woff2",
			"@patchwork": {type: "file"},
		})
		const url = fh.url
		myFonts[name] = url
		if (chatProfileHandle) {
			chatProfileHandle.change(d => {
				if (!d.fonts) d.fonts = {}
				d.fonts[name] = url
			})
		}
		// Share in chat doc too
		handle.change(d => {
			if (!d.fonts) d.fonts = {}
			d.fonts[name] = {url, addedBy: myName}
		})
		broadcastPresence(false)
		// Load immediately
		loadedFontFaces.delete(name)
		await ensureFontLoaded(name)
		return url
	}

	function removeFont(name) {
		delete myFonts[name]
		if (chatProfileHandle) {
			chatProfileHandle.change(d => {
				if (d.fonts) delete d.fonts[name]
			})
		}
		handle.change(d => {
			if (d.fonts) delete d.fonts[name]
		})
		// Remove from document.fonts
		for (const face of document.fonts) {
			if (face.family === name) {
				document.fonts.delete(face)
				break
			}
		}
		loadedFontFaces.delete(name)
		broadcastPresence(false)
	}

	// Saved theme is applied after setTheme is defined (see below)

	// ---- Resolve account & chat profile ----
	async function resolveAccountName() {
		try {
			const repo = window.repo
			if (!repo) return
			const adh = window.accountDocHandle
			if (!adh) return
			const ad = adh.doc()
			if (!ad?.contactUrl) return
			contactHandle = await repo.find(ad.contactUrl)
			const cd = contactHandle.doc()
			if (!cd) return
			if (cd.name) myName = cd.name

			// Resolve or migrate chat profile doc
			// Preferred location: account doc. Fallback: contact doc (old location).
			if (ad.chatProfileUrl) {
				chatProfileHandle = await repo.find(ad.chatProfileUrl)
			} else if (cd.chatProfileUrl) {
				// Migrate from contact -> account
				chatProfileHandle = await repo.find(cd.chatProfileUrl)
				adh.change(d => {
					d.chatProfileUrl = chatProfileHandle.url
				})
			} else {
				// Create new chat profile doc (migrate from old .chat field if present)
				const initialProfile = {readPositions: {}}
				if (cd.chat?.font) initialProfile.font = cd.chat.font
				chatProfileHandle = await repo.create2(initialProfile)
				adh.change(d => {
					d.chatProfileUrl = chatProfileHandle.url
				})
				if (cd.chat) {
					contactHandle.change(d => {
						delete d.chat
					})
				}
			}

			const profile = chatProfileHandle.doc()
			if (profile?.font) {
				myFont = profile.font
				if (cmView) cmView.dom.style.fontFamily = myFont
			}
			if (profile?.emoticons) {
				myEmoticons = {...profile.emoticons}
			}
			if (profile?.fonts) {
				myFonts = {...profile.fonts}
				// Load all custom fonts
				for (const name of Object.keys(myFonts)) ensureFontLoaded(name)
			}

			// Also load fonts shared in the chat doc
			const chatDocFonts = handle.doc()?.fonts
			if (chatDocFonts) {
				for (const [name, entry] of Object.entries(chatDocFonts)) {
					if (entry?.url && !myFonts[name]) ensureFontLoaded(name)
				}
			}

			if (cd.avatarUrl) {
				myAvatarUrl = cd.avatarUrl
				myAvatarBlobUrl = await loadBlobUrl(cd.avatarUrl)
			}
			if (cd.color) myColor = cd.color
			render()
			broadcastPresence()

			// Check initial unread state
			const chatDoc = handle.doc()
			if (chatDoc?.messages?.length) {
				const lastMsg = chatDoc.messages[chatDoc.messages.length - 1]
				const lastRead = chatProfileHandle.doc()?.readPositions?.[chatUrl] || 0
				if ((lastMsg.timestamp || 0) > lastRead) {
					hasUnread = true
					updateTitle()
				}
			}

			// Mark as read if already focused and at bottom
			markReadIfVisible()

			// Init draft doc for cross-device draft sync
			initDraftDoc()
		} catch (e) {
			console.warn("[Chat] resolve account:", e)
		}
	}
	resolveAccountName()

	function markReadIfVisible() {
		if (!chatProfileHandle || !isFocused || document.hidden) return
		const atBottom =
			messagesArea.scrollHeight -
				messagesArea.scrollTop -
				messagesArea.clientHeight <
			40
		if (!atBottom) return
		const doc = handle.doc()
		if (!doc?.messages?.length) return
		const lastTimestamp =
			doc.messages[doc.messages.length - 1].timestamp ||
			(doc.messages[doc.messages.length - 1].ref && Date.now())
		if (!lastTimestamp) return
		const profile = chatProfileHandle.doc()
		const current = profile?.readPositions?.[chatUrl]
		if (current && current >= lastTimestamp) return
		chatProfileHandle.change(d => {
			if (!d.readPositions) d.readPositions = {}
			d.readPositions[chatUrl] = lastTimestamp
		})
		if (hasUnread) {
			hasUnread = false
			updateTitle()
		}
	}

	// ---- Favicon unread dot ----
	let originalFaviconHref = null
	let faviconWithDot = null
	function setFaviconUnread(unread) {
		let link =
			document.querySelector('link[rel="icon"]') ||
			document.querySelector('link[rel="shortcut icon"]')
		if (!link) {
			link = document.createElement("link")
			link.rel = "icon"
			document.head.appendChild(link)
		}
		if (!originalFaviconHref && link.href) originalFaviconHref = link.href

		if (!unread) {
			if (originalFaviconHref) link.href = originalFaviconHref
			faviconWithDot = null
			return
		}
		if (faviconWithDot) {
			link.href = faviconWithDot
			return
		}

		const size = 64
		const canvas = document.createElement("canvas")
		canvas.width = size
		canvas.height = size
		const ctx = canvas.getContext("2d")

		function drawDot() {
			ctx.beginPath()
			ctx.arc(size - 10, 10, 10, 0, Math.PI * 2)
			ctx.fillStyle = "#ed4245"
			ctx.fill()
			faviconWithDot = canvas.toDataURL("image/png")
			link.href = faviconWithDot
		}

		if (originalFaviconHref) {
			const img = new Image()
			img.crossOrigin = "anonymous"
			img.onload = () => {
				ctx.drawImage(img, 0, 0, size, size)
				drawDot()
			}
			img.onerror = () => {
				drawDot()
			}
			img.src = originalFaviconHref
		} else {
			drawDot()
		}
	}

	function updateTitle() {
		const doc = handle.doc()
		baseTitle = doc?.title || "Chat"
		const now = Date.now()
		const typers = []
		for (const [name, info] of presenceMap) {
			if (name === myName) continue
			if (info.typing && now - info.timestamp < TYPING_TIMEOUT)
				typers.push(name)
		}
		let title = baseTitle
		if (typers.length > 0) {
			title =
				typers.join(", ") +
				(typers.length === 1 ? " is" : " are") +
				" typing\u2026 \u2014 " +
				baseTitle
		}
		if (hasUnread) title = "* " + title
		document.title = title
		setFaviconUnread(hasUnread)
	}

	// ---- Ephemeral presence ----
	let isFocused = document.hasFocus()
	function onVisible() {
		isFocused = !document.hidden
		broadcastPresence(false)
		if (isFocused) markReadIfVisible()
	}
	function onFocus() {
		isFocused = true
		broadcastPresence(false)
		markReadIfVisible()
	}
	function onBlur() {
		isFocused = false
		broadcastPresence(false)
	}
	document.addEventListener("visibilitychange", onVisible)
	window.addEventListener("focus", onFocus)
	window.addEventListener("blur", onBlur)

	function broadcastPresence(typing) {
		try {
			const payload = {
				type: "presence",
				name: myName,
				typing: !!typing,
				avatarUrl: myAvatarUrl,
				color: myColor,
				active: isFocused,
				timestamp: Date.now(),
			}
			if (Object.keys(myEmoticons).length > 0) payload.emoticons = myEmoticons
			if (Object.keys(myFonts).length > 0) payload.fonts = myFonts
			handle.broadcast(payload)
		} catch (e) {}
	}

	const onEphemeralMessage = data => {
		const msg = data.message
		if (msg?.type === "presence") {
			presenceMap.set(msg.name, {
				timestamp: msg.timestamp,
				typing: msg.typing,
				avatarUrl: msg.avatarUrl,
				color: msg.color,
				active: msg.active,
			})
			if (msg.emoticons) {
				peerEmoticons.set(msg.name, msg.emoticons)
				if (rebuildEmojiDecorations) rebuildEmojiDecorations()
			}
			if (msg.fonts) {
				peerFonts.set(msg.name, msg.fonts)
				for (const name of Object.keys(msg.fonts)) ensureFontLoaded(name)
			}
			renderPresence()
			renderTyping()
		}
	}
	handle.on("ephemeral-message", onEphemeralMessage)

	presenceInterval = setInterval(() => {
		broadcastPresence(false)
		const now = Date.now()
		for (const [n, info] of presenceMap) {
			if (now - info.timestamp > PRESENCE_TIMEOUT) presenceMap.delete(n)
		}
		renderPresence()
		renderTyping()
	}, 10000)

	// ============================================================
	// UI Construction
	// ============================================================

	// ---- Theme button ----
	const themeBtn = document.createElement("button")
	themeBtn.className = "chat-theme-btn"
	themeBtn.title = "Theme"
	themeBtn.innerHTML = SVG_ICONS.theme
	themeBtn.style.position = "relative"

	const themePopover = document.createElement("div")
	themePopover.className = "chat-theme-popover"

	const themeLabel = document.createElement("label")
	themeLabel.textContent = "Theme Color"
	themePopover.appendChild(themeLabel)

	const presetRow = document.createElement("div")
	presetRow.className = "chat-theme-presets"
	for (const preset of THEME_PRESETS) {
		const dot = document.createElement("button")
		dot.className = "chat-theme-preset"
		dot.style.background = preset.color
		dot.title = preset.name
		dot.addEventListener("click", e => {
			e.stopPropagation()
			const m = preset.color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
			if (m) {
				themeL = parseFloat(m[1])
				themeC = parseFloat(m[2])
				themeH = parseFloat(m[3])
				hueSlider.value = String(themeH)
				hueNumber.value = String(themeH)
				lumSlider.value = String(Math.round(themeL * 100))
				lumNumber.value = String(Math.round(themeL * 100))
				chromaSlider.value = String(Math.round(themeC * 100))
				chromaNumber.value = String(Math.round(themeC * 100))
			}
			setTheme(preset.color)
		})
		presetRow.appendChild(dot)
	}
	themePopover.appendChild(presetRow)

	// Theme sliders state
	let themeL = 0.55,
		themeC = 0.18,
		themeH = 270

	// Try to parse saved theme
	try {
		const saved = localStorage.getItem("chat-theme-color")
		if (saved) {
			const m = saved.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
			if (m) {
				themeL = parseFloat(m[1])
				themeC = parseFloat(m[2])
				themeH = parseFloat(m[3])
			}
		}
	} catch (e) {}

	function updateThemeFromSliders() {
		setTheme("oklch(" + themeL + " " + themeC + " " + themeH + ")")
	}

	// Hue
	const hueLabel = document.createElement("label")
	hueLabel.textContent = "Hue"
	themePopover.appendChild(hueLabel)

	const hueRow = document.createElement("div")
	hueRow.className = "chat-theme-hue-row"
	const hueSlider = document.createElement("input")
	hueSlider.type = "range"
	hueSlider.min = "0"
	hueSlider.max = "360"
	hueSlider.value = String(themeH)
	const hueNumber = document.createElement("input")
	hueNumber.type = "number"
	hueNumber.min = "0"
	hueNumber.max = "360"
	hueNumber.value = String(themeH)

	hueSlider.addEventListener("input", () => {
		themeH = parseFloat(hueSlider.value)
		hueNumber.value = hueSlider.value
		updateThemeFromSliders()
	})
	hueNumber.addEventListener("input", () => {
		themeH = parseFloat(hueNumber.value)
		hueSlider.value = hueNumber.value
		updateThemeFromSliders()
	})
	hueRow.appendChild(hueSlider)
	hueRow.appendChild(hueNumber)
	themePopover.appendChild(hueRow)

	// Luminosity
	const lumLabel = document.createElement("label")
	lumLabel.textContent = "Luminosity"
	themePopover.appendChild(lumLabel)

	const lumRow = document.createElement("div")
	lumRow.className = "chat-theme-hue-row"
	const lumSlider = document.createElement("input")
	lumSlider.type = "range"
	lumSlider.min = "0"
	lumSlider.max = "100"
	lumSlider.value = String(Math.round(themeL * 100))
	const lumNumber = document.createElement("input")
	lumNumber.type = "number"
	lumNumber.min = "0"
	lumNumber.max = "100"
	lumNumber.value = String(Math.round(themeL * 100))

	lumSlider.addEventListener("input", () => {
		themeL = parseFloat(lumSlider.value) / 100
		lumNumber.value = lumSlider.value
		updateThemeFromSliders()
	})
	lumNumber.addEventListener("input", () => {
		themeL = parseFloat(lumNumber.value) / 100
		lumSlider.value = lumNumber.value
		updateThemeFromSliders()
	})
	lumRow.appendChild(lumSlider)
	lumRow.appendChild(lumNumber)
	themePopover.appendChild(lumRow)

	// Chroma
	const chromaLabel = document.createElement("label")
	chromaLabel.textContent = "Chroma"
	themePopover.appendChild(chromaLabel)

	const chromaRow = document.createElement("div")
	chromaRow.className = "chat-theme-hue-row"
	const chromaSlider = document.createElement("input")
	chromaSlider.type = "range"
	chromaSlider.min = "0"
	chromaSlider.max = "40"
	chromaSlider.value = String(Math.round(themeC * 100))
	const chromaNumber = document.createElement("input")
	chromaNumber.type = "number"
	chromaNumber.min = "0"
	chromaNumber.max = "40"
	chromaNumber.value = String(Math.round(themeC * 100))

	chromaSlider.addEventListener("input", () => {
		themeC = parseFloat(chromaSlider.value) / 100
		chromaNumber.value = chromaSlider.value
		updateThemeFromSliders()
	})
	chromaNumber.addEventListener("input", () => {
		themeC = parseFloat(chromaNumber.value) / 100
		chromaSlider.value = chromaNumber.value
		updateThemeFromSliders()
	})
	chromaRow.appendChild(chromaSlider)
	chromaRow.appendChild(chromaNumber)
	themePopover.appendChild(chromaRow)

	// Font size
	let themeFontSize = 15
	try {
		const saved = localStorage.getItem("chat-font-size")
		if (saved) themeFontSize = parseInt(saved, 10) || 15
	} catch (e) {}

	const fontSizeLabel = document.createElement("label")
	fontSizeLabel.textContent = "Font Size"
	themePopover.appendChild(fontSizeLabel)

	const fontSizeRow = document.createElement("div")
	fontSizeRow.className = "chat-theme-hue-row"
	const fontSizeSlider = document.createElement("input")
	fontSizeSlider.type = "range"
	fontSizeSlider.min = "10"
	fontSizeSlider.max = "24"
	fontSizeSlider.value = String(themeFontSize)
	const fontSizeNumber = document.createElement("input")
	fontSizeNumber.type = "number"
	fontSizeNumber.min = "10"
	fontSizeNumber.max = "24"
	fontSizeNumber.value = String(themeFontSize)

	function applyFontSize(size) {
		themeFontSize = size
		root.style.fontSize = size + "px"
		try {
			localStorage.setItem("chat-font-size", String(size))
		} catch (e) {}
	}

	fontSizeSlider.addEventListener("input", () => {
		const v = parseInt(fontSizeSlider.value, 10)
		fontSizeNumber.value = fontSizeSlider.value
		applyFontSize(v)
	})
	fontSizeNumber.addEventListener("input", () => {
		const v = parseInt(fontSizeNumber.value, 10)
		fontSizeSlider.value = fontSizeNumber.value
		applyFontSize(v)
	})
	fontSizeRow.appendChild(fontSizeSlider)
	fontSizeRow.appendChild(fontSizeNumber)
	themePopover.appendChild(fontSizeRow)

	// Apply saved font size
	if (themeFontSize !== 15) applyFontSize(themeFontSize)

	themeBtn.appendChild(themePopover)
	themeBtn.addEventListener("click", e => {
		e.stopPropagation()
		themePopover.classList.toggle("show")
	})

	function setTheme(color) {
		root.style.setProperty("--theme", color)

		// Parse L, C, H from the oklch color
		const m = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/)
		const L = m ? parseFloat(m[1]) : 0.55
		const C = m ? parseFloat(m[2]) : 0.18
		const H = m ? parseFloat(m[3]) : 270

		// Use L to smoothly interpolate between dark and light surfaces.
		// t=0 means fully dark surfaces, t=1 means fully light surfaces.
		// Smooth transition centred around L=0.5
		const t = Math.max(0, Math.min(1, (L - 0.3) / 0.4))

		// Surface lightness: lerp between dark (0.08-0.25) and light (0.88-0.97)
		const lerp = (a, b) => a + (b - a) * t
		// Surface chroma: scale down from theme chroma
		const sc = C * 0.3

		const set = (k, v) => root.style.setProperty(k, v)
		const oklch = (l, c, h) => `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h})`

		// Surface lightness lerps between dark and light extremes.
		// At L=1,C=0 the lerp should produce pure white (1.0).
		set("--bg-darkest", oklch(lerp(0.08, 1.0), sc, H))
		set("--bg-dark", oklch(lerp(0.11, 0.98), sc, H))
		set("--bg-mid", oklch(lerp(0.15, 0.95), sc, H))
		set("--bg-hover", oklch(lerp(0.18, 0.92), sc, H))
		set("--bg-input", oklch(lerp(0.13, 1.0), sc, H))
		set("--border", oklch(lerp(0.25, 0.85), sc * 1.3, H))

		// Text: always pure black or white for maximum contrast.
		// Secondary and muted are the same base color with reduced opacity.
		const bgL = lerp(0.11, 0.98)
		const lightBg = bgL > 0.55
		isLightBg = lightBg
		const textL = lightBg ? 0 : 1
		set("--text-primary", `oklch(${textL} 0 0)`)
		set("--text-secondary", `oklch(${textL} 0 0 / 0.6)`)
		set("--text-muted", `oklch(${textL} 0 0 / 0.4)`)

		// Link color: high-contrast, tinted toward theme hue
		// On dark backgrounds use a bright link, on light backgrounds use a darker one
		const linkL = lightBg ? 0.45 : 0.78
		const linkC = Math.max(C, 0.12)
		set("--link", oklch(linkL, linkC, H))

		// Accent: ensure it contrasts with the background.
		// When chroma is very low OR luminosity is very low, the raw theme color
		// would be invisible against the background.
		const darkBg = L < 0.32 // very dark background
		if (C < 0.04) {
			// Near-grayscale: use a contrasting neutral
			const accentL = darkBg || t < 0.5 ? 0.75 : 0.25
			set("--accent", oklch(accentL, 0, H))
			set("--accent-hover", oklch(accentL + (accentL > 0.5 ? -0.1 : 0.1), 0, H))
			set("--accent-fg", oklch(accentL > 0.5 ? 0.1 : 0.95, 0, 0))
		} else if (darkBg) {
			// Dark bg with chroma: lighten the accent so it's visible
			set("--accent", oklch(Math.max(L + 0.35, 0.55), C, H))
			set("--accent-hover", oklch(Math.max(L + 0.45, 0.65), C, H))
			set("--accent-fg", oklch(0.1, 0, 0))
		} else {
			set("--accent", color)
			set("--accent-hover", oklch(L + (t > 0.5 ? -0.1 : 0.1), C, H))
			set("--accent-fg", oklch(L > 0.6 ? 0.1 : 0.97, 0, 0))
		}
		set("--accent-soft", `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H} / 0.15)`)

		try {
			localStorage.setItem("chat-theme-color", color)
		} catch (e) {}
	}

	// Apply saved theme now that setTheme is defined
	try {
		const saved = localStorage.getItem("chat-theme-color")
		if (saved) setTheme(saved)
	} catch (e) {}

	// Close popover on outside click
	themePopover.addEventListener("click", e => {
		e.stopPropagation()
	})
	root.addEventListener("click", () => {
		themePopover.classList.remove("show")
	})

	// ---- Notification bell button with menu ----
	notifyBtn = document.createElement("button")
	notifyBtn.className = "chat-notify-btn"
	notifyBtn.style.marginLeft = "auto"

	const notifyMenu = document.createElement("div")
	notifyMenu.className = "chat-notify-menu"

	function renderNotifyMenu() {
		notifyMenu.innerHTML = ""

		const soundRow = document.createElement("div")
		soundRow.className = "chat-notify-menu-row"
		soundRow.textContent = "Sound"
		const soundToggle = document.createElement("button")
		soundToggle.className = "chat-notify-toggle" + (soundEnabled ? " on" : "")
		soundRow.appendChild(soundToggle)
		soundRow.addEventListener("click", ev => {
			ev.stopPropagation()
			toggleSound()
			renderNotifyMenu()
		})
		notifyMenu.appendChild(soundRow)

		const desktopRow = document.createElement("div")
		desktopRow.className = "chat-notify-menu-row"
		const perm =
			typeof Notification !== "undefined" ? Notification.permission : "denied"
		if (perm === "denied") {
			desktopRow.textContent = "Desktop notifications blocked"
			desktopRow.style.opacity = "0.5"
			desktopRow.style.cursor = "default"
		} else {
			desktopRow.textContent = "Desktop notifications"
			const desktopToggle = document.createElement("button")
			desktopToggle.className =
				"chat-notify-toggle" + (notificationsEnabled ? " on" : "")
			desktopRow.appendChild(desktopToggle)
			desktopRow.addEventListener("click", async ev => {
				ev.stopPropagation()
				await toggleNotifications()
				renderNotifyMenu()
			})
		}
		notifyMenu.appendChild(desktopRow)
	}

	notifyBtn.addEventListener("click", e => {
		e.preventDefault()
		e.stopPropagation()
		const showing = notifyMenu.classList.toggle("show")
		if (showing) renderNotifyMenu()
	})
	// Close menu on outside click
	document.addEventListener("click", e => {
		if (!notifyBtn.contains(e.target)) notifyMenu.classList.remove("show")
	})
	notifyBtn.appendChild(notifyMenu)
	updateNotifyBtn()

	// ---- Phone button (start call) ----
	const phoneBtn = document.createElement("button")
	phoneBtn.className = "chat-theme-btn"
	phoneBtn.title = "Start a call"
	phoneBtn.innerHTML = SVG_ICONS.phone
	phoneBtn.style.display = "none" // shown when call module is available
	phoneBtn.addEventListener("pointerdown", e => e.stopPropagation())
	phoneBtn.addEventListener("click", e => {
		e.stopPropagation()
		e.preventDefault()
		startCall()
	})

	// ---- Presence bar (with theme + notify + phone buttons) ----
	const presenceBar = document.createElement("div")
	presenceBar.className = "chat-presence-bar"
	presenceBar.title = "built " + BUILD_TIME
	const sidebarToggleBtn = document.createElement("button")
	sidebarToggleBtn.className = "chat-sidebar-toggle-btn"
	sidebarToggleBtn.title = "Toggle sidebar"
	sidebarToggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>'
	sidebarToggleBtn.addEventListener("click", e => {
		e.stopPropagation()
		if (sidebar.classList.contains("visible")) {
			sidebar.classList.toggle("collapsed")
		} else {
			sidebar.classList.add("visible")
			sidebar.classList.remove("collapsed")
		}
	})
	presenceBar.appendChild(notifyBtn)
	presenceBar.appendChild(themeBtn)
	presenceBar.appendChild(phoneBtn)
	presenceBar.appendChild(sidebarToggleBtn)

	// ---- Messages area ----
	const messagesArea = document.createElement("div")
	messagesArea.className = "chat-messages"

	// Hidden holding pen for patchwork-view elements during re-renders (keeps them in DOM to avoid teardown)
	const pvHoldingPen = document.createElement("div")
	pvHoldingPen.style.display = "none"
	messagesArea.appendChild(pvHoldingPen)

	// ---- Typing bar (at the bottom, above input) ----
	const typingBar = document.createElement("div")
	typingBar.className = "chat-typing-bar"

	// ---- Input wrapper ----
	const inputWrapper = document.createElement("div")
	inputWrapper.className = "chat-input-wrapper"

	// ---- Main area (flex column) wraps presence, messages, typing, input ----
	const chatMain = document.createElement("div")
	chatMain.className = "chat-main"
	chatMain.appendChild(presenceBar)
	chatMain.appendChild(messagesArea)
	chatMain.appendChild(typingBar)
	chatMain.appendChild(inputWrapper)
	root.appendChild(chatMain)

	// ---- Sidebar (hidden by default) ----
	const sidebar = document.createElement("div")
	sidebar.className = "chat-sidebar"

	// Resize handle
	const sidebarResize = document.createElement("div")
	sidebarResize.className = "chat-sidebar-resize"
	sidebar.appendChild(sidebarResize)

	// Header with collapse button
	const sidebarHeader = document.createElement("div")
	sidebarHeader.className = "chat-sidebar-header"
	const sidebarTitle = document.createElement("span")
	sidebarTitle.className = "chat-sidebar-header-title"
	sidebarTitle.textContent = "Sidebar"
	sidebarHeader.appendChild(sidebarTitle)
	const headerBtns = document.createElement("div")
	headerBtns.style.cssText = "display:flex;gap:2px;align-items:center;"
	const swapBtn = document.createElement("button")
	swapBtn.className = "chat-sidebar-collapse-btn"
	swapBtn.title = "Swap sidebar side"
	swapBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 16 3 12 7 8"/><polyline points="17 8 21 12 17 16"/><line x1="3" y1="12" x2="21" y2="12"/></svg>'
	swapBtn.addEventListener("click", e => {
		e.stopPropagation()
		root.classList.toggle("sidebar-left")
		localStorage.setItem("chat-sidebar-side", root.classList.contains("sidebar-left") ? "left" : "right")
	})
	headerBtns.appendChild(swapBtn)
	const collapseBtn = document.createElement("button")
	collapseBtn.className = "chat-sidebar-collapse-btn"
	collapseBtn.title = "Collapse sidebar"
	collapseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>'
	collapseBtn.addEventListener("click", e => {
		e.stopPropagation()
		sidebar.classList.add("collapsed")
		// sidebar toggle is in the presence bar now
	})
	headerBtns.appendChild(collapseBtn)
	sidebarHeader.appendChild(headerBtns)
	sidebar.appendChild(sidebarHeader)

	const sidebarPinned = document.createElement("div")
	sidebarPinned.className = "chat-sidebar-pinned"
	sidebar.appendChild(sidebarPinned)

	// Accept patchwork drops anywhere on the sidebar → pin the doc
	sidebar.addEventListener("dragover", e => {
		if (hasPatchworkDrop(e.dataTransfer)) e.preventDefault()
	})
	sidebar.addEventListener("drop", e => {
		const items = parsePatchworkDrop(e.dataTransfer)
		if (!items || !items.length) return
		e.preventDefault()
		e.stopPropagation()
		dragCounter = 0
		sidebar.classList.remove("drop-target")
		for (const item of items) {
			if (!item.url) continue
			pinDoc(item.url, item.toolId || "default", item.name || "doc")
		}
	})
	sidebar.addEventListener("dragleave", e => {
		if (!sidebar.contains(e.relatedTarget)) sidebar.classList.remove("drop-target")
	})

	const sidebarStatus = document.createElement("div")
	sidebarStatus.className = "chat-sidebar-status"
	sidebar.appendChild(sidebarStatus)

	root.appendChild(sidebar)

	// (sidebar toggle is now in the presence bar)

	// Sidebar resize drag
	let sidebarResizing = false
	sidebarResize.addEventListener("pointerdown", e => {
		e.preventDefault()
		sidebarResizing = true
		sidebarResize.classList.add("dragging")
		sidebarResize.setPointerCapture(e.pointerId)
		const onMove = ev => {
			if (!sidebarResizing) return
			const rootRect = root.getBoundingClientRect()
			const isLeft = root.classList.contains("sidebar-left")
			const newWidth = isLeft ? ev.clientX - rootRect.left : rootRect.right - ev.clientX
			const pct = Math.max(15, Math.min((newWidth / rootRect.width) * 100, 60))
			sidebar.style.width = pct + "%"
		}
		const onUp = () => {
			sidebarResizing = false
			sidebarResize.classList.remove("dragging")
			sidebarResize.removeEventListener("pointermove", onMove)
			sidebarResize.removeEventListener("pointerup", onUp)
		}
		sidebarResize.addEventListener("pointermove", onMove)
		sidebarResize.addEventListener("pointerup", onUp)
	})

	// Reply bar
	const replyBar = document.createElement("div")
	replyBar.className = "chat-reply-bar"
	const replyBarLabel = document.createElement("span")
	replyBarLabel.textContent = "Replying to "
	const replyBarText = document.createElement("span")
	replyBarText.className = "chat-reply-bar-text"
	const replyBarClose = document.createElement("button")
	replyBarClose.className = "chat-reply-bar-close"
	replyBarClose.innerHTML = SVG_ICONS.close
	replyBarClose.addEventListener("click", () => {
		replyToId = null
		replyBar.classList.remove("show")
	})
	replyBar.appendChild(replyBarLabel)
	replyBar.appendChild(replyBarText)
	replyBar.appendChild(replyBarClose)
	inputWrapper.appendChild(replyBar)

	// File preview bar
	const pastePreview = document.createElement("div")
	pastePreview.className = "chat-paste-preview"
	const pasteFilesContainer = document.createElement("div")
	pasteFilesContainer.style.cssText =
		"display:flex;gap:6px;flex-wrap:wrap;flex:1;align-items:center;"
	const pasteClose = document.createElement("button")
	pasteClose.className = "chat-paste-preview-close"
	pasteClose.innerHTML = SVG_ICONS.close
	pasteClose.addEventListener("click", clearPaste)
	pastePreview.appendChild(pasteFilesContainer)
	pastePreview.appendChild(pasteClose)
	inputWrapper.appendChild(pastePreview)

	// Input row
	const inputRow = document.createElement("div")
	inputRow.className = "chat-input-row"
	inputWrapper.appendChild(inputRow)

	// GIF camera toggle (left side of input bar)
	const gifToggle = document.createElement("button")
	gifToggle.className = "chat-gif-toggle"
	gifToggle.title = "Toggle GIF selfie mode"
	const gifIcon = document.createElement("span")
	gifIcon.className = "chat-gif-icon"
	gifIcon.innerHTML = SVG_ICONS.camera
	const gifVideo = document.createElement("video")
	gifVideo.autoplay = true
	gifVideo.muted = true
	gifVideo.playsInline = true
	gifToggle.appendChild(gifIcon)
	gifToggle.appendChild(gifVideo)
	inputRow.appendChild(gifToggle)

	const gifCanvas = document.createElement("canvas")
	gifCanvas.width = 160
	gifCanvas.height = 160
	gifCanvas.style.display = "none"
	inputRow.appendChild(gifCanvas)

	gifToggle.addEventListener("click", () => {
		gifModeEnabled = !gifModeEnabled
		gifToggle.classList.toggle("active", gifModeEnabled)
		if (gifModeEnabled) startGifCamera()
		else stopGifCamera()
	})

	// Text input with CodeMirror 6 (inline emoji rendering)
	const inputWrap = document.createElement("div")
	inputWrap.className = "chat-input-wrap"
	inputRow.appendChild(inputWrap)

	// EditorView will be set once CodeMirror loads; until then, null
	let cmView = null

	// Helper accessors that work once cmView is ready
	function getInputValue() {
		return cmView ? cmView.state.doc.toString() : ""
	}
	function setInputValue(text) {
		if (!cmView) return
		cmView.dispatch({
			changes: {from: 0, to: cmView.state.doc.length, insert: text},
		})
	}
	function getInputCursor() {
		return cmView ? cmView.state.selection.main.head : 0
	}
	function focusInput() {
		if (cmView) cmView.focus()
	}

	// Will be populated once CM loads; provides the decoration rebuild trigger
	let rebuildEmojiDecorations = null

	// Track placeholder text so render() can update it
	let placeholderText = "Message #Chat"
	let cmPlaceholderFn = null // set if CM's built-in placeholder is available
	let cmPlaceholderCompartment = null // Compartment for reconfiguring placeholder

	// Initialize CodeMirror once loaded
	cmPromise
		.then(cm => {
			const {
				EditorView,
				keymap,
				Decoration,
				WidgetType,
				ViewPlugin,
				EditorState,
			} = cm

			// Emoji/emoticon inline widget
			class EmojiWidget extends WidgetType {
				constructor(src, alt, isImage) {
					super()
					this.src = src
					this.alt = alt
					this.isImage = isImage
				}
				eq(other) {
					return this.src === other.src
				}
				toDOM() {
					if (this.isImage) {
						const img = document.createElement("img")
						img.className = "chat-emoticon-inline"
						img.src = this.src
						img.alt = this.alt
						img.style.cssText =
							"height:1.3em;vertical-align:middle;display:inline;"
						return img
					}
					const span = document.createElement("span")
					span.textContent = this.src
					span.title = this.alt
					return span
				}
				ignoreEvent() {
					return false
				}
			}

			// Formatting inline widget for bold/italic/etc preview
			class FormattingWidget extends WidgetType {
				constructor(html) {
					super()
					this.html = html
				}
				eq(other) {
					return this.html === other.html
				}
				toDOM() {
					const span = document.createElement("span")
					span.innerHTML = this.html
					return span
				}
				ignoreEvent() {
					return false
				}
			}

			// Build emoji decorations from the document
			// Returns { decos, ranges } where ranges is [{from, to}, ...] for overlap checks
			function buildEmojiDecos(view) {
				const decos = []
				const ranges = []
				const doc = view.state.doc
				const text = doc.toString()
				const re = /:([a-zA-Z0-9_+-]+):/g
				let m
				while ((m = re.exec(text)) !== null) {
					const name = m[1]
					let widget = null
					// Custom emoticon
					const allEm = getAllEmoticons()
					if (allEm[name]) {
						const swUrl = "/" + encodeURIComponent(allEm[name].url) + "/"
						widget = new EmojiWidget(swUrl, ":" + name + ":", true)
					} else {
						// Alias
						const aliasLower = name.toLowerCase()
						if (EMOJI_ALIASES[aliasLower]) {
							widget = new EmojiWidget(
								EMOJI_ALIASES[aliasLower],
								":" + name + ":",
								false
							)
						} else {
							// Full name lookup
							const lower = name.toLowerCase().replace(/[-_]/g, " ")
							const found = EMOJI_DATA.find(e => e.name.toLowerCase() === lower)
							if (found)
								widget = new EmojiWidget(found.emoji, ":" + name + ":", false)
						}
					}
					if (widget) {
						decos.push(
							Decoration.replace({widget}).range(m.index, m.index + m[0].length)
						)
						ranges.push({from: m.index, to: m.index + m[0].length})
					}
				}
				return {decos: Decoration.set(decos, true), ranges}
			}

			// Build formatting decorations (bold, italic, etc)
			function buildFormatDecos(view, emojiRanges) {
				const decos = []
				const text = view.state.doc.toString()
				// Match formatting patterns and apply marks
				const patterns = [
					{re: /\*([^*]+?)\*/g, cls: "cm-fmt-bold"},
					{re: /(?<![_\w])_([^_]+?)_(?![_.\w])/g, cls: "cm-fmt-italic"},
					{re: /__([^_]+?)__/g, cls: "cm-fmt-underline"},
					{re: /___([^_]+?)___/g, cls: "cm-fmt-underline-italic"},
					{re: /~~([^~]+?)~~/g, cls: "cm-fmt-strike"},
					{re: /`([^`]+)`/g, cls: "cm-fmt-code"},
					{re: /\|\|([^|]+?)\|\|/g, cls: "cm-fmt-spoiler"},
					{re: /%%([^%]+?)%%/g, cls: "cm-fmt-inverted"},
				]
				// Skip formatting matches that overlap with emoji replacements
				function overlapsEmoji(from, to) {
					for (const r of emojiRanges) {
						if (from < r.to && to > r.from) return true
					}
					return false
				}
				for (const {re, cls} of patterns) {
					let m
					while ((m = re.exec(text)) !== null) {
						if (!overlapsEmoji(m.index, m.index + m[0].length)) {
							decos.push(
								Decoration.mark({class: cls}).range(
									m.index,
									m.index + m[0].length
								)
							)
						}
					}
				}
				return Decoration.set(
					decos.sort((a, b) => a.from - b.from),
					true
				)
			}

			const emojiPlugin = ViewPlugin.fromClass(
				class {
					constructor(view) {
						const result = buildEmojiDecos(view)
						this.emojiDecos = result.decos
						this.emojiRanges = result.ranges
						this.formatDecos = buildFormatDecos(view, this.emojiRanges)
					}
					update(update) {
						if (
							update.docChanged ||
							update.viewportChanged ||
							this._forceRebuild
						) {
							const result = buildEmojiDecos(update.view)
							this.emojiDecos = result.decos
							this.emojiRanges = result.ranges
							this.formatDecos = buildFormatDecos(update.view, this.emojiRanges)
							this._forceRebuild = false
						}
					}
					rebuild() {
						this._forceRebuild = true
					}
				},
				{
					decorations: v => v.emojiDecos,
					provide: plugin => [
						EditorView.decorations.of(view => {
							const inst = view.plugin(plugin)
							return inst ? inst.formatDecos : Decoration.none
						}),
						EditorView.atomicRanges.of(view => {
							const inst = view.plugin(plugin)
							return inst ? inst.emojiDecos : Decoration.none
						}),
					],
				}
			)

			// Placeholder: use CM's built-in if available, otherwise manual
			const cmPlaceholder = cm.placeholder
			const placeholderExt = cmPlaceholder
				? EditorState.transactionExtender.of(() => null) // dummy; we'll use compartment below
				: ViewPlugin.fromClass(
						class {
							constructor(view) {
								this.el = null
								this._sync(view)
							}
							update(update) {
								this._sync(update.view)
							}
							_sync(view) {
								const empty = view.state.doc.length === 0
								if (empty && !this.el) {
									this.el = document.createElement("span")
									this.el.className = "cm-placeholder"
									this.el.textContent = placeholderText
									this.el.style.cssText =
										"pointer-events:none;position:absolute;top:8px;left:12px;color:var(--text-muted);"
									view.dom.style.position = "relative"
									view.dom.appendChild(this.el)
								} else if (!empty && this.el) {
									this.el.remove()
									this.el = null
								} else if (this.el) {
									this.el.textContent = placeholderText
								}
							}
							destroy() {
								if (this.el) this.el.remove()
							}
						}
					)

			// Compartment for reconfigurable placeholder (if using built-in)
			const Compartment = cm.Compartment
			if (cmPlaceholder && Compartment) {
				cmPlaceholderFn = cmPlaceholder
				cmPlaceholderCompartment = new Compartment()
			}

			// Create the editor
			cmView = new EditorView({
				parent: inputWrap,
				state: EditorState.create({
					doc: "",
					extensions: [
						cmPlaceholderFn && cmPlaceholderCompartment
							? cmPlaceholderCompartment.of(cmPlaceholderFn(placeholderText))
							: placeholderExt,
						emojiPlugin,
						keymap.of([
							{
								key: "Enter",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										completeAutocomplete(acIndex >= 0 ? acIndex : 0)
									} else {
										sendMessage()
									}
									return true
								},
							},
							{
								key: "Shift-Enter",
								run: view => {
									view.dispatch(view.state.replaceSelection("\n"))
									return true
								},
							},
							{
								key: "Escape",
								run: () => {
									if (autocomplete.classList.contains("show")) {
										autocomplete.classList.remove("show")
										acItems = []
										acIndex = -1
										return true
									}
									return false
								},
							},
							{
								key: "ArrowDown",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										acIndex = (acIndex + 1) % acItems.length
										updateAcHighlight()
										return true
									}
									return false
								},
							},
							{
								key: "ArrowUp",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										acIndex = (acIndex - 1 + acItems.length) % acItems.length
										updateAcHighlight()
										return true
									}
									return false
								},
							},
							{
								key: "Ctrl-n",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										acIndex = (acIndex + 1) % acItems.length
										updateAcHighlight()
										return true
									}
									return false
								},
							},
							{
								key: "Ctrl-p",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										acIndex = (acIndex - 1 + acItems.length) % acItems.length
										updateAcHighlight()
										return true
									}
									return false
								},
							},
							{
								key: "Tab",
								run: () => {
									if (
										autocomplete.classList.contains("show") &&
										acItems.length > 0
									) {
										completeAutocomplete(acIndex >= 0 ? acIndex : 0)
										return true
									}
									return false
								},
							},
						]),
						EditorView.updateListener.of(update => {
							if (update.docChanged) {
								renderAutocomplete()
								broadcastPresence(true)
								scheduleDraftSync()
							}
						}),
						EditorView.domEventHandlers({
							paste: (e, view) => {
								const items = e.clipboardData?.items
								if (!items) return false
								let handled = false
								for (const item of items) {
									const file = item.getAsFile()
									if (file) {
										if (!handled) {
											e.preventDefault()
											handled = true
										}
										addPendingFile(
											file,
											file.name ||
												item.type.split("/")[0] +
													"-" +
													Date.now() +
													"." +
													(item.type.split("/")[1] || "bin"),
											file.type || item.type || "application/octet-stream"
										)
									}
								}
								return handled
							},
						}),
						EditorView.theme({
							"&": {
								fontSize: "inherit",
								lineHeight: "1.4",
								fontFamily: "inherit",
							},
							".cm-content": {
								padding: "8px 12px",
								minHeight: "1.4em",
								maxHeight: "120px",
								overflowY: "auto",
								caretColor: "var(--text-primary)",
							},
							"&.cm-focused .cm-content": {
								outline: "none",
							},
							"&.cm-focused": {
								outline: "none",
							},
							".cm-scroller": {
								overflow: "auto",
								fontFamily: "inherit",
							},
							".cm-line": {
								padding: "0",
								color: "var(--text-primary)",
							},
							".cm-placeholder": {
								color: "var(--text-muted)",
							},
							".cm-cursor": {
								borderLeftColor: "var(--text-primary)",
							},
							// Formatting classes
							".cm-fmt-bold": {fontWeight: "bold"},
							".cm-fmt-italic": {fontStyle: "italic"},
							".cm-fmt-underline": {textDecoration: "underline"},
							".cm-fmt-underline-italic": {
								textDecoration: "underline",
								fontStyle: "italic",
							},
							".cm-fmt-strike": {textDecoration: "line-through"},
							".cm-fmt-code": {
								background: "var(--bg-hover)",
								padding: "1px 4px",
								borderRadius: "3px",
								fontFamily: "ui-monospace,monospace",
								fontSize: "0.9em",
							},
							".cm-fmt-spoiler": {background: "var(--text-muted)"},
							".cm-fmt-inverted": {
								background: "var(--text-primary)",
								color: "var(--bg-dark)",
								padding: "0 3px",
								borderRadius: "3px",
							},
						}),
					],
				}),
			})

			// Expose rebuild trigger for when emoticons change
			rebuildEmojiDecorations = () => {
				if (!cmView) return
				const plugin = cmView.plugin(emojiPlugin)
				if (plugin) {
					plugin._forceRebuild = true
					// Force a viewport update to trigger decoration rebuild
					cmView.dispatch()
				}
			}

			// Set font if already known
			if (myFont) {
				cmView.dom.style.fontFamily = myFont
			}
		})
		.catch(e => {
			console.warn(
				"[Chat] CodeMirror load failed, falling back to textarea:",
				e
			)
			// Fallback: create a plain textarea
			const input = document.createElement("textarea")
			input.className = "chat-input"
			input.rows = 1
			input.placeholder = "Message #Chat"
			inputWrap.appendChild(input)
			// Wire up basic accessors matching real CM API shape
			cmView = {
				get state() {
					return {
						doc: {
							toString: () => input.value,
							get length() {
								return input.value.length
							},
						},
						selection: {
							main: {
								get head() {
									return input.selectionStart
								},
							},
						},
					}
				},
				dispatch: tr => {
					if (!tr) return
					if (tr.changes) {
						input.value = tr.changes.insert ?? ""
					}
					if (tr.selection) {
						input.selectionStart = input.selectionEnd = tr.selection.anchor ?? 0
					}
				},
				focus: () => input.focus(),
				dom: input,
				plugin: () => null,
				_fallbackInput: input,
			}
			input.addEventListener("input", () => {
				renderAutocomplete()
				broadcastPresence(true)
				scheduleDraftSync()
			})
			input.addEventListener("keydown", e => {
				if (autocomplete.classList.contains("show") && acItems.length > 0) {
					if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
						e.preventDefault()
						acIndex = (acIndex + 1) % acItems.length
						updateAcHighlight()
						return
					}
					if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
						e.preventDefault()
						acIndex = (acIndex - 1 + acItems.length) % acItems.length
						updateAcHighlight()
						return
					}
					if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
						e.preventDefault()
						completeAutocomplete(acIndex >= 0 ? acIndex : 0)
						return
					}
					if (e.key === "Escape") {
						e.preventDefault()
						autocomplete.classList.remove("show")
						acItems = []
						acIndex = -1
						return
					}
				}
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault()
					sendMessage()
				}
			})
			input.addEventListener("paste", e => {
				const items = e.clipboardData?.items
				if (!items) return
				let handled = false
				for (const item of items) {
					const file = item.getAsFile()
					if (file) {
						if (!handled) {
							e.preventDefault()
							handled = true
						}
						addPendingFile(
							file,
							file.name ||
								item.type.split("/")[0] +
									"-" +
									Date.now() +
									"." +
									(item.type.split("/")[1] || "bin"),
							file.type || item.type || "application/octet-stream"
						)
					}
				}
			})
		})

	// Mic button
	const micBtn = document.createElement("button")
	micBtn.className = "chat-input-btn"
	micBtn.innerHTML = SVG_ICONS.mic
	micBtn.title = "Record voice note"
	inputRow.appendChild(micBtn)

	// Send button
	const sendBtn = document.createElement("button")
	sendBtn.className = "chat-input-btn"
	sendBtn.innerHTML = SVG_ICONS.send
	sendBtn.title = "Send"
	inputRow.appendChild(sendBtn)

	// ---- Emoji picker overlay ----
	const emojiOverlay = document.createElement("div")
	emojiOverlay.className = "chat-emoji-picker-overlay"
	const emojiPicker = document.createElement("div")
	emojiPicker.className = "chat-emoji-picker"
	emojiOverlay.appendChild(emojiPicker)
	root.appendChild(emojiOverlay)

	// Lightbox for full-size image/video viewing
	const lightbox = document.createElement("div")
	lightbox.className = "chat-lightbox"
	lightbox.addEventListener("click", e => {
		if (e.target === lightbox) {
			lightbox.classList.remove("show")
			lightbox.innerHTML = ""
		}
	})
	root.appendChild(lightbox)

	function openLightbox(src, type) {
		lightbox.innerHTML = ""
		if (type === "video") {
			const vid = document.createElement("video")
			vid.src = src
			vid.controls = true
			vid.autoplay = true
			lightbox.appendChild(vid)
		} else {
			const img = document.createElement("img")
			img.src = src
			lightbox.appendChild(img)
		}
		lightbox.classList.add("show")
	}

	// ---- Emoticon/reaction tooltip ----
	const emTooltip = document.createElement("div")
	emTooltip.className = "chat-emoticon-tooltip"
	root.appendChild(emTooltip)
	let emTooltipTimer = null

	function showEmoticonTooltip(
		anchorEl,
		{emoji, emoticonName, emoticonUrl, blobUrl, names, isOwned}
	) {
		clearTimeout(emTooltipTimer)
		emTooltip.innerHTML = ""

		// Preview (big)
		const previewEl = document.createElement("div")
		previewEl.className = "chat-emoticon-tooltip-preview"
		if (blobUrl) {
			const img = document.createElement("img")
			img.src = blobUrl
			previewEl.appendChild(img)
		} else {
			previewEl.textContent = emoji || ""
		}
		emTooltip.appendChild(previewEl)

		// Name
		const nameEl = document.createElement("div")
		nameEl.className = "chat-emoticon-tooltip-name"
		nameEl.textContent = emoticonName ? ":" + emoticonName + ":" : emoji || ""
		emTooltip.appendChild(nameEl)

		// Names of people who reacted
		if (names && names.length > 0) {
			const namesEl = document.createElement("div")
			namesEl.className = "chat-emoticon-tooltip-names"
			namesEl.textContent = names.join(", ")
			emTooltip.appendChild(namesEl)
		}

		// Adopt button for non-owned custom emoticons
		if (emoticonName && emoticonUrl && !isOwned) {
			const adoptBtn = document.createElement("button")
			adoptBtn.className = "chat-emoticon-tooltip-adopt"
			adoptBtn.textContent = "Adopt :" + emoticonName + ":"
			adoptBtn.addEventListener("click", ev => {
				ev.stopPropagation()
				adoptEmoticon(emoticonName, emoticonUrl)
				hideEmoticonTooltip()
			})
			emTooltip.appendChild(adoptBtn)
		}

		// Position below the hovered element, relative to root
		const rect = anchorEl.getBoundingClientRect()
		const rootRect = root.getBoundingClientRect()
		emTooltip.classList.add("show")
		const tw = emTooltip.offsetWidth,
			th = emTooltip.offsetHeight
		let left = rect.left - rootRect.left + rect.width / 2 - tw / 2
		let top = rect.bottom - rootRect.top + 4
		if (rect.bottom + th + 4 > window.innerHeight)
			top = rect.top - rootRect.top - th - 4
		if (left < 4) left = 4
		if (left + tw > rootRect.width - 4) left = rootRect.width - tw - 4
		emTooltip.style.left = left + "px"
		emTooltip.style.top = top + "px"
	}

	function hideEmoticonTooltip() {
		clearTimeout(emTooltipTimer)
		emTooltip.classList.remove("show")
	}

	// Delegate hover/touch on inline emoticons in messages
	messagesArea.addEventListener(
		"pointerenter",
		e => {
			const emImg = e.target.closest(".chat-emoticon-inline")
			if (emImg) {
				const name = (emImg.alt || "").replace(/^:|:$/g, "")
				const allEm = getAllEmoticons()
				const info = allEm[name]
				showEmoticonTooltip(emImg, {
					emoticonName: name,
					blobUrl: emImg.src,
					emoticonUrl: info?.url,
					isOwned: info?.mine ?? false,
				})
				return
			}
			const reaction = e.target.closest(".chat-reaction")
			if (reaction) {
				// Parse reaction data from the element
				const reactionImg = reaction.querySelector(".chat-emoticon-inline")
				const emoticonMatch = reactionImg
					? (reactionImg.alt || "").match(/^:([a-zA-Z0-9_-]+):$/)
					: null
				const emojiText = reactionImg
					? null
					: reaction.firstChild?.textContent?.trim()
				const names = (reaction.title || "").split(", ").filter(Boolean)
				const allEm = getAllEmoticons()
				const emName = emoticonMatch?.[1]
				const info = emName ? allEm[emName] : null
				showEmoticonTooltip(reaction, {
					emoji: emojiText,
					emoticonName: emName,
					blobUrl: reactionImg?.src,
					emoticonUrl: info?.url,
					isOwned: info?.mine ?? false,
					names,
				})
			}
		},
		true
	)

	messagesArea.addEventListener(
		"pointerleave",
		e => {
			const emImg = e.target.closest(".chat-emoticon-inline")
			const reaction = e.target.closest(".chat-reaction")
			if (emImg || reaction) {
				emTooltipTimer = setTimeout(hideEmoticonTooltip, 200)
			}
		},
		true
	)

	// Keep tooltip alive when hovering over it (for adopt button)
	emTooltip.addEventListener("pointerenter", () => clearTimeout(emTooltipTimer))
	emTooltip.addEventListener("pointerleave", () => {
		emTooltipTimer = setTimeout(hideEmoticonTooltip, 200)
	})

	let emojiPickerTarget = null

	function openEmojiPicker(msgIndex, anchorEl) {
		// Get existing reactions for this message so we can highlight them
		const doc = handle.doc()
		const entry = doc?.messages?.[msgIndex]
		let myReactions = new Set()
		if (entry) {
			let reactions
			if (entry.ref && entry.url) {
				const cached = msgDocCache.get(entry.url)
				reactions = cached?.data?.reactions
			} else {
				reactions = entry.reactions
			}
			if (reactions) {
				for (const [emoji, names] of Object.entries(reactions)) {
					if (names && names.includes(myName)) myReactions.add(emoji)
				}
			}
		}
		emojiPickerTarget = {msgIndex, myReactions}
		renderEmojiPicker()
		emojiOverlay.classList.add("show")

		const rect = anchorEl.getBoundingClientRect()
		const rootRect = root.getBoundingClientRect()
		const pickerWidth = 280
		const pickerHeight = Math.min(emojiPicker.scrollHeight, 320)

		// Horizontal: center on anchor, clamp within root
		let left = rect.left + rect.width / 2 - rootRect.left - pickerWidth / 2
		if (left + pickerWidth > rootRect.width - 8)
			left = rootRect.width - pickerWidth - 8
		if (left < 8) left = 8

		// Vertical: prefer above anchor, fall back to below if not enough space
		const spaceAbove = rect.top - rootRect.top
		const spaceBelow = rootRect.bottom - rect.bottom
		if (spaceAbove >= pickerHeight + 4) {
			emojiPicker.style.bottom = rootRect.bottom - rect.top + 4 + "px"
			emojiPicker.style.top = "auto"
		} else {
			emojiPicker.style.top = rect.bottom - rootRect.top + 4 + "px"
			emojiPicker.style.bottom = "auto"
		}
		emojiPicker.style.left = left + "px"
		emojiPicker.style.right = "auto"
	}

	function renderEmojiPicker(filter) {
		emojiPicker.innerHTML = ""
		const search = document.createElement("input")
		search.className = "chat-emoji-picker-search"
		search.placeholder = "Search emoji by name..."
		search.value = filter || ""
		search.addEventListener("input", () => renderEmojiPicker(search.value))
		emojiPicker.appendChild(search)
		setTimeout(() => search.focus(), 0)

		// Single scroll container for all content
		const scrollWrap = document.createElement("div")
		scrollWrap.className = "chat-emoji-picker-scroll"

		// Custom emoticons section
		const allEm = getAllEmoticons()
		const emNames = Object.keys(allEm)
		const q = (filter || "").toLowerCase()
		const filteredEm = q
			? emNames.filter(n => n.toLowerCase().includes(q))
			: emNames

		if (filteredEm.length > 0 || !filter) {
			const section = document.createElement("div")
			section.className = "chat-emoticon-section"
			const header = document.createElement("div")
			header.className = "chat-emoticon-section-header"
			header.appendChild(document.createTextNode("Emoticons"))
			const addBtn = document.createElement("button")
			addBtn.className = "chat-emoticon-add-btn"
			addBtn.textContent = "+ Add"
			addBtn.addEventListener("click", ev => {
				ev.stopPropagation()
				showEmoticonAddDialog()
			})
			header.appendChild(addBtn)
			section.appendChild(header)

			const emGrid = document.createElement("div")
			emGrid.className = "chat-emoticon-grid"
			for (const name of filteredEm) {
				const info = allEm[name]
				const emojiKey = ":" + name + ":"
				const btn = document.createElement("button")
				btn.title = emojiKey + (info.mine ? "" : " (by " + info.owner + ")")
				if (emojiPickerTarget?.myReactions?.has(emojiKey))
					btn.classList.add("chat-emoji-active")
				const img = document.createElement("img")
				img.src = "/" + encodeURIComponent(info.url) + "/"
				btn.appendChild(img)
				btn.addEventListener("click", ev => {
					ev.stopPropagation()
					if (emojiPickerTarget)
						toggleReaction(emojiPickerTarget.msgIndex, emojiKey)
					closeEmojiPicker()
				})
				if (info.mine) {
					// Remove button for owned emoticons
					const removeBtn = document.createElement("button")
					removeBtn.className = "chat-emoticon-remove"
					removeBtn.textContent = "×"
					removeBtn.title = "Remove this emoticon"
					removeBtn.addEventListener("click", ev => {
						ev.stopPropagation()
						if (removeBtn.classList.contains("confirm")) {
							removeEmoticon(name)
							renderEmojiPicker(filter)
						} else {
							// First click: enter confirm state
							removeBtn.classList.add("confirm")
							removeBtn.textContent = "?"
							removeBtn.title = "Click again to delete"
							// Reset after 3s if not confirmed
							setTimeout(() => {
								if (
									removeBtn.isConnected &&
									removeBtn.classList.contains("confirm")
								) {
									removeBtn.classList.remove("confirm")
									removeBtn.textContent = "×"
									removeBtn.title = "Remove this emoticon"
								}
							}, 3000)
						}
					})
					btn.appendChild(removeBtn)
				} else {
					// Adopt button for non-owned emoticons
					const adoptBtn = document.createElement("button")
					adoptBtn.className = "chat-emoticon-adopt"
					adoptBtn.textContent = "+"
					adoptBtn.title = "Adopt this emoticon"
					adoptBtn.addEventListener("click", ev => {
						ev.stopPropagation()
						adoptEmoticon(name, info.url)
						renderEmojiPicker(filter)
					})
					btn.appendChild(adoptBtn)
				}
				emGrid.appendChild(btn)
			}
			section.appendChild(emGrid)
			scrollWrap.appendChild(section)
		}

		const grid = document.createElement("div")
		grid.className = "chat-emoji-grid"
		scrollWrap.appendChild(grid)
		emojiPicker.appendChild(scrollWrap)

		let emojis
		if (EMOJI_LOADED) {
			emojis = q
				? EMOJI_DATA.filter(e => e.name.includes(q) || e.emoji === q)
				: EMOJI_DATA
		} else {
			emojis = (
				filter
					? FALLBACK_EMOJIS.filter(e => e.includes(filter))
					: FALLBACK_EMOJIS
			).map(e => ({emoji: e, name: ""}))
		}

		for (const entry of emojis) {
			const btn = document.createElement("button")
			btn.textContent = entry.emoji
			if (entry.name) btn.title = entry.name
			if (emojiPickerTarget?.myReactions?.has(entry.emoji))
				btn.classList.add("chat-emoji-active")
			btn.addEventListener("click", ev => {
				ev.stopPropagation()
				if (emojiPickerTarget)
					toggleReaction(emojiPickerTarget.msgIndex, entry.emoji)
				closeEmojiPicker()
			})
			grid.appendChild(btn)
		}
	}

	// ---- Emoticon add dialog ----
	function nameFromFilename(filename) {
		return (
			(filename || "")
				.replace(/\.[^.]+$/, "")
				.replace(/[^a-zA-Z0-9_-]/g, "_")
				.replace(/^_+|_+$/g, "")
				.toLowerCase() || ""
		)
	}

	function showEmoticonAddDialog() {
		emojiPicker.innerHTML = ""
		const dialog = document.createElement("div")
		dialog.className = "chat-emoticon-dialog"

		// Hidden file input (multiple)
		const fileInput = document.createElement("input")
		fileInput.type = "file"
		fileInput.accept = "image/*"
		fileInput.multiple = true
		fileInput.style.display = "none"
		dialog.appendChild(fileInput)

		// State: list of { file, name, aliases }
		let entries = []
		let currentIdx = 0

		// Preview — clicking it opens the file browser
		const preview = document.createElement("div")
		preview.className = "chat-emoticon-dialog-preview"
		preview.textContent = "?"
		preview.title = "Click to browse for images"
		preview.style.cursor = "pointer"
		preview.addEventListener("click", ev => {
			ev.stopPropagation()
			fileInput.click()
		})
		dialog.appendChild(preview)

		// Name input
		const nameInput = document.createElement("input")
		nameInput.type = "text"
		nameInput.placeholder = "Emoticon name (e.g. catjam)"
		nameInput.pattern = "[a-zA-Z0-9_-]+"
		dialog.appendChild(nameInput)

		// Counter for multi-file
		const counter = document.createElement("div")
		counter.className = "chat-emoticon-dialog-counter"
		counter.style.display = "none"
		dialog.appendChild(counter)

		function showEntry(idx) {
			currentIdx = idx
			const entry = entries[idx]
			if (!entry) return
			preview.innerHTML = ""
			const previewImg = document.createElement("img")
			previewImg.src = URL.createObjectURL(entry.file)
			preview.appendChild(previewImg)
			nameInput.value = entry.name
			if (entries.length > 1) {
				counter.style.display = "block"
				counter.textContent = idx + 1 + " / " + entries.length
			}
			updateSaveBtn()
		}

		fileInput.addEventListener("change", () => {
			const files = Array.from(fileInput.files || [])
			if (!files.length) return
			entries = files.map(f => ({file: f, name: nameFromFilename(f.name)}))
			showEntry(0)
			updateSaveBtn()
			nameInput.focus()
			nameInput.select()
		})

		// Sync edits back to entry
		nameInput.addEventListener("input", () => {
			if (entries[currentIdx]) entries[currentIdx].name = nameInput.value
			updateSaveBtn()
		})
		const btns = document.createElement("div")
		btns.className = "chat-emoticon-dialog-btns"

		const cancelBtn = document.createElement("button")
		cancelBtn.className = "cancel-btn"
		cancelBtn.textContent = "Cancel"
		cancelBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			renderEmojiPicker()
		})

		// Nav buttons for multi-file
		const prevBtn = document.createElement("button")
		prevBtn.className = "cancel-btn"
		prevBtn.textContent = "‹ Prev"
		prevBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			if (currentIdx > 0) showEntry(currentIdx - 1)
		})
		const nextBtn = document.createElement("button")
		nextBtn.className = "cancel-btn"
		nextBtn.textContent = "Next ›"
		nextBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			if (currentIdx < entries.length - 1) showEntry(currentIdx + 1)
		})

		const saveBtn = document.createElement("button")
		saveBtn.className = "save-btn"
		saveBtn.textContent = "Add"
		saveBtn.disabled = true

		function updateSaveBtn() {
			const allValid =
				entries.length > 0 &&
				entries.every(e => e.name.match(/^[a-zA-Z0-9_-]+$/))
			saveBtn.disabled = !allValid
			saveBtn.textContent = entries.length > 1 ? "Add " + entries.length : "Add"
			prevBtn.style.display = entries.length > 1 ? "" : "none"
			nextBtn.style.display = entries.length > 1 ? "" : "none"
		}
		updateSaveBtn()

		saveBtn.addEventListener("click", async ev => {
			ev.stopPropagation()
			if (entries.length === 0) return
			saveBtn.disabled = true
			const total = entries.length
			try {
				for (let i = 0; i < total; i++) {
					saveBtn.textContent = total > 1 ? i + 1 + "/" + total + "…" : "…"
					const e = entries[i]
					await addEmoticon(e.name, e.file)
				}
				renderEmojiPicker()
			} catch (e) {
				console.error("[Chat] add emoticon:", e)
				saveBtn.textContent = "Error"
			}
		})

		btns.appendChild(cancelBtn)
		btns.appendChild(prevBtn)
		btns.appendChild(nextBtn)
		btns.appendChild(saveBtn)
		dialog.appendChild(btns)

		emojiPicker.appendChild(dialog)
		// Open file picker immediately
		fileInput.click()
	}

	// ---- Font add dialog ----
	function showFontAddDialog() {
		emojiPicker.innerHTML = ""
		emojiPickerTarget = null

		const dialog = document.createElement("div")
		dialog.className = "chat-font-dialog"

		const title = document.createElement("div")
		title.style.cssText =
			"font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px;"
		title.textContent = "Add Font"
		dialog.appendChild(title)

		// Show existing fonts
		const existingFonts = Object.keys(myFonts)
		if (existingFonts.length > 0) {
			const listLabel = document.createElement("div")
			listLabel.style.cssText =
				"font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;"
			listLabel.textContent = "Your fonts"
			dialog.appendChild(listLabel)

			const list = document.createElement("div")
			list.className = "chat-font-list"
			for (const fname of existingFonts) {
				const item = document.createElement("div")
				item.className = "chat-font-list-item"
				const nameSpan = document.createElement("span")
				nameSpan.className = "font-name"
				nameSpan.textContent = fname
				ensureFontLoaded(fname).then(() => {
					nameSpan.style.fontFamily = fname
				})
				item.appendChild(nameSpan)

				const removeBtn = document.createElement("button")
				removeBtn.className = "chat-font-list-remove"
				removeBtn.textContent = "×"
				removeBtn.title = "Remove font"
				removeBtn.addEventListener("click", ev => {
					ev.stopPropagation()
					if (removeBtn.classList.contains("confirm")) {
						removeFont(fname)
						showFontAddDialog() // re-render
					} else {
						removeBtn.classList.add("confirm")
						removeBtn.textContent = "?"
						removeBtn.title = "Click again to delete"
						setTimeout(() => {
							if (
								removeBtn.isConnected &&
								removeBtn.classList.contains("confirm")
							) {
								removeBtn.classList.remove("confirm")
								removeBtn.textContent = "×"
								removeBtn.title = "Remove font"
							}
						}, 3000)
					}
				})
				item.appendChild(removeBtn)
				list.appendChild(item)
			}
			dialog.appendChild(list)
		}

		// Separator
		const sep = document.createElement("div")
		sep.style.cssText = "border-top:1px solid var(--border);margin:2px 0;"
		dialog.appendChild(sep)

		// Hidden file input
		const fileInput = document.createElement("input")
		fileInput.type = "file"
		fileInput.accept = ".woff2,.woff,.ttf,.otf,font/*"
		fileInput.style.display = "none"
		dialog.appendChild(fileInput)

		let selectedFile = null

		// File button
		const fileBtn = document.createElement("button")
		fileBtn.className = "chat-font-dialog-filebtn"
		fileBtn.textContent = "Choose .woff2 file…"
		fileBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			fileInput.click()
		})
		dialog.appendChild(fileBtn)

		// Name input
		const nameInput = document.createElement("input")
		nameInput.type = "text"
		nameInput.placeholder = "Font name (e.g. MyFont)"
		nameInput.pattern = "[a-zA-Z0-9 _-]+"
		dialog.appendChild(nameInput)

		// Preview
		const preview = document.createElement("div")
		preview.className = "chat-font-dialog-preview"
		preview.textContent = ""
		preview.style.display = "none"
		dialog.appendChild(preview)

		function updateSaveBtn() {
			const valid =
				selectedFile && nameInput.value.match(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/)
			saveBtn.disabled = !valid
		}

		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0]
			if (!file) return
			selectedFile = file
			fileBtn.textContent = file.name

			// Auto-fill name from filename if empty
			if (!nameInput.value) {
				nameInput.value = file.name
					.replace(/\.[^.]+$/, "")
					.replace(/[^a-zA-Z0-9 _-]/g, "")
					.trim()
			}

			// Show live preview with the font
			const previewName = "__font_preview_" + Date.now()
			const blobUrl = URL.createObjectURL(file)
			const face = new FontFace(previewName, "url(" + blobUrl + ")")
			face
				.load()
				.then(() => {
					document.fonts.add(face)
					preview.style.fontFamily = previewName
					preview.textContent = "The quick brown fox jumps over the lazy dog"
					preview.style.display = ""
				})
				.catch(() => {
					preview.style.fontFamily = ""
					preview.textContent = "Could not load font"
					preview.style.display = ""
				})

			updateSaveBtn()
			nameInput.focus()
			nameInput.select()
		})

		nameInput.addEventListener("input", updateSaveBtn)

		// Buttons
		const btns = document.createElement("div")
		btns.className = "chat-font-dialog-btns"

		const cancelBtn = document.createElement("button")
		cancelBtn.className = "cancel-btn"
		cancelBtn.textContent = "Cancel"
		cancelBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			closeEmojiPicker()
		})

		const saveBtn = document.createElement("button")
		saveBtn.className = "save-btn"
		saveBtn.textContent = "Add"
		saveBtn.disabled = true

		saveBtn.addEventListener("click", async ev => {
			ev.stopPropagation()
			if (!selectedFile || saveBtn.disabled) return
			saveBtn.disabled = true
			saveBtn.textContent = "…"
			try {
				await addFont(nameInput.value.trim(), selectedFile)
				closeEmojiPicker()
			} catch (e) {
				console.error("[Chat] add font:", e)
				saveBtn.textContent = "Error"
				setTimeout(() => {
					saveBtn.textContent = "Add"
					saveBtn.disabled = false
				}, 2000)
			}
		})

		btns.appendChild(cancelBtn)
		btns.appendChild(saveBtn)
		dialog.appendChild(btns)

		emojiPicker.appendChild(dialog)

		// Position the picker near the input area
		emojiPicker.style.bottom = "60px"
		emojiPicker.style.top = "auto"
		emojiPicker.style.right = "16px"
		emojiPicker.style.left = "auto"
		emojiOverlay.classList.add("show")
	}

	function closeEmojiPicker() {
		emojiOverlay.classList.remove("show")
		emojiPickerTarget = null
	}
	emojiOverlay.addEventListener("click", e => {
		if (e.target === emojiOverlay) closeEmojiPicker()
	})

	// ---- Slash command definitions ----
	const SLASH_COMMANDS = [
		{
			cmd: "/me",
			usage: "/me <message>",
			desc: 'Send an action message (e.g. "/me waves hello")',
		},
		{
			cmd: "/slap",
			usage: "/slap <name>",
			desc: "Slap someone with a large trout",
		},
		{
			cmd: "/font",
			usage: "/font <name> <message>",
			desc: 'Send a message in a specific font (e.g. "/font Georgia hello")',
		},
		{
			cmd: "/colour",
			usage: "/colour <colour> <message>",
			desc: "Send a message in a specific colour",
		},
		{
			cmd: "/face",
			usage: "/face <color> <font> <message>",
			desc: "Send with custom colour and font",
		},
		{
			cmd: "/addfont",
			usage: "/addfont",
			desc: "Upload a .woff2 font file to use in chat",
		},
		{
			cmd: "/computer",
			usage: "/computer [invite|kick|nosey]",
			desc: "Manage the AI assistant: invite, kick, or toggle nosey (auto-respond) mode",
		},
		{
			cmd: "/call",
			usage: "/call",
			desc: "Start a voice/video call in this chat",
		},
		{
			cmd: "/model",
			usage: "/model",
			desc: "Configure the AI model and provider",
			aliases: ["/or", "/openrouter", "/ollama", "/provider"],
		},
		{
			cmd: "/pin",
			usage: "/pin <url|transcript>",
			desc: "Pin a document to the sidebar (automerge URL, tiny patchwork URL, or \"transcript\")",
		},
	]

	// ---- Emoji/emoticon & slash command autocomplete ----
	const autocomplete = document.createElement("div")
	autocomplete.className = "chat-autocomplete"
	inputWrapper.appendChild(autocomplete)
	let acItems = [] // current autocomplete results
	let acIndex = -1 // highlighted index
	let acColonStart = -1 // position of the `:` that started the query
	let acMode = null // "emoji" or "slash"

	function getSlashQuery() {
		const val = getInputValue()
		const cursor = getInputCursor()
		// Only trigger at the very start of the input
		if (!val.startsWith("/")) return null
		// Get text from `/` to cursor
		const typed = val.slice(0, cursor)
		// Must not contain a space yet (still typing the command name)
		if (typed.includes(" ")) return null
		return typed.slice(1).toLowerCase() // query without the leading /
	}

	function getAutocompleteQuery() {
		const val = getInputValue()
		const cursor = getInputCursor()
		// Search backwards from cursor for a `:` that starts an incomplete emoji token
		for (let i = cursor - 1; i >= 0; i--) {
			const ch = val[i]
			if (ch === ":") {
				const query = val.slice(i + 1, cursor)
				if (query.length < 2) return null
				// Check the char before `:` — should be start of string, whitespace, or another `:`
				if (i > 0 && !/[\s:({[]/.test(val[i - 1])) return null
				acColonStart = i
				return query.toLowerCase()
			}
			// Allow alphanumeric, dash, underscore, plus in the query portion
			if (!/[a-zA-Z0-9_+-]/.test(ch)) return null
		}
		return null
	}

	// Fuzzy match: query chars must appear in order in the target, ignoring -_spaces as separators
	function fuzzyMatch(query, target) {
		const tNorm = target.toLowerCase()
		const qChars = query.replace(/[-_ ]/g, "")
		if (qChars.length === 0) return true
		let qi = 0
		for (let ti = 0; ti < tNorm.length && qi < qChars.length; ti++) {
			const tc = tNorm[ti]
			if (tc === "-" || tc === "_" || tc === " ") continue
			if (tc === qChars[qi]) qi++
		}
		return qi === qChars.length
	}

	function fuzzyScore(query, target) {
		// Prefer: starts-with > contains-substring > fuzzy-only
		const tNorm = target.toLowerCase().replace(/[-_ ]/g, "")
		const qNorm = query.replace(/[-_ ]/g, "")
		if (tNorm.startsWith(qNorm)) return 0
		if (tNorm.includes(qNorm)) return 1
		return 2
	}

	function searchEmoji(query) {
		const results = []
		const maxResults = 12
		const seen = new Set() // dedupe by emoji character
		// Custom emoticons first
		const allEm = getAllEmoticons()
		for (const [name, info] of Object.entries(allEm)) {
			if (fuzzyMatch(query, name)) {
				results.push({
					type: "emoticon",
					name,
					url: info.url,
					display: ":" + name + ":",
					score: fuzzyScore(query, name),
				})
			}
		}
		// Shortcode aliases
		for (const [alias, emoji] of Object.entries(EMOJI_ALIASES)) {
			if (seen.has(emoji)) continue
			if (fuzzyMatch(query, alias)) {
				seen.add(emoji)
				results.push({
					type: "emoji",
					emoji,
					name: alias,
					display: ":" + alias + ":",
					score: fuzzyScore(query, alias),
				})
			}
		}
		// Unicode emoji by full name
		if (EMOJI_LOADED) {
			for (const e of EMOJI_DATA) {
				if (seen.has(e.emoji)) continue
				if (fuzzyMatch(query, e.name)) {
					seen.add(e.emoji)
					results.push({
						type: "emoji",
						emoji: e.emoji,
						name: e.name,
						display: ":" + e.name.replace(/\s+/g, "-") + ":",
						score: fuzzyScore(query, e.name),
					})
				}
			}
		}
		// Sort by score (starts-with first) then alphabetically, limit results
		results.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
		return results.slice(0, maxResults)
	}

	function renderAutocomplete() {
		// Check slash commands first
		const slashQuery = getSlashQuery()
		if (slashQuery !== null) {
			const matches = SLASH_COMMANDS.filter(c => {
				const name = c.cmd.slice(1) // strip leading /
				const aliasMatch = (c.aliases || []).some(a => a.slice(1).startsWith(slashQuery))
				return (
					name.startsWith(slashQuery) ||
					(slashQuery.length > 0 && name.includes(slashQuery)) ||
					aliasMatch
				)
			})
			if (matches.length > 0) {
				acMode = "slash"
				acItems = matches.map(c => ({
					type: "slash",
					cmd: c.cmd,
					usage: c.usage,
					desc: c.desc,
				}))
				acIndex = 0
				autocomplete.innerHTML = ""
				acItems.forEach((item, i) => {
					const row = document.createElement("div")
					row.className = "chat-autocomplete-item" + (i === 0 ? " active" : "")
					const cmdEl = document.createElement("span")
					cmdEl.className = "chat-autocomplete-item-cmd"
					cmdEl.textContent = item.usage
					row.appendChild(cmdEl)
					const descEl = document.createElement("span")
					descEl.className = "chat-autocomplete-item-desc"
					descEl.textContent = item.desc
					row.appendChild(descEl)
					row.addEventListener("pointerdown", e => {
						e.preventDefault()
						completeAutocomplete(i)
					})
					autocomplete.appendChild(row)
				})
				autocomplete.classList.add("show")
				return
			}
		}

		// Emoji/emoticon autocomplete
		const query = getAutocompleteQuery()
		if (!query) {
			autocomplete.classList.remove("show")
			acItems = []
			acIndex = -1
			acMode = null
			return
		}
		acMode = "emoji"
		acItems = searchEmoji(query)
		if (acItems.length === 0) {
			autocomplete.classList.remove("show")
			acIndex = -1
			return
		}
		acIndex = 0
		autocomplete.innerHTML = ""
		acItems.forEach((item, i) => {
			const row = document.createElement("div")
			row.className = "chat-autocomplete-item" + (i === 0 ? " active" : "")
			const emojiEl = document.createElement("span")
			emojiEl.className = "chat-autocomplete-item-emoji"
			if (item.type === "emoticon") {
				const img = document.createElement("img")
				img.src = "/" + encodeURIComponent(item.url) + "/"
				emojiEl.appendChild(img)
			} else {
				emojiEl.textContent = item.emoji
			}
			row.appendChild(emojiEl)
			const nameEl = document.createElement("span")
			nameEl.className = "chat-autocomplete-item-name"
			nameEl.textContent = item.display
			row.appendChild(nameEl)
			row.addEventListener("pointerdown", e => {
				e.preventDefault() // don't blur input
				completeAutocomplete(i)
			})
			autocomplete.appendChild(row)
		})
		autocomplete.classList.add("show")
	}

	function completeAutocomplete(idx) {
		const item = acItems[idx]
		if (!item) return

		if (item.type === "slash") {
			// Replace everything up to cursor with the command + space
			const replacement = item.cmd + " "
			if (cmView) {
				cmView.dispatch({
					changes: {
						from: 0,
						to: cmView.state.doc.length,
						insert: replacement,
					},
					selection: {anchor: replacement.length},
				})
			}
		} else {
			// Emoji/emoticon completion
			const val = getInputValue()
			const cursor = getInputCursor()
			const replacement = item.display
			const before = val.slice(0, acColonStart)
			const after = val.slice(cursor)
			const newText = before + replacement + " " + after
			const newCursor = before.length + replacement.length + 1
			if (cmView) {
				cmView.dispatch({
					changes: {from: 0, to: cmView.state.doc.length, insert: newText},
					selection: {anchor: newCursor},
				})
			}
		}
		autocomplete.classList.remove("show")
		acItems = []
		acIndex = -1
		acMode = null
	}

	function updateAcHighlight() {
		const items = autocomplete.querySelectorAll(".chat-autocomplete-item")
		items.forEach((el, i) => el.classList.toggle("active", i === acIndex))
		items[acIndex]?.scrollIntoView({block: "nearest"})
	}

	// ---- File staging (paste & drag-drop) ----
	function addPendingFile(blob, name, mimeType) {
		const entry = {blob, name, mimeType}
		if (mimeType.startsWith("image/") || mimeType.startsWith("video/")) {
			entry.dataUrl = URL.createObjectURL(blob)
		}
		pendingFiles.push(entry)
		renderPendingFiles()
	}

	function removePendingFile(idx) {
		const removed = pendingFiles.splice(idx, 1)
		if (removed[0]?.dataUrl) URL.revokeObjectURL(removed[0].dataUrl)
		renderPendingFiles()
	}

	function renderPendingFiles() {
		pasteFilesContainer.innerHTML = ""
		if (pendingFiles.length === 0 && pendingEmbeds.length === 0) {
			pastePreview.classList.remove("show")
			return
		}
		pastePreview.classList.add("show")
		// Render pending embeds
		pendingEmbeds.forEach((em, i) => {
			const chip = document.createElement("div")
			chip.className = "chat-paste-embed"
			const icon = document.createElement("span")
			icon.className = "chat-msg-file-icon"
			icon.innerHTML = SVG_ICONS.pin || "\u{1F4CC}"
			chip.appendChild(icon)
			const nameEl = document.createElement("span")
			nameEl.className = "chat-paste-embed-name"
			nameEl.textContent = em.title || em.docUrl.replace("automerge:", "").slice(0, 8) + "…"
			chip.appendChild(nameEl)
			const removeBtn = document.createElement("button")
			removeBtn.className = "chat-paste-embed-remove"
			removeBtn.innerHTML = SVG_ICONS.close
			removeBtn.addEventListener("click", e => {
				e.stopPropagation()
				pendingEmbeds.splice(i, 1)
				renderPendingFiles()
			})
			chip.appendChild(removeBtn)
			pasteFilesContainer.appendChild(chip)
		})
		// Render pending files
		pendingFiles.forEach((f, i) => {
			if (f.mimeType.startsWith("image/")) {
				const img = document.createElement("img")
				img.src = f.dataUrl
				img.title = f.name
				pasteFilesContainer.appendChild(img)
			} else if (f.mimeType.startsWith("video/")) {
				const vid = document.createElement("video")
				vid.src = f.dataUrl
				vid.title = f.name
				vid.muted = true
				pasteFilesContainer.appendChild(vid)
			} else {
				const chip = document.createElement("div")
				chip.className = "chat-paste-file"
				const icon = document.createElement("span")
				icon.className = "chat-msg-file-icon"
				icon.innerHTML = SVG_ICONS.file
				chip.appendChild(icon)
				const nameEl = document.createElement("span")
				nameEl.className = "chat-paste-file-name"
				nameEl.textContent = f.name
				chip.appendChild(nameEl)
				const removeBtn = document.createElement("button")
				removeBtn.className = "chat-paste-file-remove"
				removeBtn.innerHTML = SVG_ICONS.close
				removeBtn.addEventListener("click", e => {
					e.stopPropagation()
					removePendingFile(i)
				})
				chip.appendChild(removeBtn)
				pasteFilesContainer.appendChild(chip)
			}
		})
	}

	function clearPaste() {
		for (const f of pendingFiles) {
			if (f.dataUrl) URL.revokeObjectURL(f.dataUrl)
		}
		pendingFiles = []
		pendingEmbeds = []
		pastePreview.classList.remove("show")
		pasteFilesContainer.innerHTML = ""
	}

	function addFilesFromList(fileList) {
		for (const file of fileList) {
			addPendingFile(file, file.name, file.type || "application/octet-stream")
		}
	}

	// ---- Patchwork DnD helpers ----
	function setupDragSource(element, url, type, name, toolId) {
		element.draggable = true
		element.addEventListener("dragstart", e => {
			e.stopPropagation()
			e.dataTransfer.effectAllowed = "copyMove"
			const item = {id: url, url, type: type || "unknown", name: name || "doc", source: "chat"}
			if (toolId) item.toolId = toolId
			e.dataTransfer.items.add(JSON.stringify([url]), "text/x-patchwork-urls")
			e.dataTransfer.items.add(JSON.stringify({source: "chat", items: [item]}), "text/x-patchwork-dnd")
			const preview = document.createElement("div")
			preview.style.cssText = "position:absolute;top:-1000px;background:var(--bg-mid);padding:4px 8px;border-radius:4px;font-size:12px;color:var(--text-primary);"
			preview.textContent = name || url.replace("automerge:", "").slice(0, 12)
			document.body.appendChild(preview)
			e.dataTransfer.setDragImage(preview, 10, 10)
			setTimeout(() => preview.remove(), 0)
		})
	}

	function parsePatchworkDrop(dataTransfer) {
		// Returns array of {url, type?, name?, toolId?} or null
		const dndData = dataTransfer.getData("text/x-patchwork-dnd")
		if (dndData) {
			try {
				const parsed = JSON.parse(dndData)
				if (parsed.items?.length) {
					return parsed.items.map(it => ({
						url: it.url,
						type: it.type,
						name: it.name,
						toolId: it.toolId,
					}))
				}
			} catch {}
		}
		const urlsData = dataTransfer.getData("text/x-patchwork-urls")
		if (urlsData) {
			try {
				const urls = JSON.parse(urlsData)
				if (Array.isArray(urls) && urls.length) {
					return urls.map(u => ({url: u}))
				}
			} catch {}
		}
		return null
	}

	function hasPatchworkDrop(dataTransfer) {
		return dataTransfer?.types?.includes("text/x-patchwork-dnd") ||
			dataTransfer?.types?.includes("text/x-patchwork-urls")
	}

	// Drag and drop
	const dropOverlay = document.createElement("div")
	dropOverlay.className = "chat-drop-overlay"
	dropOverlay.textContent = "Drop here"
	root.appendChild(dropOverlay)

	let dragCounter = 0
	root.addEventListener("dragenter", e => {
		e.preventDefault()
		dragCounter++
		if (hasPatchworkDrop(e.dataTransfer)) {
			// Show sidebar as drop target during patchwork drags
			sidebar.classList.add("drop-target")
		} else if (e.dataTransfer?.types?.includes("Files")) {
			dropOverlay.classList.add("show")
		}
	})
	root.addEventListener("dragleave", e => {
		e.preventDefault()
		dragCounter--
		if (dragCounter <= 0) {
			dragCounter = 0
			dropOverlay.classList.remove("show")
			sidebar.classList.remove("drop-target")
		}
	})
	root.addEventListener("dragover", e => {
		e.preventDefault()
	})
	root.addEventListener("drop", e => {
		e.preventDefault()
		dragCounter = 0
		dropOverlay.classList.remove("show")
		sidebar.classList.remove("drop-target")
		// Handle patchwork DnD drops (from sideboard or internal drag)
		const patchworkItems = parsePatchworkDrop(e.dataTransfer)
		if (patchworkItems) {
			for (const item of patchworkItems) {
				if (!item.url) continue
				// Don't add duplicates
				if (pendingEmbeds.some(pe => pe.docUrl === item.url)) continue
				pendingEmbeds.push({
					docUrl: item.url,
					toolId: item.toolId,
					title: item.name,
					type: item.type,
				})
			}
			renderPendingFiles()
			focusInput()
			return
		}
		if (e.dataTransfer?.files?.length) addFilesFromList(e.dataTransfer.files)
	})

	// ---- File/recording creation ----
	async function createFileDoc(blob, fileName, mimeType) {
		const repo = window.repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await blob.arrayBuffer())
		const ext = fileName
			? fileName.split(".").pop()
			: (mimeType || "").split("/")[1] || "bin"
		const name = fileName || "file-" + Date.now() + "." + ext
		const fh = await repo.create2({
			content: u8,
			extension: ext,
			mimeType: mimeType || "application/octet-stream",
			name: name,
			"@patchwork": {type: "file"},
		})
		return fh.url
	}

	async function createRecordingDoc(audioBlob, duration) {
		const repo = window.repo
		if (!repo) throw new Error("No repo")
		const u8 = new Uint8Array(await audioBlob.arrayBuffer())
		const ah = await repo.create2({content: u8})
		const rh = await repo.create2({
			title: "Voice Note",
			audio: ah.url,
			duration: duration,
			"@patchwork": {
				type: "recording",
				suggestedImportUrl: "automerge:2a5Rkw9LkqXfBAQZbcBWjTcf15Mc",
			},
		})
		return {url: rh.url}
	}

	// ---- GIF camera ----
	async function startGifCamera() {
		try {
			gifStream = await navigator.mediaDevices.getUserMedia({
				video: {width: 320, height: 320, facingMode: "user"},
			})
			gifVideo.srcObject = gifStream
		} catch (e) {
			console.warn("[Chat] camera:", e)
			gifModeEnabled = false
			gifToggle.classList.remove("active")
		}
	}

	function stopGifCamera() {
		if (gifStream) {
			gifStream.getTracks().forEach(t => t.stop())
			gifStream = null
		}
		gifVideo.srcObject = null
	}

	async function captureGif() {
		if (!gifStream || !gifVideo.videoWidth) return null

		// Show recording feedback with pie progress
		gifToggle.classList.add("recording")
		inputRow.classList.add("processing")

		// Create pie progress SVG overlay (bg track + fg arc)
		const pieSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
		pieSvg.setAttribute("class", "chat-gif-progress")
		pieSvg.setAttribute("viewBox", "0 0 36 36")
		const bgCircle = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"circle"
		)
		bgCircle.setAttribute("class", "chat-gif-progress-bg")
		bgCircle.setAttribute("cx", "18")
		bgCircle.setAttribute("cy", "18")
		bgCircle.setAttribute("r", "15")
		pieSvg.appendChild(bgCircle)
		const pieCircle = document.createElementNS(
			"http://www.w3.org/2000/svg",
			"circle"
		)
		pieCircle.setAttribute("class", "chat-gif-progress-fg")
		pieCircle.setAttribute("cx", "18")
		pieCircle.setAttribute("cy", "18")
		pieCircle.setAttribute("r", "15")
		const circumference = 2 * Math.PI * 15
		pieCircle.setAttribute("stroke-dasharray", String(circumference))
		pieCircle.setAttribute("stroke-dashoffset", String(circumference))
		pieSvg.appendChild(pieCircle)
		gifToggle.appendChild(pieSvg)

		try {
			const size = 160
			gifCanvas.width = size
			gifCanvas.height = size
			const ctx = gifCanvas.getContext("2d")
			const encoder = new SimpleGIFEncoder(size, size)
			const frameCount = 15,
				frameDelay = 133

			for (let i = 0; i < frameCount; i++) {
				ctx.drawImage(gifVideo, 0, 0, size, size)
				encoder.addFrame(gifCanvas, frameDelay)
				// Update pie progress — fills once from 0 to 100%
				const progress = (i + 1) / frameCount
				pieCircle.setAttribute(
					"stroke-dashoffset",
					String(circumference * (1 - progress))
				)
				if (i < frameCount - 1)
					await new Promise(r => setTimeout(r, frameDelay))
			}

			const data = encoder.encode()
			if (!data) return null
			const blob = new Blob([data], {type: "image/gif"})
			const url = await createFileDoc(blob)
			handle.change(d => {
				if (!d.docs) d.docs = []
				d.docs.push({
					url,
					type: "file",
					name: "selfie-" + Date.now() + ".gif",
				})
			})
			return url
		} finally {
			pieSvg.remove()
			gifToggle.classList.remove("recording")
			inputRow.classList.remove("processing")
		}
	}

	// ---- Voice recording ----
	let recTimerInterval = null
	let recAnalyser = null
	let recAnimFrame = null
	let recSendOnStop = false // true = send, false = cancelled
	let recordingBar = null

	micBtn.addEventListener("click", () => {
		isRecording ? stopAndSendRec() : startRec()
	})

	async function startRec() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({audio: true})
			let mime = "audio/webm;codecs=opus"
			if (!MediaRecorder.isTypeSupported(mime)) {
				mime = "audio/webm"
				if (!MediaRecorder.isTypeSupported(mime)) mime = undefined
			}
			recordingChunks = []
			recSendOnStop = false
			mediaRecorder = new MediaRecorder(
				stream,
				mime ? {mimeType: mime} : undefined
			)
			mediaRecorder.ondataavailable = e => {
				if (e.data.size > 0) recordingChunks.push(e.data)
			}
			mediaRecorder.onstop = async () => {
				stream.getTracks().forEach(t => t.stop())
				cleanupRecordingUI()
				const dur = (Date.now() - recordingStartTime) / 1000
				if (!recSendOnStop || dur < 0.5) {
					isRecording = false
					return
				}
				const blob = new Blob(recordingChunks, {
					type: mediaRecorder.mimeType || "audio/webm",
				})
				try {
					const {url} = await createRecordingDoc(blob, dur)
					handle.change(d => {
						if (!d.docs) d.docs = []
						d.docs.push({
							url,
							type: "recording",
							name: "voice-" + Date.now(),
						})
					})
					sendMsg(null, null, null, url, dur)
					// Pre-cache the recording doc and transcribe
					resolveRecordingDoc(url)
					transcribeVoiceNote(blob, url)
				} catch (e) {
					console.error("[Chat] voice:", e)
				}
				isRecording = false
			}

			// Set up audio analyser for waveform visualization
			try {
				const audioCtx = new AudioContext()
				const source = audioCtx.createMediaStreamSource(stream)
				recAnalyser = audioCtx.createAnalyser()
				recAnalyser.fftSize = 64
				source.connect(recAnalyser)
			} catch (e) {
				recAnalyser = null
			}

			recordingStartTime = Date.now()
			mediaRecorder.start(100)
			isRecording = true
			showRecordingUI()
		} catch (e) {
			console.error("[Chat] mic:", e)
		}
	}

	function stopAndSendRec() {
		recSendOnStop = true
		if (mediaRecorder && mediaRecorder.state !== "inactive")
			mediaRecorder.stop()
	}

	function cancelRec() {
		recSendOnStop = false
		if (mediaRecorder && mediaRecorder.state !== "inactive")
			mediaRecorder.stop()
	}

	function showRecordingUI() {
		// Hide the normal input row, show recording bar
		inputRow.style.display = "none"

		recordingBar = document.createElement("div")
		recordingBar.className = "chat-recording-bar"

		const dot = document.createElement("div")
		dot.className = "chat-recording-dot"
		recordingBar.appendChild(dot)

		const timeEl = document.createElement("span")
		timeEl.className = "chat-recording-time"
		timeEl.textContent = "0:00"
		recordingBar.appendChild(timeEl)

		// Live waveform visualization
		const viz = document.createElement("div")
		viz.className = "chat-recording-viz"
		const vizBars = []
		for (let i = 0; i < 32; i++) {
			const bar = document.createElement("div")
			bar.className = "chat-recording-viz-bar"
			bar.style.height = "3px"
			viz.appendChild(bar)
			vizBars.push(bar)
		}
		recordingBar.appendChild(viz)

		const cancelBtn = document.createElement("button")
		cancelBtn.className = "chat-recording-cancel"
		cancelBtn.textContent = "Cancel"
		cancelBtn.addEventListener("click", cancelRec)
		recordingBar.appendChild(cancelBtn)

		const sendRecBtn = document.createElement("button")
		sendRecBtn.className = "chat-recording-send"
		sendRecBtn.innerHTML = SVG_ICONS.send
		sendRecBtn.addEventListener("click", stopAndSendRec)
		recordingBar.appendChild(sendRecBtn)

		inputWrapper.appendChild(recordingBar)

		// Update timer every second
		recTimerInterval = setInterval(() => {
			const elapsed = (Date.now() - recordingStartTime) / 1000
			timeEl.textContent = formatDuration(elapsed)
		}, 500)

		// Animate waveform from analyser
		function animateViz() {
			if (!isRecording) return
			if (recAnalyser) {
				const data = new Uint8Array(recAnalyser.frequencyBinCount)
				recAnalyser.getByteFrequencyData(data)
				for (let i = 0; i < vizBars.length; i++) {
					const val = data[i] || 0
					vizBars[i].style.height = Math.max(3, (val / 255) * 22) + "px"
				}
			}
			recAnimFrame = requestAnimationFrame(animateViz)
		}
		animateViz()
	}

	function cleanupRecordingUI() {
		if (recTimerInterval) {
			clearInterval(recTimerInterval)
			recTimerInterval = null
		}
		if (recAnimFrame) {
			cancelAnimationFrame(recAnimFrame)
			recAnimFrame = null
		}
		recAnalyser = null
		if (recordingBar) {
			recordingBar.remove()
			recordingBar = null
		}
		inputRow.style.display = ""
	}

	// ---- Patchwork URL parsing ----
	const TINY_PW_RE = /https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/g
	function parsePatchworkLinks(text) {
		const links = []
		let match
		while ((match = TINY_PW_RE.exec(text)) !== null) {
			try {
				const parsed = new URL(match[0])
				if (parsed.hash) {
					const params = new URLSearchParams(parsed.hash.slice(1))
					const docId = params.get("doc")
					if (docId) {
						links.push({
							docUrl: "automerge:" + docId,
							title: params.get("title")
								? decodeURIComponent(params.get("title").replace(/\+/g, " "))
								: "",
							type: params.get("type") || "",
							toolId: params.get("tool") || "",
							originalUrl: match[0],
						})
					}
				}
			} catch (e) {}
		}
		TINY_PW_RE.lastIndex = 0
		return links
	}

	// ---- Slash commands ----
	const NAMED_COLORS = {
		red: {light: "oklch(0.55 0.25 25)", dark: "oklch(0.72 0.22 25)"},
		orange: {light: "oklch(0.62 0.22 55)", dark: "oklch(0.78 0.18 55)"},
		yellow: {light: "oklch(0.60 0.20 95)", dark: "oklch(0.88 0.18 95)"},
		green: {light: "oklch(0.50 0.20 145)", dark: "oklch(0.75 0.22 145)"},
		teal: {light: "oklch(0.50 0.14 180)", dark: "oklch(0.75 0.14 180)"},
		cyan: {light: "oklch(0.52 0.15 210)", dark: "oklch(0.80 0.15 210)"},
		blue: {light: "oklch(0.50 0.22 260)", dark: "oklch(0.72 0.18 260)"},
		indigo: {light: "oklch(0.45 0.25 280)", dark: "oklch(0.68 0.20 280)"},
		purple: {light: "oklch(0.50 0.25 300)", dark: "oklch(0.72 0.22 300)"},
		pink: {light: "oklch(0.55 0.25 340)", dark: "oklch(0.75 0.22 340)"},
		hotpink: {light: "oklch(0.55 0.30 350)", dark: "oklch(0.75 0.28 350)"},
		magenta: {light: "oklch(0.52 0.28 320)", dark: "oklch(0.72 0.25 320)"},
		coral: {light: "oklch(0.58 0.20 35)", dark: "oklch(0.78 0.18 35)"},
		gold: {light: "oklch(0.58 0.18 85)", dark: "oklch(0.85 0.16 85)"},
		lime: {light: "oklch(0.52 0.22 130)", dark: "oklch(0.82 0.25 130)"},
		lavender: {light: "oklch(0.50 0.18 290)", dark: "oklch(0.78 0.15 290)"},
		salmon: {light: "oklch(0.55 0.18 25)", dark: "oklch(0.78 0.16 25)"},
		white: {light: "oklch(0.35 0 0)", dark: "oklch(0.95 0 0)"},
		black: {light: "oklch(0.20 0 0)", dark: "oklch(0.60 0 0)"},
		grey: {light: "oklch(0.45 0 0)", dark: "oklch(0.70 0 0)"},
		gray: {light: "oklch(0.45 0 0)", dark: "oklch(0.70 0 0)"},
		neonmint: {light: "oklch(0.85 0.30 160)", dark: "oklch(0.85 0.30 160)"},
	}

	function resolveNamedColor(name) {
		const entry = NAMED_COLORS[name.toLowerCase()]
		if (entry) return isLightBg ? entry.light : entry.dark
		// Try as raw CSS color
		return name
	}

	// Parse a possibly-quoted token from the start of a string.
	// Returns [token, rest] or null.
	function parseToken(str) {
		str = str.trimStart()
		if (str.startsWith('"')) {
			const end = str.indexOf('"', 1)
			if (end < 0) return null
			return [str.slice(1, end), str.slice(end + 1).trimStart()]
		}
		const sp = str.indexOf(" ")
		if (sp < 0) return [str, ""]
		return [str.slice(0, sp), str.slice(sp + 1)]
	}

	function parseSlashCommand(text) {
		if (text.startsWith("/me ")) {
			return {action: true, text: text.slice(4)}
		}
		const slapMatch = text.match(/^\/slap\s+(.+)/)
		if (slapMatch) {
			return {
				action: true,
				text: "slaps " + slapMatch[1].trim() + " with a large trout",
			}
		}
		if (text.startsWith("/font ")) {
			const parsed = parseToken(text.slice(6))
			if (parsed && parsed[1]) return {overrideFont: parsed[0], text: parsed[1]}
		}
		if (text.startsWith("/color ") || text.startsWith("/colour ")) {
			const offset = text.startsWith("/colour ") ? 8 : 7
			const parsed = parseToken(text.slice(offset))
			if (parsed && parsed[1])
				return {overrideColor: parsed[0], text: parsed[1]}
		}
		if (text.startsWith("/face ")) {
			const p1 = parseToken(text.slice(6))
			if (p1) {
				const p2 = parseToken(p1[1])
				if (p2 && p2[1])
					return {overrideColor: p1[0], overrideFont: p2[0], text: p2[1]}
			}
		}
		if (text.startsWith("/marquee ")) {
			return {marquee: true, text: text.slice(9)}
		}
		return null
	}

	// ---- Send ----
	async function sendMessage() {
		const text = getInputValue().trim()

		// Handle /addfont command — opens dialog instead of sending
		if (text === "/addfont" || text.startsWith("/addfont ")) {
			setInputValue("")
			showFontAddDialog()
			return
		}

		// Handle /computer subcommands
		if (text.toLowerCase() === "/computer" || text.toLowerCase().startsWith("/computer ")) {
			setInputValue("")
			const sub = text.slice("/computer".length).trim().toLowerCase()
			if (sub === "" || sub === "invite") {
				inviteComputer()
			} else if (sub === "kick") {
				kickComputer()
			} else if (sub === "nosey" || sub === "auto") {
				computerAutoMode = !computerAutoMode
				const status = computerAutoMode ? "on" : "off"
				if (computerActive) {
					sendComputerMessage(
						"Nosey mode is now **" + status + "**. " +
						(computerAutoMode
							? "I'll respond to all messages."
							: "I'll only respond when addressed with @computer.")
					)
				}
			}
			return
		}

		// Handle /call
		if (text.toLowerCase() === "/call") {
			setInputValue("")
			startCall()
			return
		}

		// Handle /pin — pin a doc to the sidebar
		if (text.toLowerCase().startsWith("/pin ") || text.toLowerCase() === "/pin") {
			setInputValue("")
			const arg = text.slice(5).trim()
			if (!arg) {
				updateLLMStatus("Usage: /pin <automerge-url|tiny-patchwork-url|transcript>")
				setTimeout(() => updateLLMStatus(""), 3000)
				return
			}
			if (arg.toLowerCase() === "transcript") {
				const doc = handle.doc()
				const callUrl = doc?.callUrl
				if (!callUrl) {
					updateLLMStatus("No call to pin — start a call first with /call")
					setTimeout(() => updateLLMStatus(""), 3000)
					return
				}
				pinDoc(callUrl, "teleprint", "Teleprint")
				return
			}
			if (arg.startsWith("automerge:")) {
				pinDoc(arg, "", arg.replace("automerge:", "").slice(0, 8) + "…")
				return
			}
			const tinyMatch = arg.match(/https?:\/\/tiny\.patchwork\.inkandswitch\.com\/#[^\s]+/)
			if (tinyMatch) {
				try {
					const parsed = new URL(tinyMatch[0])
					const params = new URLSearchParams(parsed.hash.slice(1))
					const docId = params.get("doc")
					if (docId) {
						const docUrl = "automerge:" + docId
						const toolId = params.get("tool") || ""
						const title = params.get("title")
							? decodeURIComponent(params.get("title").replace(/\+/g, " "))
							: docId.slice(0, 8) + "…"
						pinDoc(docUrl, toolId, title)
						return
					}
				} catch {}
			}
			updateLLMStatus("Unrecognized URL — use an automerge: URL, tiny patchwork URL, or \"transcript\"")
			setTimeout(() => updateLLMStatus(""), 3000)
			return
		}

		// Handle /model (and aliases /or, /openrouter, /ollama, /provider)
		const lc = text.toLowerCase()
		if (lc === "/model" || lc === "/openrouter" || lc.startsWith("/openrouter ") || lc === "/or" || lc.startsWith("/or ") || lc === "/ollama" || lc.startsWith("/provider")) {
			setInputValue("")
			showModelDialog()
			return
		}

		// Upload all pending files
		let imageUrl = null,
			imageName = null
		const fileAttachments = [] // { url, name, mimeType }
		if (pendingFiles.length > 0) {
			for (const pf of pendingFiles) {
				try {
					const url = await createFileDoc(pf.blob, pf.name, pf.mimeType)
					handle.change(d => {
						if (!d.docs) d.docs = []
						d.docs.push({url, type: "file", name: pf.name})
					})
					// First image becomes the legacy imageUrl for backwards compat
					if (!imageUrl && pf.mimeType.startsWith("image/")) {
						imageUrl = url
						imageName = pf.name
					} else {
						fileAttachments.push({url, name: pf.name, mimeType: pf.mimeType})
					}
				} catch (e) {
					console.error("[Chat] file upload:", e)
				}
			}
			clearPaste()
		}

		// Check for slash commands
		const slashCmd = parseSlashCommand(text)

		// Extract patchwork doc links from text
		const sourceText = slashCmd ? slashCmd.text : text
		const patchworkLinks = parsePatchworkLinks(sourceText)
		// Strip the URLs from the displayed text
		let cleanText = sourceText
		for (const link of patchworkLinks) {
			cleanText = cleanText.replace(link.originalUrl, "").trim()
		}

		// Merge pending embeds into patchwork links
		const allEmbeds = [...patchworkLinks]
		for (const pe of pendingEmbeds) {
			allEmbeds.push({
				docUrl: pe.docUrl,
				toolId: pe.toolId || "",
				title: pe.title || "",
				type: pe.type || "",
			})
		}
		if (pendingEmbeds.length > 0) {
			pendingEmbeds = []
			renderPendingFiles()
		}

		if (
			!cleanText &&
			!imageUrl &&
			fileAttachments.length === 0 &&
			allEmbeds.length === 0
		)
			return

		let gifUrl = null
		if (gifModeEnabled) {
			try {
				gifUrl = await captureGif()
			} catch (e) {
				console.warn("[Chat] gif:", e)
			}
		}

		try {
			await sendMsg(
				cleanText,
				imageUrl,
				imageName,
				null,
				null,
				gifUrl,
				allEmbeds.length > 0 ? allEmbeds : null,
				slashCmd?.action || false,
				slashCmd?.overrideFont || null,
				slashCmd?.overrideColor || null,
				slashCmd?.marquee || false,
				fileAttachments.length > 0 ? fileAttachments : null
			)
		} catch (e) {
			console.error("[Chat] sendMsg:", e)
		}
		setInputValue("")
		focusInput()
		clearDraft()
	}

	// ---- Message doc cache ----
	const msgDocCache = new Map() // url -> { data, handle }
	const msgDocSubscribed = new Set() // urls we're listening to
	let renderTimer = null
	function scheduleRender(force) {
		if (renderTimer && !force) return
		if (renderTimer) cancelAnimationFrame(renderTimer)
		renderTimer = requestAnimationFrame(() => {
			renderTimer = null
			render()
		})
	}

	async function resolveMessageDoc(url) {
		if (msgDocCache.has(url)) return msgDocCache.get(url)
		try {
			const repo = window.repo
			if (!repo) return null
			const mh = await repo.find(url)
			const data = mh.doc()
			if (data) msgDocCache.set(url, {data, handle: mh})
			// Subscribe to changes on this message doc
			if (!msgDocSubscribed.has(url)) {
				msgDocSubscribed.add(url)
				mh.on("change", () => {
					const updated = mh.doc()
					if (updated) msgDocCache.set(url, {data: updated, handle: mh})
					render()
				})
			}
			// Re-render to show this newly loaded message (force to avoid dedup)
			scheduleRender(true)
			return msgDocCache.get(url)
		} catch (e) {
			console.warn("[Chat] resolve msg doc:", e)
			return null
		}
	}

	// Kick off loading for any unresolved message refs
	function ensureMessageDocsLoaded(entries) {
		let needsRerender = false
		for (const entry of entries) {
			if (entry.ref && entry.url && !msgDocCache.has(entry.url)) {
				needsRerender = true
				resolveMessageDoc(entry.url) // async, will trigger render on resolve
			}
		}
	}

	async function sendMsg(
		text,
		imageUrl,
		imageName,
		voiceUrl,
		voiceDuration,
		gifSelfieUrl,
		embeds,
		action,
		overrideFont,
		overrideColor,
		marquee,
		files
	) {
		const repo = window.repo
		const msgData = {
			id: generateId(),
			name: myName,
			text: text || "",
			timestamp: Date.now(),
		}
		if (overrideFont) msgData.font = overrideFont
		else if (myFont) msgData.font = myFont
		if (myAvatarUrl) msgData.avatarUrl = myAvatarUrl
		if (replyToId) msgData.replyTo = replyToId
		if (imageUrl) {
			msgData.imageUrl = imageUrl
			msgData.imageName = imageName
		}
		if (voiceUrl) {
			msgData.voiceUrl = voiceUrl
			msgData.voiceDuration = voiceDuration
		}
		if (gifSelfieUrl) msgData.gifSelfieUrl = gifSelfieUrl
		if (embeds) msgData.embeds = embeds
		if (action) msgData.action = true
		if (marquee) msgData.marquee = true
		if (overrideColor) msgData.color = overrideColor
		if (files) msgData.files = files // [{ url, name, mimeType }]

		// Embed emoticon URLs referenced in text
		const allEm = getAllEmoticons()
		const usedEmoticons = {}
		const emMatches = (text || "").matchAll(/:([a-zA-Z0-9_-]+):/g)
		for (const m of emMatches) {
			const name = m[1]
			if (allEm[name]) usedEmoticons[name] = allEm[name].url
		}
		if (Object.keys(usedEmoticons).length > 0) msgData.emoticons = usedEmoticons

		// Create individual message doc
		const msgHandle = await repo.create2(msgData)
		const msgUrl = msgHandle.url

		// Cache it immediately
		msgDocCache.set(msgUrl, {data: msgData, handle: msgHandle})
		if (!msgDocSubscribed.has(msgUrl)) {
			msgDocSubscribed.add(msgUrl)
			msgHandle.on("change", () => {
				const updated = msgHandle.doc()
				if (updated) msgDocCache.set(msgUrl, {data: updated, handle: msgHandle})
				render()
			})
		}

		// Add reference to chat doc
		handle.change(d => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: msgUrl, timestamp: msgData.timestamp})
		})

		replyToId = null
		replyBar.classList.remove("show")
	}

	sendBtn.addEventListener("click", sendMessage)

	// ---- Reactions ----
	function toggleReaction(idx, emoji) {
		const doc = handle.doc()
		const entry = doc?.messages?.[idx]
		if (!entry) return

		if (entry.ref && entry.url) {
			// Ref message: change the message's own doc
			const cached = msgDocCache.get(entry.url)
			if (!cached) return
			cached.handle.change(d => {
				if (!d.reactions) d.reactions = {}
				if (!d.reactions[emoji]) d.reactions[emoji] = []
				const arr = d.reactions[emoji]
				const i = arr.indexOf(myName)
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete d.reactions[emoji]
				} else arr.push(myName)
			})
		} else {
			// Inline (legacy) message
			handle.change(d => {
				const msg = d.messages[idx]
				if (!msg) return
				if (!msg.reactions) msg.reactions = {}
				if (!msg.reactions[emoji]) msg.reactions[emoji] = []
				const arr = msg.reactions[emoji]
				const i = arr.indexOf(myName)
				if (i >= 0) {
					arr.splice(i, 1)
					if (arr.length === 0) delete msg.reactions[emoji]
				} else arr.push(myName)
			})
		}
	}

	// ---- Reply ----
	function setReply(msgId) {
		replyToId = msgId
		// Find message data - could be inline or ref
		const doc = handle.doc()
		let msg = null
		for (const entry of doc.messages || []) {
			if (entry.ref && entry.url) {
				const cached = msgDocCache.get(entry.url)
				if (cached && cached.data.id === msgId) {
					msg = cached.data
					break
				}
			} else if (entry.id === msgId) {
				msg = entry
				break
			}
		}
		if (msg)
			replyBarText.textContent = msg.name + ": " + (msg.text || "(attachment)")
		replyBar.classList.add("show")
		focusInput()
	}

	// ---- Load blobs ----
	async function loadBlobUrl(automergeUrl) {
		if (!automergeUrl) return null
		if (avatarCache.has(automergeUrl)) return avatarCache.get(automergeUrl)
		try {
			const repo = window.repo
			if (!repo) return null
			const fh = await repo.find(automergeUrl)
			const doc = fh.doc()
			if (doc?.content) {
				const bytes =
					doc.content instanceof Uint8Array
						? doc.content
						: new Uint8Array(doc.content)
				const blobOpts = doc.mimeType ? {type: doc.mimeType} : {}
				const url = URL.createObjectURL(new Blob([bytes], blobOpts))
				avatarCache.set(automergeUrl, url)
				return url
			}
		} catch (e) {}
		return null
	}

	async function loadAudioUrl(automergeUrl) {
		try {
			const repo = window.repo
			if (!repo) return null
			const rh = await repo.find(automergeUrl)
			const rd = rh.doc()
			if (!rd?.audio) return null
			const ah = await repo.find(rd.audio)
			const ad = ah.doc()
			if (ad?.content) {
				const bytes =
					ad.content instanceof Uint8Array
						? ad.content
						: new Uint8Array(ad.content)
				return URL.createObjectURL(
					new Blob([bytes], {type: "audio/webm;codecs=opus"})
				)
			}
		} catch (e) {}
		return null
	}

	// ---- Render presence ----
	function renderPresence() {
		const now = Date.now()
		presenceBar.innerHTML = ""

		// Show self first
		if (myName) {
			const el = document.createElement("div")
			el.className = "chat-presence-user" + (!isFocused ? " away" : "")
			const av = document.createElement("span")
			av.className = "chat-presence-avatar"
			if (myAvatarBlobUrl) {
				av.innerHTML = '<img src="' + myAvatarBlobUrl + '">'
			} else {
				av.textContent = (myName || "?")[0].toUpperCase()
			}
			el.appendChild(av)
			const lbl = document.createElement("span")
			lbl.textContent = myName
			el.appendChild(lbl)
			presenceBar.appendChild(el)
		}

		for (const [name, info] of presenceMap) {
			if (name === myName) continue
			if (name === "Computer") continue // rendered separately with robot avatar
			if (now - info.timestamp > PRESENCE_TIMEOUT) continue
			const el = document.createElement("div")
			el.className = "chat-presence-user" + (!info.active ? " away" : "")
			const av = document.createElement("span")
			av.className = "chat-presence-avatar"
			if (info.avatarUrl) {
				loadBlobUrl(info.avatarUrl).then(u => {
					if (u) av.innerHTML = '<img src="' + u + '">'
				})
			} else {
				av.textContent = (name || "?")[0].toUpperCase()
			}
			el.appendChild(av)
			const lbl = document.createElement("span")
			lbl.textContent = name
			el.appendChild(lbl)
			presenceBar.appendChild(el)
		}

		// Show Computer in presence if active
		if (computerActive) {
			const el = document.createElement("div")
			el.className = "chat-presence-user"
			const av = document.createElement("span")
			av.className = "chat-presence-avatar computer-presence"
			const img = document.createElement("img")
			img.src = computerAvatarSrc
			av.appendChild(img)
			el.appendChild(av)
			const lbl = document.createElement("span")
			lbl.textContent = "Computer"
			el.appendChild(lbl)
			presenceBar.appendChild(el)
		}

		// Re-append toolbar buttons (innerHTML cleared them)
		presenceBar.appendChild(notifyBtn)
		presenceBar.appendChild(themeBtn)
		presenceBar.appendChild(phoneBtn)
		presenceBar.appendChild(sidebarToggleBtn)
	}

	function renderTyping() {
		const now = Date.now()
		const typers = []
		for (const [name, info] of presenceMap) {
			if (name === myName) continue
			if (info.typing && now - info.timestamp < TYPING_TIMEOUT)
				typers.push(name)
		}
		typingBar.textContent =
			typers.length > 0
				? typers.join(", ") +
					(typers.length === 1 ? " is" : " are") +
					" typing..."
				: ""
		updateTitle()
	}

	// ---- Render messages ----
	let renderedMsgOrder = [] // msg IDs currently in DOM
	let renderedLastName = null
	let renderedLastTime = 0
	const renderedElements = new Map() // msgId -> Element (the message row)

	function updateMessageReactions(msg, rawIdx, emoticonBlobUrls) {
		const el = renderedElements.get(msg.id)
		if (!el) return
		const parent = el.querySelector(".chat-msg-body") || el
		const old = parent.querySelector(".chat-reactions")
		if (old) old.remove()
		renderReactions(parent, msg, rawIdx, emoticonBlobUrls)
	}

	function renderMessageToDOM(
		msg,
		prevName,
		prevTime,
		msgMap,
		emoticonBlobUrls,
		salvaged
	) {
		// Loading placeholder for unresolved ref messages
		if (msg._loading) {
			const row = document.createElement("div")
			row.className = "chat-msg-group chat-msg-loading"
			row.dataset.msgId = msg.id || ""

			// Actions (delete + react still work via rawIdx)
			buildActions(row, msg, msg._rawIdx)

			const avatarCol = document.createElement("div")
			avatarCol.className = "chat-avatar-col"
			const avatar = document.createElement("div")
			avatar.className = "chat-avatar chat-skeleton"
			avatarCol.appendChild(avatar)
			row.appendChild(avatarCol)
			const body = document.createElement("div")
			body.className = "chat-msg-body"
			const line1 = document.createElement("div")
			line1.className = "chat-skeleton-line short"
			const line2 = document.createElement("div")
			line2.className = "chat-skeleton-line"
			body.appendChild(line1)
			body.appendChild(line2)
			row.appendChild(body)
			messagesArea.appendChild(row)
			renderedElements.set(msg.id, row)
			return
		}

		const rawIdx = msg._rawIdx
		const sameAuthor = msg.name === prevName
		const closeInTime = msg.timestamp - prevTime < 120000
		const isContinuation = sameAuthor && closeInTime && !msg.replyTo
		const timeGap = prevTime > 0 && msg.timestamp - prevTime >= 120000
		const hasGifSelfie = !!msg.gifSelfieUrl

		// Reply reference (always before the message)
		if (msg.replyTo && msgMap.has(msg.replyTo)) {
			const orig = msgMap.get(msg.replyTo)
			const ref = document.createElement("div")
			ref.className = "chat-msg-reply-ref"
			const refAvatar = document.createElement("span")
			refAvatar.className = "chat-msg-reply-ref-avatar"
			if (orig.avatarUrl)
				loadBlobUrl(orig.avatarUrl).then(u => {
					if (u) refAvatar.innerHTML = '<img src="' + u + '">'
				})
			ref.appendChild(refAvatar)
			const refName = document.createElement("span")
			refName.className = "chat-msg-reply-ref-name"
			refName.textContent = orig.name
			ref.appendChild(refName)
			const refText = document.createElement("span")
			refText.className = "chat-msg-reply-ref-text"
			refText.textContent = orig.text || "(attachment)"
			ref.appendChild(refText)
			ref.dataset.replyFor = msg.id
			ref.addEventListener("click", () => {
				const el = messagesArea.querySelector(
					'[data-msg-id="' + msg.replyTo + '"]'
				)
				if (el) {
					el.scrollIntoView({behavior: "smooth", block: "center"})
					el.style.background = "var(--bg-hover)"
					setTimeout(() => (el.style.background = ""), 1500)
				}
			})
			messagesArea.appendChild(ref)
		}

		// Action messages (/me, /slap)
		if (msg.action) {
			const row = document.createElement("div")
			row.className = "chat-msg-action" + (timeGap ? " chat-time-gap" : "")
			row.dataset.msgId = msg.id || ""
			if (msg.font) {
				row.style.fontFamily = msg.font
				ensureFontLoaded(msg.font)
			}
			if (msg.color) row.style.color = resolveNamedColor(msg.color)
			const nameSpan = document.createElement("span")
			nameSpan.className = "chat-msg-action-name"
			nameSpan.textContent = msg.name
			row.appendChild(document.createTextNode("* "))
			row.appendChild(nameSpan)
			const actionText = document.createElement("span")
			actionText.innerHTML = " " + formatText(msg.text, emoticonBlobUrls)
			actionText.querySelectorAll(".chat-spoiler").forEach(sp => {
				sp.addEventListener("click", () => sp.classList.toggle("revealed"))
			})
			row.appendChild(actionText)
			buildActions(row, msg, rawIdx)
			renderReactions(row, msg, rawIdx, emoticonBlobUrls)
			messagesArea.appendChild(row)
			renderedElements.set(msg.id, row)
			return
		}

		if (!isContinuation) {
			// Full message row with avatar
			const row = document.createElement("div")
			row.className = "chat-msg-group" + (timeGap ? " chat-time-gap" : "")
			row.dataset.msgId = msg.id || ""

			buildActions(row, msg, rawIdx)

			// Avatar
			const avatarCol = document.createElement("div")
			avatarCol.className = "chat-avatar-col"
			const avatar = document.createElement("div")
			avatar.className = "chat-avatar"
			if (catEarsSet.has(msg.name)) avatar.classList.add("cat-ears")

			const avatarSrc = msg.gifSelfieUrl || msg.avatarUrl
			if (msg.gifSelfieUrl) avatar.classList.add("gif-selfie")
			if (msg.isComputer) {
				avatar.classList.add("computer")
				const img = document.createElement("img")
				img.src = computerAvatarSrc
				avatar.appendChild(img)
			} else if (avatarSrc) {
				loadBlobUrl(avatarSrc).then(u => {
					if (u) avatar.innerHTML = '<img src="' + u + '">'
				})
			} else {
				avatar.textContent = (msg.name || "?")[0].toUpperCase()
			}
			avatar.addEventListener("click", () => {
				if (catEarsSet.has(msg.name)) catEarsSet.delete(msg.name)
				else catEarsSet.add(msg.name)
				render()
			})
			avatarCol.appendChild(avatar)
			row.appendChild(avatarCol)

			// Body
			const body = document.createElement("div")
			body.className = "chat-msg-body"

			const hdr = document.createElement("div")
			hdr.className = "chat-msg-header"
			const nameEl = document.createElement("span")
			nameEl.className =
				"chat-msg-name" + (msg.isComputer ? " chat-msg-name-computer" : "")
			nameEl.textContent = msg.name
			hdr.appendChild(nameEl)
			const timeEl = document.createElement("span")
			timeEl.className = "chat-msg-time"
			timeEl.textContent = formatTime(msg.timestamp)
			hdr.appendChild(timeEl)
			body.appendChild(hdr)

			if (msg.text) {
				const textEl = document.createElement("div")
				textEl.className = "chat-msg-text"
				if (msg.streaming) textEl.classList.add("streaming")
				if (isEmojiOnly(msg.text)) textEl.classList.add("emoji-only")
				let html = formatText(msg.text, emoticonBlobUrls)
				if (msg.marquee) html = "<marquee>" + html + "</marquee>"
				textEl.innerHTML = html
				if (msg.font) {
					textEl.style.fontFamily = msg.font
					ensureFontLoaded(msg.font)
				}
				if (msg.color) textEl.style.color = resolveNamedColor(msg.color)
				// Wire up spoiler clicks
				textEl.querySelectorAll(".chat-spoiler").forEach(sp => {
					sp.addEventListener("click", () => sp.classList.toggle("revealed"))
				})
				body.appendChild(textEl)

				// Cancel button for streaming messages
				if (msg.streaming && activeAbortController) {
					const cancelBtn = document.createElement("button")
					cancelBtn.className = "chat-streaming-cancel"
					cancelBtn.textContent = "Cancel"
					cancelBtn.addEventListener("click", e => {
						e.stopPropagation()
						if (activeAbortController) activeAbortController.abort()
					})
					body.appendChild(cancelBtn)
				}
			}

			renderAttachments(body, msg, salvaged)
			renderReactions(body, msg, rawIdx, emoticonBlobUrls)
			row.appendChild(body)
			messagesArea.appendChild(row)
			renderedElements.set(msg.id, row)
		} else {
			// Continuation message
			const row = document.createElement("div")
			row.className = "chat-msg-continuation" + (hasGifSelfie ? " has-gif" : "")
			row.dataset.msgId = msg.id || ""

			buildActions(row, msg, rawIdx)

			// If this continuation has a GIF selfie, show it aligned with the avatar column
			if (hasGifSelfie) {
				const gifCol = document.createElement("div")
				gifCol.className = "chat-avatar-col"
				const gifInline = document.createElement("img")
				gifInline.className = "chat-msg-gif-inline"
				gifInline.alt = "selfie"
				loadBlobUrl(msg.gifSelfieUrl).then(u => {
					if (u) gifInline.src = u
				})
				gifCol.appendChild(gifInline)
				row.appendChild(gifCol)
			}

			const contBody = document.createElement("div")
			contBody.className = "chat-msg-body"

			if (msg.text) {
				const textEl = document.createElement("div")
				textEl.className = "chat-msg-text"
				if (msg.streaming) textEl.classList.add("streaming")
				if (isEmojiOnly(msg.text)) textEl.classList.add("emoji-only")
				let html = formatText(msg.text, emoticonBlobUrls)
				if (msg.marquee) html = "<marquee>" + html + "</marquee>"
				textEl.innerHTML = html
				if (msg.font) {
					textEl.style.fontFamily = msg.font
					ensureFontLoaded(msg.font)
				}
				if (msg.color) textEl.style.color = resolveNamedColor(msg.color)
				textEl.querySelectorAll(".chat-spoiler").forEach(sp => {
					sp.addEventListener("click", () => sp.classList.toggle("revealed"))
				})
				contBody.appendChild(textEl)
			}

			renderAttachments(contBody, msg, salvaged)
			renderReactions(contBody, msg, rawIdx, emoticonBlobUrls)
			row.appendChild(contBody)
			messagesArea.appendChild(row)
			renderedElements.set(msg.id, row)
		}
	}

	function render() {
		// Don't rebuild messages while user is editing a tool selector input
		if (document.activeElement?.closest?.(".chat-embed-tool-menu")) return

		const doc = handle.doc()
		if (!doc) return

		const newPlaceholder = "Message " + (doc.title || "chat")
		if (newPlaceholder !== placeholderText) {
			placeholderText = newPlaceholder
			// Update CM placeholder if using built-in compartment
			if (cmView && cmPlaceholderCompartment && cmPlaceholderFn) {
				try {
					cmView.dispatch({
						effects: cmPlaceholderCompartment.reconfigure(
							cmPlaceholderFn(placeholderText)
						),
					})
				} catch (e) {}
			}
			// Fallback textarea placeholder
			if (cmView?._fallbackInput)
				cmView._fallbackInput.placeholder = placeholderText
		}

		const rawEntries = doc.messages || []

		// Kick off loading for any unresolved ref messages
		ensureMessageDocsLoaded(rawEntries)

		// Resolve entries: inline messages pass through, ref messages resolve from cache
		// Unresolved refs get a loading placeholder
		const messages = []
		for (let ri = 0; ri < rawEntries.length; ri++) {
			const entry = rawEntries[ri]
			if (entry.ref && entry.url) {
				const cached = msgDocCache.get(entry.url)
				if (cached) {
					messages.push({...cached.data, _rawIdx: ri, _ref: entry})
				} else {
					// Loading placeholder — stable ID based on url so incremental rendering works
					messages.push({
						_loading: true,
						_rawIdx: ri,
						id: "_loading_" + entry.url,
						timestamp: entry.timestamp || 0,
					})
				}
			} else {
				messages.push({...entry, _rawIdx: ri})
			}
		}

		const msgMap = new Map()
		for (const m of messages) if (m.id) msgMap.set(m.id, m)

		// Resolve emoticon URLs for rendering using service worker URLs
		const emoticonBlobUrls = {}
		const allEm = getAllEmoticons()
		// From known emoticons
		for (const [name, info] of Object.entries(allEm)) {
			emoticonBlobUrls[name] = "/" + encodeURIComponent(info.url) + "/"
		}
		// From message-embedded emoticons
		for (const msg of messages) {
			if (msg.emoticons) {
				for (const [name, url] of Object.entries(msg.emoticons)) {
					if (emoticonBlobUrls[name]) continue
					emoticonBlobUrls[name] = "/" + encodeURIComponent(url) + "/"
				}
			}
		}

		// Remember scroll position to decide if we should auto-scroll
		const wasAtBottom =
			messagesArea.scrollHeight -
				messagesArea.scrollTop -
				messagesArea.clientHeight <
			40

		const newMsgIds = messages.map(m => m.id)

		// Map for salvaging patchwork-view elements across re-renders to avoid teardown/remount flicker
		const salvaged = new Map() // "docUrl|toolId" -> patchwork-view element

		// Find common prefix with currently rendered messages
		let commonPrefix = 0
		while (
			commonPrefix < renderedMsgOrder.length &&
			commonPrefix < newMsgIds.length &&
			renderedMsgOrder[commonPrefix] === newMsgIds[commonPrefix]
		) {
			commonPrefix++
		}

		// Handle empty state
		const existingEmpty = messagesArea.querySelector(".chat-empty")
		if (messages.length === 0 && rawEntries.length === 0) {
			if (!existingEmpty) {
				const empty = document.createElement("div")
				empty.className = "chat-empty"
				empty.textContent = "no messages yet. say hello 🥰"
				messagesArea.appendChild(empty)
			}
			renderedMsgOrder = []
			renderedLastName = null
			renderedLastTime = 0
			renderedElements.clear()
			renderPresence()
			renderTyping()
			return
		} else if (existingEmpty) {
			existingEmpty.remove()
		}

		const isAppendOnly =
			commonPrefix === renderedMsgOrder.length &&
			newMsgIds.length > renderedMsgOrder.length

		if (isAppendOnly) {
			// Append-only — just render the new messages without touching existing DOM
			let prevName = renderedLastName
			let prevTime = renderedLastTime
			for (let i = commonPrefix; i < messages.length; i++) {
				renderMessageToDOM(
					messages[i],
					prevName,
					prevTime,
					msgMap,
					emoticonBlobUrls,
					salvaged
				)
				prevName = messages[i].name
				prevTime = messages[i].timestamp
			}
			renderedLastName = prevName
			renderedLastTime = prevTime
		} else if (
			commonPrefix === newMsgIds.length &&
			commonPrefix === renderedMsgOrder.length
		) {
			// Same messages — update reactions and streaming text in-place
			for (const msg of messages) {
				updateMessageReactions(msg, msg._rawIdx, emoticonBlobUrls)
				// Update streaming message text in-place
				const el = renderedElements.get(msg.id)
				if (el && msg.text) {
					const textEl = el.querySelector(".chat-msg-text")
					if (textEl) {
						const newHtml = formatText(msg.text, emoticonBlobUrls)
						if (textEl.innerHTML !== newHtml) {
							textEl.innerHTML = msg.marquee ? "<marquee>" + newHtml + "</marquee>" : newHtml
							// Re-wire spoiler clicks
							textEl.querySelectorAll(".chat-spoiler").forEach(sp => {
								sp.addEventListener("click", () => sp.classList.toggle("revealed"))
							})
						}
						// Update streaming class
						if (msg.streaming) textEl.classList.add("streaming")
						else textEl.classList.remove("streaming")
					}
				}
			}
		} else {
			// Structural change — remove from divergence point, re-render from there
			// Salvage patchwork-view elements so they aren't torn down and remounted
			for (let i = commonPrefix; i < renderedMsgOrder.length; i++) {
				const id = renderedMsgOrder[i]
				const el = renderedElements.get(id)
				if (el) {
					// Move patchwork-views to holding pen before removing parent to avoid teardown
					if (typeof Element.prototype.moveBefore === "function") {
						for (const pv of [...el.querySelectorAll("patchwork-view")]) {
							const key = (pv.getAttribute("doc-url") || "") + "|" + (pv.getAttribute("tool-id") || "")
							pvHoldingPen.moveBefore(pv, null)
							salvaged.set(key, pv)
						}
					}
					el.remove()
				}
				renderedElements.delete(id)
				const replyRef = messagesArea.querySelector(
					'[data-reply-for="' + id + '"]'
				)
				if (replyRef) replyRef.remove()
			}

			let prevName = commonPrefix > 0 ? messages[commonPrefix - 1].name : null
			let prevTime = commonPrefix > 0 ? messages[commonPrefix - 1].timestamp : 0
			for (let i = commonPrefix; i < messages.length; i++) {
				renderMessageToDOM(
					messages[i],
					prevName,
					prevTime,
					msgMap,
					emoticonBlobUrls,
					salvaged
				)
				prevName = messages[i].name
				prevTime = messages[i].timestamp
			}
			renderedLastName = prevName
			renderedLastTime = prevTime
		}

		renderedMsgOrder = newMsgIds

		// Clean up any unsalvaged patchwork-views left in the holding pen
		for (const pv of salvaged.values()) pv.remove()
		// Also clear any strays in the holding pen (shouldn't happen, but be safe)
		while (pvHoldingPen.firstChild) pvHoldingPen.firstChild.remove()

		// Scroll to bottom reliably
		if (wasAtBottom || messagesArea.children.length <= 1) {
			requestAnimationFrame(() => {
				messagesArea.scrollTop = messagesArea.scrollHeight
			})
		}

		renderPresence()
		renderTyping()
	}

	function deleteMessage(idx) {
		handle.change(d => {
			if (!d.messages || idx < 0 || idx >= d.messages.length) return
			const entry = d.messages[idx]
			// Clean up cache if it was a ref
			if (entry.ref && entry.url) {
				msgDocCache.delete(entry.url)
				msgDocSubscribed.delete(entry.url)
			}
			d.messages.splice(idx, 1)
		})
	}

	function buildActions(row, msg, idx) {
		const actions = document.createElement("div")
		actions.className = "chat-msg-actions"

		if (!msg._loading) {
			const replyBtn = document.createElement("button")
			replyBtn.className = "chat-msg-action-btn"
			replyBtn.innerHTML = SVG_ICONS.reply
			replyBtn.title = "Reply"
			replyBtn.addEventListener("click", e => {
				e.stopPropagation()
				setReply(msg.id)
			})
			actions.appendChild(replyBtn)
		}

		const reactBtn = document.createElement("button")
		reactBtn.className = "chat-msg-action-btn"
		reactBtn.innerHTML = SVG_ICONS.react
		reactBtn.title = "Add reaction"
		reactBtn.addEventListener("click", e => {
			e.stopPropagation()
			openEmojiPicker(idx, reactBtn)
		})
		actions.appendChild(reactBtn)

		// "..." menu with delete
		const menuWrap = document.createElement("div")
		menuWrap.className = "chat-msg-menu-wrap"
		const moreBtn = document.createElement("button")
		moreBtn.className = "chat-msg-action-btn"
		moreBtn.innerHTML = SVG_ICONS.more
		moreBtn.title = "More"
		const menu = document.createElement("div")
		menu.className = "chat-msg-menu"

		if (msg.voiceUrl) {
			const openItem = document.createElement("button")
			openItem.className = "chat-msg-menu-item"
			openItem.innerHTML = SVG_ICONS.externalLink + " Open recording"
			openItem.addEventListener("click", e => {
				e.stopPropagation()
				menu.classList.remove("show")
				row.dispatchEvent(new CustomEvent("patchwork:open-document", {
					detail: {url: msg.voiceUrl},
					bubbles: true,
					composed: true,
				}))
			})
			menu.appendChild(openItem)
		}

		const deleteItem = document.createElement("button")
		deleteItem.className = "chat-msg-menu-item danger"
		deleteItem.innerHTML = SVG_ICONS.trash + " Delete"
		deleteItem.addEventListener("click", e => {
			e.stopPropagation()
			menu.classList.remove("show")
			deleteMessage(idx)
		})
		menu.appendChild(deleteItem)

		moreBtn.addEventListener("click", e => {
			e.stopPropagation()
			// Close any other open menus
			root.querySelectorAll(".chat-msg-menu.show").forEach(m => {
				if (m !== menu) m.classList.remove("show")
			})
			menu.classList.toggle("show")
		})

		// Close menu on outside click
		const closeMenu = e => {
			if (!menuWrap.contains(e.target)) menu.classList.remove("show")
		}
		root.addEventListener("click", closeMenu)

		menuWrap.appendChild(moreBtn)
		menuWrap.appendChild(menu)
		actions.appendChild(menuWrap)

		const inlineTime = document.createElement("span")
		inlineTime.className = "chat-msg-inline-time"
		inlineTime.textContent = formatTime(msg.timestamp)
		actions.appendChild(inlineTime)

		row.appendChild(actions)
	}

	function makeResizable(container, msg, key) {
		const grip = document.createElement("div")
		grip.className = "chat-resize-handle"
		grip.innerHTML =
			'<svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 1L1 9M9 5L5 9M9 8L8 9"/></svg>'
		container.appendChild(grip)

		grip.addEventListener("pointerdown", e => {
			e.preventDefault()
			e.stopPropagation()
			grip.setPointerCapture(e.pointerId)
			const startX = e.clientX,
				startY = e.clientY
			const startW = container.offsetWidth,
				startH = container.offsetHeight
			const onMove = ev => {
				const w = Math.max(100, startW + ev.clientX - startX)
				const h = Math.max(60, startH + ev.clientY - startY)
				container.style.width = w + "px"
				container.style.height = h + "px"
			}
			const onUp = ev => {
				grip.releasePointerCapture(ev.pointerId)
				grip.removeEventListener("pointermove", onMove)
				grip.removeEventListener("pointerup", onUp)
				grip.removeEventListener("lostpointercapture", onUp)
				const w = container.offsetWidth,
					h = container.offsetHeight
				// Save dimensions to message doc
				const rawIdx = msg._rawIdx
				const ref = msg._ref
				if (ref && ref.url) {
					const cached = msgDocCache.get(ref.url)
					if (cached)
						cached.handle.change(d => {
							d[key + "Width"] = w
							d[key + "Height"] = h
						})
				} else {
					handle.change(d => {
						const m = d.messages?.[rawIdx]
						if (!m) return
						m[key + "Width"] = w
						m[key + "Height"] = h
					})
				}
			}
			grip.addEventListener("pointermove", onMove)
			grip.addEventListener("pointerup", onUp)
			grip.addEventListener("lostpointercapture", onUp)
		})
	}

	function renderAttachments(parent, msg, salvaged) {
		if (msg.imageUrl) {
			const wrap = document.createElement("div")
			wrap.className = "chat-msg-image-wrap"
			if (msg.imageWidth) wrap.style.width = msg.imageWidth + "px"
			else wrap.style.width = "350px"
			if (msg.imageHeight) wrap.style.height = msg.imageHeight + "px"
			else wrap.style.height = "auto"
			const img = document.createElement("img")
			img.className = "chat-msg-image"
			img.alt = msg.imageName || "image"
			loadBlobUrl(msg.imageUrl).then(u => {
				if (u) img.src = u
			})
			img.addEventListener("load", () => {
				const atBottom =
					messagesArea.scrollHeight -
						messagesArea.scrollTop -
						messagesArea.clientHeight <
					80
				if (atBottom) messagesArea.scrollTop = messagesArea.scrollHeight
			})
			img.addEventListener("click", () => {
				if (img.src) openLightbox(img.src, "image")
			})
			wrap.appendChild(img)
			setupDragSource(wrap, msg.imageUrl, "file", msg.imageName || "image")
			makeResizable(wrap, msg, "image")
			parent.appendChild(wrap)
		}
		if (msg.voiceUrl) {
			const vn = document.createElement("div")
			vn.className = "chat-voice-note"
			const playBtn = document.createElement("button")
			playBtn.className = "chat-voice-play-btn"
			playBtn.innerHTML = SVG_ICONS.play
			const waveform = document.createElement("div")
			waveform.className = "chat-voice-waveform"
			for (let i = 0; i < 24; i++) {
				const bar = document.createElement("div")
				bar.className = "chat-voice-bar"
				bar.style.height = 3 + Math.random() * 18 + "px"
				waveform.appendChild(bar)
			}
			const dur = document.createElement("span")
			dur.className = "chat-voice-duration"
			dur.textContent = msg.voiceDuration
				? formatDuration(msg.voiceDuration)
				: "0:00"
			let audio = null,
				loaded = false
			playBtn.addEventListener("click", async e => {
				e.stopPropagation()
				if (!loaded) {
					const u = await loadAudioUrl(msg.voiceUrl)
					if (u) {
						audio = new Audio(u)
						audio.onended = () => {
							playBtn.innerHTML = SVG_ICONS.play
						}
						loaded = true
					}
				}
				if (audio) {
					if (audio.paused) {
						audio.play()
						playBtn.innerHTML = SVG_ICONS.pause
					} else {
						audio.pause()
						playBtn.innerHTML = SVG_ICONS.play
					}
				}
			})
			vn.appendChild(playBtn)
			vn.appendChild(waveform)
			vn.appendChild(dur)
			// Show transcription from the recording doc
			const recCached = recordingDocCache.get(msg.voiceUrl)
			if (recCached?.data?.transcription) {
				const txnText = document.createElement("div")
				txnText.style.cssText = "margin-top:4px;font-size:13px;color:var(--text-secondary);font-style:italic;padding-left:2px;"
				txnText.textContent = recCached.data.transcription
				vn.appendChild(txnText)
			} else {
				// Kick off loading the recording doc so we get transcription on next render
				resolveRecordingDoc(msg.voiceUrl)
			}
			setupDragSource(vn, msg.voiceUrl, "recording", "Voice note")
			parent.appendChild(vn)
		}
		if (msg.embeds) {
			for (let ei = 0; ei < msg.embeds.length; ei++) {
				const embed = msg.embeds[ei]
				const wrap = document.createElement("div")
				wrap.className = "chat-msg-embed"
				if (msg["embed_" + ei + "Width"])
					wrap.style.width = msg["embed_" + ei + "Width"] + "px"
				if (msg["embed_" + ei + "Height"])
					wrap.style.height = msg["embed_" + ei + "Height"] + "px"

				// Resolve tool override from chat doc (per-embed, keyed by msgId:embedIndex)
				// Falls back to toolId from the embed itself (e.g. from &tool= in tiny patchwork URL)
				const chatDoc = handle.doc()
				const overrideKey = msg.id + ":" + ei
				const toolId = chatDoc?.toolOverrides?.[overrideKey] || embed.toolId || ""

				const pvKey = (embed.docUrl || "") + "|" + (toolId || "")
				let pv = salvaged.get(pvKey)
				if (pv) {
					salvaged.delete(pvKey)
					// Use moveBefore to reattach without teardown/init cycle
					if (typeof wrap.moveBefore === "function") {
						wrap.moveBefore(pv, null)
					} else {
						wrap.appendChild(pv)
					}
				} else {
					pv = document.createElement("patchwork-view")
					pv.setAttribute("doc-url", embed.docUrl)
					if (toolId) pv.setAttribute("tool-id", toolId)
					wrap.appendChild(pv)
				}

				// Info bar under the embed
				const infobar = document.createElement("div")
				infobar.className = "chat-embed-infobar"

				// Title (if present)
				if (embed.title) {
					const titleEl = document.createElement("span")
					titleEl.className = "chat-msg-embed-title"
					titleEl.textContent = embed.title
					infobar.appendChild(titleEl)
				}

				// Tool pill (clickable → tool selector menu)
				const toolPill = document.createElement("span")
				toolPill.className = "chat-embed-pill clickable"
				toolPill.style.position = "relative"
				toolPill.title = "Change tool"
				const toolLabel = document.createElement("span")
				toolLabel.className = "chat-embed-pill-label"
				toolLabel.textContent = "tool"
				toolPill.appendChild(toolLabel)
				toolPill.appendChild(
					document.createTextNode(" " + (toolId || "default"))
				)
				toolPill.addEventListener("pointerdown", e => {
					e.stopPropagation()
				})
				toolPill.addEventListener("click", e => {
					e.stopPropagation()
					// Toggle existing menu
					const existing = toolPill.querySelector(".chat-embed-tool-menu")
					if (existing) { existing.remove(); return }

					const menu = document.createElement("div")
					menu.className = "chat-embed-tool-menu"

					function applyTool(newToolId) {
						handle.change(d => {
							if (!d.toolOverrides) d.toolOverrides = {}
							if (newToolId) d.toolOverrides[overrideKey] = newToolId
							else delete d.toolOverrides[overrideKey]
						})
						// Update the patchwork-view directly so it reloads immediately
						if (pv) {
							if (newToolId) pv.setAttribute("tool-id", newToolId)
							else pv.removeAttribute("tool-id")
						}
						menu.remove()
						document.removeEventListener("click", closeMenu, true)
						render()
					}

					// "default" option (clear override)
					const defaultBtn = document.createElement("button")
					defaultBtn.textContent = "default"
					if (!toolId) defaultBtn.className = "active"
					defaultBtn.addEventListener("click", ev => {
						ev.stopPropagation()
						applyTool("")
					})
					menu.appendChild(defaultBtn)

					// Load compatible tools for this doc's datatype
					;(async () => {
						try {
							const {getRegistry} = await import("@inkandswitch/patchwork-plugins")
							const toolReg = getRegistry("patchwork:tool")
							// Try to determine the doc's datatype from the embed or by loading the doc
							let docType = embed.type || ""
							if (!docType && embed.docUrl) {
								try {
									const dh = await window.repo.find(embed.docUrl)
									const dd = dh.doc()
									docType = dd?.["@patchwork"]?.type || ""
								} catch {}
							}
							const allTools = toolReg.all()
							for (const t of allTools) {
								if (!t.id || t.id === "default") continue
								const supports = t.supportedDatatypes
								const matches = supports === "*" || (Array.isArray(supports) && docType && supports.includes(docType))
								if (!matches) continue
								const btn = document.createElement("button")
								btn.textContent = t.id + (t.name && t.name !== t.id ? " (" + t.name + ")" : "")
								if (t.id === toolId) btn.className = "active"
								btn.addEventListener("click", ev => {
									ev.stopPropagation()
									applyTool(t.id)
								})
								menu.appendChild(btn)
							}
						} catch {}
					})()

					// Free-text input row at bottom
					const inputRow = document.createElement("div")
					inputRow.className = "tool-menu-input-row"
					const inp = document.createElement("input")
					inp.type = "text"
					inp.placeholder = "custom tool id"
					inp.value = toolId
					inp.addEventListener("pointerdown", e => e.stopPropagation())
					inp.addEventListener("click", e => e.stopPropagation())
					inp.addEventListener("keydown", ev => {
						ev.stopPropagation()
						if (ev.key === "Enter") {
							applyTool(inp.value.trim())
						} else if (ev.key === "Escape") {
							menu.remove()
							document.removeEventListener("click", closeMenu, true)
						}
					})
					inputRow.appendChild(inp)
					menu.appendChild(inputRow)

					toolPill.appendChild(menu)
					inp.focus()
					inp.select()

					// Close on outside click
					const closeMenu = ev => {
						if (!menu.contains(ev.target) && ev.target !== toolPill) {
							menu.remove()
							document.removeEventListener("click", closeMenu, true)
						}
					}
					setTimeout(() => document.addEventListener("click", closeMenu, true), 0)
				})
				infobar.appendChild(toolPill)

				// URL pill (clickable → copy menu)
				const urlPill = document.createElement("span")
				urlPill.className = "chat-embed-pill clickable"
				urlPill.style.position = "relative"
				urlPill.title = "Copy URL"
				const urlLabel = document.createElement("span")
				urlLabel.className = "chat-embed-pill-label"
				urlLabel.textContent = "url"
				urlPill.appendChild(urlLabel)
				// Show short doc ID
				const docIdShort =
					embed.docUrl.replace("automerge:", "").slice(0, 8) + "…"
				urlPill.appendChild(document.createTextNode(" " + docIdShort))
				urlPill.addEventListener("pointerdown", e => {
					e.stopPropagation()
				})
				urlPill.addEventListener("click", e => {
					e.stopPropagation()
					// Toggle menu
					const existing = urlPill.querySelector(".chat-embed-url-menu")
					if (existing) {
						existing.remove()
						return
					}
					const menu = document.createElement("div")
					menu.className = "chat-embed-url-menu"

					// Copy as tiny patchwork URL
					const tinyBtn = document.createElement("button")
					tinyBtn.textContent = "Copy tiny patchwork URL"
					tinyBtn.addEventListener("click", ev => {
						ev.stopPropagation()
						const params = new URLSearchParams()
						const docId = embed.docUrl.replace("automerge:", "")
						params.set("doc", docId)
						if (embed.title) params.set("title", embed.title)
						if (embed.type) params.set("type", embed.type)
						if (toolId) params.set("tool", toolId)
						const url =
							"https://tiny.patchwork.inkandswitch.com/#" + params.toString()
						navigator.clipboard.writeText(url).then(() => {
							tinyBtn.textContent = "Copied!"
							setTimeout(() => menu.remove(), 600)
						})
					})
					menu.appendChild(tinyBtn)

					// Copy as automerge URL
					const amBtn = document.createElement("button")
					amBtn.textContent = "Copy automerge URL"
					amBtn.addEventListener("click", ev => {
						ev.stopPropagation()
						navigator.clipboard.writeText(embed.docUrl).then(() => {
							amBtn.textContent = "Copied!"
							setTimeout(() => menu.remove(), 600)
						})
					})
					menu.appendChild(amBtn)

					urlPill.appendChild(menu)
					// Close on outside click
					const closeMenu = ev => {
						if (!menu.contains(ev.target)) {
							menu.remove()
							document.removeEventListener("click", closeMenu, true)
						}
					}
					setTimeout(
						() => document.addEventListener("click", closeMenu, true),
						0
					)
				})
				infobar.appendChild(urlPill)

				// Pin button — pin/unpin this embed in the sidebar
				const pinBtn = document.createElement("span")
				pinBtn.className =
					"chat-embed-pill clickable chat-embed-pin" +
					(isDocPinned(embed.docUrl) ? " pinned" : "")
				pinBtn.title = isDocPinned(embed.docUrl)
					? "Unpin from sidebar"
					: "Pin to sidebar"
				pinBtn.innerHTML = SVG_ICONS.pin || "\u{1F4CC}"
				pinBtn.addEventListener("pointerdown", e => e.stopPropagation())
				pinBtn.addEventListener("click", e => {
					e.stopPropagation()
					pinDoc(
						embed.docUrl,
						toolId || embed.type || "default",
						embed.title || "Pinned doc"
					)
				})
				infobar.appendChild(pinBtn)

				wrap.appendChild(infobar)
				setupDragSource(wrap, embed.docUrl, embed.type || "embed", embed.title || "Embed", toolId)
				makeResizable(wrap, msg, "embed_" + ei)
				parent.appendChild(wrap)
			}
		}
		if (msg.files) {
			for (const file of msg.files) {
				const mime = file.mimeType || ""
				if (mime.startsWith("image/")) {
					const wrap = document.createElement("div")
					wrap.className = "chat-msg-image-wrap"
					wrap.style.width = "350px"
					const img = document.createElement("img")
					img.className = "chat-msg-image"
					img.alt = file.name || "image"
					loadBlobUrl(file.url).then(u => {
						if (u) img.src = u
					})
					img.addEventListener("load", () => {
						const atBottom =
							messagesArea.scrollHeight -
								messagesArea.scrollTop -
								messagesArea.clientHeight <
							80
						if (atBottom) messagesArea.scrollTop = messagesArea.scrollHeight
					})
					img.addEventListener("click", () => {
						if (img.src) openLightbox(img.src, "image")
					})
					wrap.appendChild(img)
					setupDragSource(wrap, file.url, "file", file.name || "image")
					parent.appendChild(wrap)
				} else if (mime.startsWith("video/")) {
					const wrap = document.createElement("div")
					wrap.className = "chat-msg-video-wrap"
					const vid = document.createElement("video")
					vid.className = "chat-msg-video"
					vid.controls = true
					vid.preload = "metadata"
					loadBlobUrl(file.url).then(u => {
						if (u) vid.src = u
					})
					vid.addEventListener("click", e => {
						if (e.target.paused !== undefined && !e.target.paused) return // don't hijack play/pause clicks
						if (vid.src) openLightbox(vid.src, "video")
					})
					wrap.appendChild(vid)
					setupDragSource(wrap, file.url, "file", file.name || "video")
					parent.appendChild(wrap)
				} else if (mime.startsWith("audio/")) {
					const aud = document.createElement("audio")
					aud.controls = true
					aud.preload = "metadata"
					aud.style.marginTop = "4px"
					loadBlobUrl(file.url).then(u => {
						if (u) aud.src = u
					})
					setupDragSource(aud, file.url, "file", file.name || "audio")
					parent.appendChild(aud)
				} else {
					const link = document.createElement("a")
					link.className = "chat-msg-file"
					link.title = file.name || "file"
					const icon = document.createElement("span")
					icon.className = "chat-msg-file-icon"
					icon.innerHTML = SVG_ICONS.file
					link.appendChild(icon)
					link.appendChild(document.createTextNode(file.name || "file"))
					loadBlobUrl(file.url).then(u => {
						if (u) {
							link.href = u
							link.download = file.name || "file"
						}
					})
					setupDragSource(link, file.url, "file", file.name || "file")
					parent.appendChild(link)
				}
			}
		}
	}

	function renderReactions(parent, msg, idx, emoticonBlobUrls) {
		if (!msg.reactions || Object.keys(msg.reactions).length === 0) return
		const container = document.createElement("div")
		container.className = "chat-reactions"
		for (const [emoji, names] of Object.entries(msg.reactions)) {
			if (!names || names.length === 0) continue
			const el = document.createElement("span")
			el.className = "chat-reaction" + (names.includes(myName) ? " mine" : "")
			el.title = names.join(", ")
			const emoticonMatch = emoji.match(/^:([a-zA-Z0-9_-]+):$/)
			if (
				emoticonMatch &&
				emoticonBlobUrls &&
				emoticonBlobUrls[emoticonMatch[1]]
			) {
				const img = document.createElement("img")
				img.className = "chat-emoticon-inline"
				img.src = emoticonBlobUrls[emoticonMatch[1]]
				img.alt = emoji
				img.title = emoji
				el.appendChild(img)
				el.appendChild(document.createTextNode(" "))
			} else {
				el.appendChild(document.createTextNode(emoji + " "))
			}
			const count = document.createElement("span")
			count.className = "chat-reaction-count"
			count.textContent = names.length
			el.appendChild(count)
			el.addEventListener("click", e => {
				e.stopPropagation()
				toggleReaction(idx, emoji)
			})
			container.appendChild(el)
		}
		const addBtn = document.createElement("button")
		addBtn.className = "chat-reaction-add"
		addBtn.innerHTML = SVG_ICONS.plus
		addBtn.addEventListener("click", e => {
			e.stopPropagation()
			openEmojiPicker(idx, addBtn)
		})
		container.appendChild(addBtn)
		parent.appendChild(container)
	}

	render()

	// ============================================================================
	// SIDEBAR
	// ============================================================================

	function updateSidebarVisibility() {
		const doc = handle.doc()
		const hasPinned = doc?.docs?.some(d => d.pin)
		if (hasPinned) {
			sidebar.classList.add("visible")
		} else {
			sidebar.classList.remove("visible")
			sidebar.classList.remove("collapsed")
		}
	}

	// ---- Check if call module is available (for phone button) ----
	let callModuleAvailable = false
	async function checkCallModule() {
		try {
			const {getRegistry} = await import("@inkandswitch/patchwork-plugins")
			const toolReg = getRegistry("patchwork:tool")
			callModuleAvailable = toolReg.has("call-titlebar")
			if (!callModuleAvailable) {
				// Also check with broader match in case the id differs
				const all = toolReg.all()
				callModuleAvailable = all.some(t => t.id?.includes("call"))
			}
		} catch {
			// If we can't check, assume available and let startCall handle errors
			callModuleAvailable = true
		}
		phoneBtn.style.display = callModuleAvailable ? "" : "none"
	}
	checkCallModule()

	async function startCall() {
		if (!callModuleAvailable) {
			updateLLMStatus("Call module not available — enable the Call titlebar tool first")
			setTimeout(() => updateLLMStatus(""), 3000)
			return
		}

		// Check if chat already has a call doc
		const doc = handle.doc()
		let callUrl = doc?.callUrl
		const repo = window.repo

		if (!callUrl) {
			// Create a new call doc
			const callHandle = await repo.create2({title: (doc?.title || "Chat") + " Call", content: ""})
			callUrl = callHandle.url
			handle.change(d => {
				d.callUrl = callUrl
			})
		}

		// Pin the call doc with the telephone tool in the sidebar
		if (!isDocPinned(callUrl)) {
			pinDoc(callUrl, "telephone", (doc?.title || "Chat") + " Call")
		} else {
			sidebar.classList.add("visible")
		}
	}

	// ============================================================================
	// SIDEBAR: Pinned Docs (iframe rendering + log capture)
	// ============================================================================

	function renderPinnedDocs() {
		const doc = handle.doc()
		const pinned = (doc?.docs || []).filter(d => d.pin)
		const currentUrls = new Set(pinned.map(d => d.url))

		// Remove iframes for unpinned docs
		for (const [url, iframe] of pinnedIframes) {
			if (!currentUrls.has(url)) {
				iframe.remove()
				pinnedIframes.delete(url)
				pinnedDocLogs.delete(url)
			}
		}

		// Add iframes for newly pinned docs
		for (const dl of pinned) {
			if (pinnedIframes.has(dl.url)) continue
			const wrap = document.createElement("div")
			wrap.className = "chat-sidebar-pinned-wrap"

			// Make draggable for reorder + cross-tool DnD
			setupDragSource(wrap, dl.url, dl.type, dl.name, dl.pin)
			wrap.addEventListener("dragstart", () => wrap.classList.add("dragging"))
			wrap.addEventListener("dragend", () => wrap.classList.remove("dragging"))

			// Drop zone for reorder
			wrap.addEventListener("dragover", e => {
				e.preventDefault()
				e.stopPropagation()
				if (!hasPatchworkDrop(e.dataTransfer) && !e.dataTransfer?.types?.includes("Files")) return
				const rect = wrap.getBoundingClientRect()
				const mid = rect.top + rect.height / 2
				wrap.setAttribute("data-drop-position", e.clientY < mid ? "above" : "below")
			})
			wrap.addEventListener("dragleave", () => {
				wrap.removeAttribute("data-drop-position")
			})
			wrap.addEventListener("drop", e => {
				e.preventDefault()
				e.stopPropagation()
				dragCounter = 0
				dropOverlay.classList.remove("show")
				const pos = wrap.getAttribute("data-drop-position")
				wrap.removeAttribute("data-drop-position")
				const items = parsePatchworkDrop(e.dataTransfer)
				if (!items || !items.length) return
				const doc = handle.doc()
				const allDocs = doc?.docs || []
				for (const item of items) {
					if (!item.url) continue
					const sourceIdx = allDocs.findIndex(d => d.url === item.url && d.pin)
					const targetIdx = allDocs.findIndex(d => d.url === dl.url)
					if (sourceIdx >= 0 && targetIdx >= 0 && sourceIdx !== targetIdx) {
						// Reorder: move source to target position
						handle.change(d => {
							const [moved] = d.docs.splice(sourceIdx, 1)
							const newTargetIdx = d.docs.findIndex(dd => dd.url === dl.url)
							const insertIdx = pos === "below" ? newTargetIdx + 1 : newTargetIdx
							d.docs.splice(insertIdx, 0, moved)
						})
					} else if (sourceIdx < 0) {
						// New item — pin it at the target position
						handle.change(d => {
							if (!d.docs) d.docs = []
							const existing = d.docs.find(dd => dd.url === item.url)
							if (existing) {
								existing.pin = item.toolId || "default"
								if (item.name) existing.name = item.name
							} else {
								const newDoc = {
									url: item.url,
									type: item.type || "unknown",
									name: item.name || "doc",
									pin: item.toolId || "default",
								}
								const ti = d.docs.findIndex(dd => dd.url === dl.url)
								const ii = pos === "below" ? ti + 1 : ti
								d.docs.splice(ii, 0, newDoc)
							}
						})
					}
				}
				renderPinnedDocs()
				updateSidebarVisibility()
			})

			// Build URL params for the iframe
			const urlParams = new URLSearchParams()
			const {documentId, heads} = parseAutomergeUrl(dl.url)
			urlParams.set("doc", documentId)
			if (dl.name) urlParams.set("title", dl.name)
			if (dl.type) urlParams.set("type", dl.type)
			if (dl.pin) urlParams.set("frame", dl.pin)
			if (heads) urlParams.set("heads", heads.join("|"))

			// Toolbar with action buttons
			const toolbar = document.createElement("div")
			toolbar.className = "chat-sidebar-pinned-toolbar"

			// Open in new tab (as tool, not frame)
			const openTabBtn = document.createElement("button")
			openTabBtn.title = "Open in new tab"
			openTabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>'
			openTabBtn.addEventListener("click", e => {
				e.stopPropagation()
				const tabParams = new URLSearchParams(urlParams)
				// Replace frame= with tool=
				const frameVal = tabParams.get("frame")
				tabParams.delete("frame")
				if (frameVal) tabParams.set("tool", frameVal)
				window.open("/#" + tabParams.toString(), "_blank")
			})
			toolbar.appendChild(openTabBtn)

			// Open as frame in new tab
			const openFrameBtn = document.createElement("button")
			openFrameBtn.title = "Open as frame in new tab"
			openFrameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
			openFrameBtn.addEventListener("click", e => {
				e.stopPropagation()
				window.open("/#" + urlParams.toString(), "_blank")
			})
			toolbar.appendChild(openFrameBtn)

			// Fullscreen
			const fullscreenBtn = document.createElement("button")
			fullscreenBtn.title = "Fullscreen"
			fullscreenBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
			fullscreenBtn.addEventListener("click", e => {
				e.stopPropagation()
				const iframe = wrap.querySelector("iframe")
				if (iframe?.requestFullscreen) iframe.requestFullscreen()
				else if (iframe?.webkitRequestFullscreen) iframe.webkitRequestFullscreen()
			})
			toolbar.appendChild(fullscreenBtn)

			// Refresh
			const refreshBtn = document.createElement("button")
			refreshBtn.title = "Refresh"
			refreshBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>'
			refreshBtn.addEventListener("click", e => {
				e.stopPropagation()
				const iframe = wrap.querySelector("iframe")
				if (iframe?.contentWindow) iframe.contentWindow.location.reload()
			})
			toolbar.appendChild(refreshBtn)

			// Unpin
			const unpinBtn = document.createElement("button")
			unpinBtn.title = "Unpin"
			unpinBtn.textContent = "✕"
			unpinBtn.addEventListener("click", e => {
				e.stopPropagation()
				pinDoc(dl.url) // toggles pin off
			})
			toolbar.appendChild(unpinBtn)

			wrap.appendChild(toolbar)

			const iframe = document.createElement("iframe")
			iframe.src = "/#" + urlParams.toString()
			iframe.title = dl.name || "Pinned doc"
			wrap.appendChild(iframe)
			sidebarPinned.appendChild(wrap)
			pinnedIframes.set(dl.url, wrap)

			// Capture console logs from iframe + handle patchwork:no-tool
			iframe.addEventListener("load", () => {
				try {
					const win = iframe.contentWindow
					if (!win) return
					// Handle patchwork:no-tool so dynamically created tools get loaded
					win.addEventListener("patchwork:no-tool", (event) => {
						if (win.patchwork?.modules?.loadSuggestedImportUrl) {
							win.patchwork.modules.loadSuggestedImportUrl(event.detail.url)
						}
					})
					const logs = []
					pinnedDocLogs.set(dl.url, logs)
					const origLog = win.console.log
					const origError = win.console.error
					const origWarn = win.console.warn
					win.console.log = (...args) => {
						logs.push({level: "log", args: args.map(String), ts: Date.now()})
						origLog.apply(win.console, args)
					}
					win.console.error = (...args) => {
						logs.push({level: "error", args: args.map(String), ts: Date.now()})
						origError.apply(win.console, args)
					}
					win.console.warn = (...args) => {
						logs.push({level: "warn", args: args.map(String), ts: Date.now()})
						origWarn.apply(win.console, args)
					}
					win.onerror = (msg, src, line, col) => {
						logs.push({
							level: "error",
							args: [String(msg), `${src}:${line}:${col}`],
							ts: Date.now(),
						})
					}
				} catch (e) {
					// Cross-origin iframe — can't capture logs
				}
			})
		}
	}

	function pinDoc(url, toolId, name) {
		handle.change(d => {
			if (!d.docs) d.docs = []
			const existing = d.docs.find(dl => dl.url === url)
			if (existing) {
				if (existing.pin) {
					delete existing.pin // unpin
				} else {
					existing.pin = toolId || "default"
				}
			} else {
				d.docs.push({
					url,
					type: "unknown",
					name: name || "doc",
					pin: toolId || "default",
				})
			}
		})
		renderPinnedDocs()
		updateSidebarVisibility()
	}

	function isDocPinned(url) {
		const doc = handle.doc()
		return doc?.docs?.some(d => d.url === url && d.pin)
	}

	// ============================================================================
	// LLM Interface (SharedWorker + provider abstraction)
	// ============================================================================

	function updateLLMStatus(message) {
		sidebarStatus.textContent = message
		if (!message) sidebarStatus.style.display = "none"
		else sidebarStatus.style.display = ""
	}

	let llmWorker = null
	async function initLLMWorker() {
		if (llmWorker) return
		try {
			const workerUrl = new URL("./llm-worker.js", import.meta.url)
			console.log("[Chat] LLM worker URL:", workerUrl.href)
			// Use direct URL so the worker has a real origin (needed for Cache API / model caching)
			// Blob URLs get an opaque origin where caches.open() is unavailable
			try {
				llmWorker = new Worker(workerUrl, {type: "module"})
				console.log("[Chat] Worker created (direct URL)")
			} catch (directErr) {
				console.warn("[Chat] Direct Worker failed, trying blob:", directErr)
				const res = await fetch(workerUrl)
				const src = await res.text()
				const blob = new Blob([src], {type: "application/javascript"})
				llmWorker = new Worker(URL.createObjectURL(blob), {type: "module"})
				console.log("[Chat] Worker created (blob URL — caching may not work)")
			}
			llmWorker.onerror = e => {
				const errMsg = e.message || e.filename
					? `${e.message || "error"} (${e.filename || "?"}:${e.lineno || "?"}:${e.colno || "?"})`
					: "Worker crashed (no details)"
				console.error("[Chat] Worker error:", errMsg, e)
				// Reject all pending callbacks
				for (const [id, cb] of llmCallbacks) {
					cb.reject(new Error(errMsg))
				}
				llmCallbacks.clear()
			}
			llmWorker.onmessage = e => {
				const msg = e.data
				console.log("[Chat] LLM msg:", msg.type, msg.type === "status" ? msg.message : "")
				if (msg.type === "ready") {
					llmReady = true
					updateLLMStatus("")
				} else if (msg.type === "result") {
					const cb = llmCallbacks.get(msg.id)
					if (cb) {
						cb.resolve(msg.text)
						llmCallbacks.delete(msg.id)
					}
				} else if (msg.type === "token") {
					const cb = llmCallbacks.get(msg.id)
					if (cb?.onToken) cb.onToken(msg.text)
				} else if (msg.type === "error") {
					console.error("[Chat] LLM error:", msg.message)
					updateLLMStatus(msg.message)
					if (computerActive) sendComputerMessage("LLM error: " + msg.message)
					const cb = llmCallbacks.get(msg.id)
					if (cb) {
						cb.reject(new Error(msg.message))
						llmCallbacks.delete(msg.id)
					}
				} else if (msg.type === "status") {
					updateLLMStatus(msg.message)
				}
			}
			console.log("[Chat] LLM worker ready, waiting for messages...")
		} catch (err) {
			console.error("[Chat] LLM Worker init failed:", err)
			updateLLMStatus("LLM init failed: " + (err.message || err))
		}
	}

	function getActiveProvider() {
		if (!chatProfileHandle) return "local"
		const profile = chatProfileHandle.doc()
		return profile?.llmProvider || "local"
	}

	function setLLMProvider(provider) {
		if (!chatProfileHandle) return
		chatProfileHandle.change(d => {
			d.llmProvider = provider
		})
		updateLLMStatus("Provider: " + provider)
		setTimeout(() => updateLLMStatus(""), 2000)
	}

	// Flatten multipart content messages to plain text (for models that don't support vision)
	function flattenMessagesForText(messages) {
		return messages.map(m => {
			if (Array.isArray(m.content)) {
				const text = m.content
					.filter(p => p.type === "text")
					.map(p => p.text)
					.join("\n")
				const hasImage = m.content.some(p => p.type === "image_url")
				return {...m, content: text + (hasImage ? "\n[Image attached]" : "")}
			}
			return m
		})
	}

	async function generateLLM(messages, onToken, signal) {
		const provider = getActiveProvider()
		if (provider === "openrouter") return generateOpenRouter(messages, onToken, signal)
		if (provider === "ollama") return generateOllama(messages, onToken, signal)
		return generateLocal(flattenMessagesForText(messages), onToken, signal)
	}

	async function generateLocal(messages, onToken, signal) {
		if (!llmWorker) await initLLMWorker()
		if (!llmWorker) throw new Error("LLM not available")
		const id = generateId()
		return new Promise((resolve, reject) => {
			llmCallbacks.set(id, {resolve, reject, onToken})
			llmWorker.postMessage({type: "generate", id, messages})
			setTimeout(() => {
				if (llmCallbacks.has(id)) {
					llmCallbacks.delete(id)
					reject(new Error("LLM timeout (5 min) — model may still be compiling, try again"))
				}
			}, 300000)
		})
	}

	async function generateOpenRouter(messages, onToken, signal) {
		if (!chatProfileHandle) throw new Error("No chat profile")
		const profile = chatProfileHandle.doc()
		const apiKey = profile?.openrouterApiKey
		if (!apiKey) throw new Error("No OpenRouter API key. Use /openrouter to set one.")
		const model = profile?.openrouterModel || "anthropic/claude-sonnet-4"
		updateLLMStatus("Thinking…")
		try {
			const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Authorization": "Bearer " + apiKey,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					messages,
					stream: true,
				}),
				signal,
			})
			if (!res.ok) {
				const err = await res.text()
				throw new Error("OpenRouter: " + err)
			}
			let full = ""
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ""
			while (true) {
				const {done, value} = await reader.read()
				if (done) break
				buf += decoder.decode(value, {stream: true})
				const lines = buf.split("\n")
				buf = lines.pop()
				for (const line of lines) {
					if (!line.startsWith("data: ")) continue
					const data = line.slice(6).trim()
					if (data === "[DONE]") continue
					try {
						const parsed = JSON.parse(data)
						const delta = parsed.choices?.[0]?.delta?.content
						if (delta) {
							full += delta
							if (onToken) onToken(full)
						}
					} catch {}
				}
			}
			return full
		} finally {
			updateLLMStatus("")
		}
	}

	async function generateOllama(messages, onToken, signal) {
		if (!chatProfileHandle) throw new Error("No chat profile")
		const profile = chatProfileHandle.doc()
		const model = profile?.ollamaModel || "llama3.2"
		const url = profile?.ollamaUrl || "http://localhost:11434"
		updateLLMStatus("Thinking…")
		try {
			const res = await fetch(url + "/api/chat", {
				method: "POST",
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({
					model,
					messages,
					stream: true,
				}),
				signal,
			})
			if (!res.ok) throw new Error("Ollama: " + (await res.text()))
			let full = ""
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ""
			while (true) {
				const {done, value} = await reader.read()
				if (done) break
				buf += decoder.decode(value, {stream: true})
				const lines = buf.split("\n")
				buf = lines.pop()
				for (const line of lines) {
					if (!line.trim()) continue
					try {
						const parsed = JSON.parse(line)
						const content = parsed.message?.content
						if (content) {
							full += content
							if (onToken) onToken(full)
						}
					} catch {}
				}
			}
			return full
		} finally {
			updateLLMStatus("")
		}
	}

	// ---- Provider dialogs ----

	function showModelDialog() {
		emojiPicker.innerHTML = ""
		emojiPickerTarget = null

		const dialog = document.createElement("div")
		dialog.className = "chat-font-dialog"
		dialog.style.minWidth = "280px"

		const title = document.createElement("div")
		title.style.cssText = "font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;"
		title.textContent = "Model Settings"
		dialog.appendChild(title)

		const profile = chatProfileHandle?.doc()
		const current = getActiveProvider()

		// --- Tab buttons ---
		const tabs = document.createElement("div")
		tabs.style.cssText = "display:flex;gap:4px;margin-bottom:8px;"
		dialog.appendChild(tabs)

		const providers = [
			{id: "local", label: "Local"},
			{id: "openrouter", label: "OpenRouter"},
			{id: "ollama", label: "Ollama"},
		]

		let activeTab = current
		const sections = {}
		const tabBtns = {}

		for (const p of providers) {
			const btn = document.createElement("button")
			btn.style.cssText = "flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-mid);color:var(--text-primary);cursor:pointer;font-size:12px;font-weight:500;"
			btn.textContent = p.label
			tabBtns[p.id] = btn
			btn.addEventListener("click", ev => {
				ev.stopPropagation()
				activeTab = p.id
				updateTabs()
			})
			tabs.appendChild(btn)
		}

		function updateTabs() {
			for (const p of providers) {
				tabBtns[p.id].style.borderColor = p.id === activeTab ? "var(--accent)" : "var(--border)"
				tabBtns[p.id].style.background = p.id === activeTab ? "var(--bg-hover)" : "var(--bg-mid)"
				if (sections[p.id]) sections[p.id].style.display = p.id === activeTab ? "" : "none"
			}
		}

		// --- Local section ---
		const localSection = document.createElement("div")
		localSection.style.cssText = "padding:8px 0;"
		const localInfo = document.createElement("div")
		localInfo.style.cssText = "font-size:12px;color:var(--text-muted);"
		localInfo.textContent = "Phi-3.5 mini — runs in-browser via WebGPU"
		localSection.appendChild(localInfo)
		dialog.appendChild(localSection)
		sections.local = localSection

		// --- OpenRouter section ---
		const orSection = document.createElement("div")
		orSection.style.cssText = "padding:4px 0;"

		const MODEL_DISPLAY_NAMES = {
			"google/gemini-2.5-flash-preview": "Gemini 2.5 Flash",
			"google/gemini-3.1-flash-lite-preview": "ben's new model",
			"google/gemini-3.1-flash-lite": "ben's new model",
		}

		const keyLabel = document.createElement("div")
		keyLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:2px;"
		keyLabel.textContent = "API Key"
		orSection.appendChild(keyLabel)

		const keyInput = document.createElement("input")
		keyInput.type = "password"
		keyInput.placeholder = "sk-or-v1-..."
		keyInput.value = profile?.openrouterApiKey || ""
		keyInput.style.cssText = "width:100%;box-sizing:border-box;"
		orSection.appendChild(keyInput)

		const modelLabel = document.createElement("div")
		modelLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-top:6px;margin-bottom:2px;"
		modelLabel.textContent = "Model"
		orSection.appendChild(modelLabel)

		const modelSelect = document.createElement("select")
		modelSelect.style.cssText = "width:100%;box-sizing:border-box;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;"
		orSection.appendChild(modelSelect)

		const currentModel = profile?.openrouterModel || "anthropic/claude-sonnet-4"
		const placeholderOpt = document.createElement("option")
		placeholderOpt.value = currentModel
		placeholderOpt.textContent = MODEL_DISPLAY_NAMES[currentModel] || currentModel
		placeholderOpt.selected = true
		modelSelect.appendChild(placeholderOpt)

		function fetchModels(apiKey) {
			if (!apiKey) return
			const lo = document.createElement("option")
			lo.disabled = true
			lo.textContent = "Loading models…"
			modelSelect.innerHTML = ""
			modelSelect.appendChild(lo)
			fetch("https://openrouter.ai/api/v1/models", {
				headers: { "Authorization": "Bearer " + apiKey },
			}).then(r => r.json()).then(data => {
				modelSelect.innerHTML = ""
				const models = (data.data || [])
					.sort((a, b) => (a.id || "").localeCompare(b.id || ""))
				for (const m of models) {
					const opt = document.createElement("option")
					opt.value = m.id
					opt.textContent = MODEL_DISPLAY_NAMES[m.id] || m.name || m.id
					if (m.id === currentModel) opt.selected = true
					modelSelect.appendChild(opt)
				}
			}).catch(() => {
				modelSelect.innerHTML = ""
				const fallback = document.createElement("option")
				fallback.value = currentModel
				fallback.textContent = currentModel
				modelSelect.appendChild(fallback)
			})
		}

		// Initial fetch
		fetchModels(keyInput.value.trim() || profile?.openrouterApiKey)

		keyInput.addEventListener("change", () => {
			const k = keyInput.value.trim()
			if (k) fetchModels(k)
		})

		dialog.appendChild(orSection)
		sections.openrouter = orSection

		// --- Ollama section ---
		const ollamaSection = document.createElement("div")
		ollamaSection.style.cssText = "padding:4px 0;"

		const ollamaUrlLabel = document.createElement("div")
		ollamaUrlLabel.style.cssText = "font-size:11px;color:var(--text-muted);margin-bottom:2px;"
		ollamaUrlLabel.textContent = "URL"
		ollamaSection.appendChild(ollamaUrlLabel)

		const urlInput = document.createElement("input")
		urlInput.type = "text"
		urlInput.placeholder = "http://localhost:11434"
		urlInput.value = profile?.ollamaUrl || "http://localhost:11434"
		urlInput.style.cssText = "width:100%;box-sizing:border-box;"
		ollamaSection.appendChild(urlInput)

		const statusDiv = document.createElement("div")
		statusDiv.style.cssText = "font-size:11px;color:var(--text-muted);margin:4px 0;min-height:16px;"
		statusDiv.textContent = "Probing…"
		ollamaSection.appendChild(statusDiv)

		const modelList = document.createElement("div")
		modelList.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;"
		ollamaSection.appendChild(modelList)

		let selectedOllamaModel = profile?.ollamaModel || ""

		async function probeOllama() {
			const base = urlInput.value.trim() || "http://localhost:11434"
			statusDiv.textContent = "Probing " + base + "…"
			modelList.innerHTML = ""
			try {
				const res = await fetch(base + "/api/tags")
				if (!res.ok) throw new Error("HTTP " + res.status)
				const data = await res.json()
				const models = (data.models || []).map(m => m.name)
				if (models.length === 0) {
					statusDiv.textContent = "No models found. Run `ollama pull llama3.2` first."
					return
				}
				statusDiv.textContent = models.length + " model(s) found:"
				for (const m of models) {
					const btn = document.createElement("button")
					btn.style.cssText = "padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-mid);color:var(--text-primary);cursor:pointer;font-size:11px;"
					btn.textContent = m
					if (m === selectedOllamaModel) btn.style.borderColor = "var(--accent)"
					btn.addEventListener("click", ev => {
						ev.stopPropagation()
						selectedOllamaModel = m
						for (const c of modelList.children) c.style.borderColor = "var(--border)"
						btn.style.borderColor = "var(--accent)"
					})
					modelList.appendChild(btn)
				}
			} catch (err) {
				statusDiv.innerHTML = "Could not connect: " + escapeHtml(err.message) + "<br><span style='font-size:10px;opacity:0.7;'>Try: OLLAMA_ORIGINS=* ollama serve</span>"
			}
		}
		probeOllama()
		urlInput.addEventListener("change", probeOllama)

		dialog.appendChild(ollamaSection)
		sections.ollama = ollamaSection

		// --- Set initial tab visibility ---
		updateTabs()

		// --- Buttons ---
		const btns = document.createElement("div")
		btns.className = "chat-font-dialog-btns"
		btns.style.marginTop = "8px"

		const cancelBtn = document.createElement("button")
		cancelBtn.className = "cancel-btn"
		cancelBtn.textContent = "Cancel"
		cancelBtn.addEventListener("click", ev => { ev.stopPropagation(); closeEmojiPicker() })

		const clearBtn = document.createElement("button")
		clearBtn.className = "cancel-btn"
		clearBtn.textContent = "Clear"
		clearBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			if (chatProfileHandle) {
				chatProfileHandle.change(d => {
					delete d.openrouterApiKey
					delete d.openrouterModel
					delete d.ollamaUrl
					delete d.ollamaModel
					d.llmProvider = "local"
				})
			}
			closeEmojiPicker()
			updateLLMStatus("Cleared — using local model")
			setTimeout(() => updateLLMStatus(""), 2000)
		})

		const saveBtn = document.createElement("button")
		saveBtn.className = "save-btn"
		saveBtn.textContent = "Save"
		saveBtn.addEventListener("click", ev => {
			ev.stopPropagation()
			if (!chatProfileHandle) return
			chatProfileHandle.change(d => {
				d.llmProvider = activeTab
				if (activeTab === "openrouter") {
					const key = keyInput.value.trim()
					if (key) d.openrouterApiKey = key
					d.openrouterModel = modelSelect.value || "anthropic/claude-sonnet-4"
				} else if (activeTab === "ollama") {
					d.ollamaUrl = urlInput.value.trim() || "http://localhost:11434"
					if (selectedOllamaModel) d.ollamaModel = selectedOllamaModel
				}
			})
			closeEmojiPicker()
			let statusMsg = "Provider: " + activeTab
			if (activeTab === "openrouter") statusMsg += " (" + (modelSelect.value || "anthropic/claude-sonnet-4") + ")"
			if (activeTab === "ollama") statusMsg += " (" + (selectedOllamaModel || "?") + ")"
			updateLLMStatus(statusMsg)
			setTimeout(() => updateLLMStatus(""), 3000)
		})

		btns.appendChild(cancelBtn)
		btns.appendChild(clearBtn)
		btns.appendChild(saveBtn)
		dialog.appendChild(btns)

		emojiPicker.appendChild(dialog)
		emojiPicker.style.bottom = "60px"
		emojiPicker.style.top = "auto"
		emojiPicker.style.right = "16px"
		emojiPicker.style.left = "auto"
		emojiOverlay.classList.add("show")
		if (activeTab === "openrouter") keyInput.focus()
	}

	// ============================================================================
	// /invite computer — LLM as chat participant
	// ============================================================================

	// Cute random names for computer-generated tools
	const TOOL_ADJECTIVES = [
		"tiny",
		"sparkly",
		"cozy",
		"fuzzy",
		"wiggly",
		"bouncy",
		"snappy",
		"zippy",
		"dizzy",
		"poppy",
		"bubbly",
		"chirpy",
		"jolly",
		"perky",
		"zappy",
		"scruffy",
	]
	const TOOL_NOUNS = [
		"kitten",
		"bunny",
		"otter",
		"panda",
		"robin",
		"gecko",
		"ferret",
		"hedgehog",
		"hamster",
		"duckling",
		"fawn",
		"cub",
		"owlet",
		"piglet",
		"lamb",
		"angel",
		"ermine",
	]
	function randomToolName() {
		const adj =
			TOOL_ADJECTIVES[Math.floor(Math.random() * TOOL_ADJECTIVES.length)]
		const noun = TOOL_NOUNS[Math.floor(Math.random() * TOOL_NOUNS.length)]
		return adj + "-" + noun
	}

	const COMPUTER_SYSTEM_PROMPT = `You are Computer, an AI assistant participating in a Patchwork collaborative chat.

IMPORTANT: Never prefix your messages with [Computer] or your name. Other users' messages are shown as [Name] message but that's just context formatting — you must NOT imitate it. Just respond naturally with your message content.

## What You Can Do
- Answer questions and have conversations
- Build interactive Patchwork tools (vanilla JS mini-apps that run in the browser)
- Read and edit Automerge documents directly
- Inspect pinned tools (iframes) for errors and DOM state
- Run code inside pinned tool iframes

## Patchwork Architecture
Patchwork is a collaborative document system built on Automerge (JSON-like CRDTs synced peer-to-peer).

Key concepts:
- \`const handle = await window.repo.find("automerge:XXXXX")\` — find a document by URL
- \`handle.doc()\` — read current document state (synchronous, returns snapshot)
- \`handle.change(doc => { doc.field = value })\` — mutate document
- \`handle.on("change", fn)\` — listen for local and remote changes
- \`import { splice } from "@automerge/automerge"\` — use splice for efficient text edits on collaborative strings
- Documents sync automatically across peers via Automerge

## Tools
You have access to tools. To use a tool, output a fenced block tagged \`\`\`tool-call:
\`\`\`tool-call
tool: tool_name
arg1: value1
arg2: value2
\`\`\`

After you use a tool, you'll receive the result and can continue reasoning. You can use multiple tools in sequence.

Available tools:

### read_doc
Read the contents of an Automerge document.
\`\`\`tool-call
tool: read_doc
url: automerge:XXXXX
\`\`\`

### edit_doc
Edit an Automerge document by setting a field. The value is parsed as JSON.
\`\`\`tool-call
tool: edit_doc
url: automerge:XXXXX
field: title
value: "New Title"
\`\`\`

### inspect_iframe
Get the DOM HTML and any console errors from a pinned tool iframe.
\`\`\`tool-call
tool: inspect_iframe
url: automerge:XXXXX
\`\`\`

### eval_in_iframe
Run JavaScript code inside a pinned tool's iframe and get the result.
\`\`\`tool-call
tool: eval_in_iframe
url: automerge:XXXXX
code: document.querySelector('.my-element')?.textContent
\`\`\`

When you need information before answering (e.g. checking what a doc contains, or inspecting an error), use a tool first. After receiving the tool result, respond to the user.

## Building a Patchwork Tool
When asked to build something, output the COMPLETE JavaScript module in a fenced code block tagged \`\`\`patchwork-tool.

Your tool MUST export these three things:

1. **Datatype** — manages document lifecycle:
\`\`\`js
export const MyDatatype = {
  init(doc) { doc.title = "My Tool"; /* set defaults */ },
  getTitle(doc) { return doc.title || "My Tool"; },
  setTitle(doc, title) { doc.title = title; },
};
\`\`\`

2. **Tool function** — renders UI, returns cleanup:
\`\`\`js
export function Tool(handle, element) {
  const style = document.createElement("style");
  style.textContent = \\\`.prefix-container { ... }\\\`;
  element.appendChild(style);
  const container = document.createElement("div");
  container.className = "prefix-container";
  element.appendChild(container);

  function render() {
    const doc = handle.doc();
    if (!doc) return;
    container.innerHTML = "";
    // Build UI with DOM APIs, attach click handlers that call handle.change()
  }
  render();
  handle.on("change", render);
  return () => { handle.off("change", render); container.remove(); style.remove(); };
}
\`\`\`

3. **plugins array** — registers both:
\`\`\`js
export const plugins = [
  { type: "patchwork:datatype", id: "TOOL_ID", name: "TOOL_NAME", async load() { return MyDatatype; } },
  { type: "patchwork:tool", id: "TOOL_ID", name: "TOOL_NAME", supportedDatatypes: ["TOOL_ID"], async load() { return Tool; } },
];
\`\`\`

Rules:
- Use vanilla DOM APIs only (createElement, innerHTML, etc.) — NO frameworks
- Scope ALL CSS classes with a unique prefix to avoid conflicts
- The tool id and datatype id MUST match
- Keep it self-contained in one file
- Automerge docs cannot contain \`undefined\` — use \`null\` or \`delete\`
- Strings in Automerge are collaborative text; use \`splice()\` for efficient editing, or just assign for simple values

## Updating Files
When you update files in a tool folder (e.g. updating JS source via edit_doc or patchwork-tool), you MUST also update the \`lastSyncAt\` field on the root folder doc with the current epoch timestamp (\`Date.now()\`). This triggers the module system to reload. Use the edit_doc tool:
\`\`\`tool-call
tool: edit_doc
url: automerge:FOLDER_URL
field: lastSyncAt
value: CURRENT_EPOCH
\`\`\`
The folder URL is the suggestedImportUrl from the tool instance's \`@patchwork\` metadata.

## Rich Messages
You can send different kinds of messages by including special fenced blocks in your response. Each block is parsed and embedded as an inline patchwork-view in your message.

### Create and share a new file
Use \`\`\`file to create a new file and embed it inline:
\`\`\`file name=hello.js mimeType=application/javascript
console.log("hello world")
\`\`\`
Supported fields on the opening line: name (required), mimeType (optional, defaults to text/plain).
The content between the fences becomes the file content. A Patchwork file doc is created and embedded as a patchwork-view in your message.

### Embed an existing document
Use \`\`\`embed to embed an existing Patchwork document (from the workspace or chat files listed in context):
\`\`\`embed
docUrl: automerge:XXXXX
title: filename.js
\`\`\`
Use the exact automerge URL from the context listing. The document renders inline as a patchwork-view.

### Multiple attachments
You can include multiple blocks in a single response. Text outside the blocks becomes the message text.

### When to use what
- **\`\`\`patchwork-tool** — build a new interactive tool (creates + pins in sidebar)
- **\`\`\`file** — create and embed a NEW file (code, text, config, data)
- **\`\`\`embed** — embed an EXISTING document by its automerge URL
- Plain text — normal conversation

All attachments render as embedded patchwork-views in the chat message.

Keep responses concise. When you create a tool, explain briefly what it does.`

	async function sendComputerMessage(text, opts) {
		const repo = window.repo
		const msgData = {
			id: generateId(),
			name: "Computer",
			text: text || "",
			timestamp: Date.now(),
			isComputer: true,
			font: "monospace",
		}
		if (opts?.embeds) msgData.embeds = opts.embeds
		const mh = await repo.create2(msgData)
		handle.change(d => {
			if (!d.messages) d.messages = []
			d.messages.push({ref: true, url: mh.url, timestamp: msgData.timestamp})
		})
	}

	function isComputerMessage(msgIdOrUrl) {
		// Check by iterating cache
		for (const [, cached] of msgDocCache) {
			if (
				cached.data &&
				(cached.data.id === msgIdOrUrl || cached.data.isComputer) &&
				cached.data.id === msgIdOrUrl
			) {
				return true
			}
		}
		return false
	}

	async function inviteComputer() {
		if (computerActive) {
			await sendComputerMessage(
				"I'm already here! Ask me anything or say '@computer build me a tool'."
			)
			return
		}
		computerActive = true

		handle.change(d => {
			d.hasComputer = true
		})

		// Init LLM worker and start model download immediately
		await initLLMWorker()
		if (llmWorker) llmWorker.postMessage({type: "preload"})

		// Show Computer in presence bar
		broadcastComputerTyping(false)
		renderPresence()

		// Create workspace folder for Computer (only if we don't already have one)
		const doc = handle.doc()
		const existingFolder = doc?.docs?.find(d => d.name === "Computer's Workspace" && d.type === "folder")
		if (existingFolder) {
			computerFolderUrl = existingFolder.url
		} else {
			const repo = window.repo
			const folderHandle = await repo.create2({
				title: "Computer's Workspace",
				docs: [],
			})
			computerFolderUrl = folderHandle.url
			handle.change(d => {
				if (!d.docs) d.docs = []
				d.docs.push({
					url: folderHandle.url,
					type: "folder",
					name: "Computer's Workspace",
				})
			})
		}

		await sendComputerMessage(
			"Hello! I'm Computer. Ask me anything, or say '@computer build me [something]' and I'll create a tool for you."
		)

		// Start listening
		lastComputerProcessedIndex = (handle.doc()?.messages?.length || 0)
		startComputerListener()
	}

	function kickComputer() {
		if (!computerActive) return
		computerActive = false
		computerAutoMode = false
		handle.change(d => {
			d.hasComputer = false
		})
		// Remove from presence
		presenceMap.delete("Computer")
		renderPresence()
		renderTyping()
		sendComputerMessage("Goodbye! Use `/computer` to invite me back.")
	}

	let computerResponding = false
	const computerRespondedToIds = new Set()

	function startComputerListener() {
		const onComputerCheck = () => {
			if (!computerActive) return
			if (computerResponding) return // Don't process while already responding
			const doc = handle.doc()
			const msgs = doc?.messages || []
			if (msgs.length <= lastComputerProcessedIndex) return

			for (let i = lastComputerProcessedIndex; i < msgs.length; i++) {
				const entry = msgs[i]
				const resolved = entry.ref ? msgDocCache.get(entry.url)?.data : entry
				if (!resolved || resolved.isComputer) continue
				if (computerRespondedToIds.has(resolved.id)) continue

				const text = (resolved.text || "").toLowerCase()
				const isReplyToComputer =
					resolved.replyTo && isComputerMessage(resolved.replyTo)

				if (
					text.includes("@computer") ||
					isReplyToComputer ||
					computerAutoMode
				) {
					computerRespondedToIds.add(resolved.id)
					computerResponding = true
					respondToUser(resolved).finally(() => {
						computerResponding = false
						// Re-check in case messages arrived while responding
						onComputerCheck()
					})
					lastComputerProcessedIndex = msgs.length
					return // Only respond to one message at a time
				}
			}
			lastComputerProcessedIndex = msgs.length
		}
		handle.on("change", onComputerCheck)
		cleanupListeners.push({
			target: handle,
			event: "change",
			handler: onComputerCheck,
		})
	}


	function broadcastComputerTyping(typing) {
		handle.broadcast({
			type: "presence",
			name: "Computer",
			typing,
			timestamp: Date.now(),
			active: computerActive,
			avatarUrl: null,
		})
		// Also update local presence map so it renders immediately
		presenceMap.set("Computer", {
			timestamp: Date.now(),
			active: computerActive,
			typing,
			avatarUrl: null,
		})
		renderPresence()
		renderTyping()
	}

	// Parse rich message blocks from LLM response
	function parseRichBlocks(response) {
		const blocks = []
		let remaining = response
		// Match ```type ...content...``` blocks
		const blockRe = /```(patchwork-tool|file|embed|image|tool-call)([ \t]+[^\n]*)?\n([\s\S]*?)```/g
		let match
		while ((match = blockRe.exec(response)) !== null) {
			blocks.push({
				type: match[1],
				meta: (match[2] || "").trim(),
				content: match[3],
				fullMatch: match[0],
			})
			remaining = remaining.replace(match[0], "")
		}
		return { blocks, text: remaining.trim() }
	}

	// Parse key=value pairs from a meta string like 'name=hello.js mimeType=text/plain'
	function parseMeta(meta) {
		const result = {}
		const re = /(\w+)=(\S+)/g
		let m
		while ((m = re.exec(meta)) !== null) {
			result[m[1]] = m[2]
		}
		return result
	}

	async function processRichBlocks(parsed) {
		const repo = window.repo
		const encoder = new TextEncoder()
		const embeds = []
		let extraText = ""

		for (const block of parsed.blocks) {
			if (block.type === "patchwork-tool") {
				const result = await createAndPinTool(block.content, "")
				extraText += result.updated
					? "\n\n*Updated tool **" + result.toolName + "**.*"
					: "\n\n*Created tool **" + result.toolName + "** and pinned it in the sidebar.*"
			} else if (block.type === "file") {
				const meta = parseMeta(block.meta)
				const name = meta.name || "file.txt"
				const mimeType = meta.mimeType || "text/plain"
				const isText = mimeType.startsWith("text/") || mimeType === "application/javascript" || mimeType === "application/json" || mimeType === "application/xml"
				const content = isText ? block.content : encoder.encode(block.content)
				const ext = name.includes(".") ? "." + name.split(".").pop() : ""
				const fileHandle = await repo.create2({
					content,
					name,
					extension: ext,
					mimeType,
					"@patchwork": { type: "file" },
				})
				// Embed as patchwork-view so it renders inline
				embeds.push({ docUrl: fileHandle.url, title: name })
			} else if (block.type === "embed") {
				// Parse docUrl and title from content lines
				const lines = block.content.trim().split("\n")
				let docUrl = "", title = ""
				for (const line of lines) {
					const kv = line.match(/^\s*(\w+)\s*:\s*(.+)$/)
					if (kv) {
						if (kv[1] === "docUrl") docUrl = kv[2].trim()
						else if (kv[1] === "title") title = kv[2].trim()
					}
				}
				if (docUrl) embeds.push({ docUrl, title })
			} else if (block.type === "image") {
				const meta = parseMeta(block.meta)
				const dataUrl = block.content.trim()
				try {
					const res = await fetch(dataUrl)
					const blob = await res.blob()
					const buf = new Uint8Array(await blob.arrayBuffer())
					const name = meta.name || "image.png"
					const mimeType = blob.type || "image/png"
					const ext = name.includes(".") ? "." + name.split(".").pop() : ".png"
					const fileHandle = await repo.create2({
						content: buf,
						name,
						extension: ext,
						mimeType,
						"@patchwork": { type: "file" },
					})
					// Embed as patchwork-view
					embeds.push({ docUrl: fileHandle.url, title: name })
				} catch (e) {
					console.warn("[Chat] Computer image block error:", e)
				}
			}
		}

		const messageOpts = {}
		if (embeds.length > 0) messageOpts.embeds = embeds
		return { text: (parsed.text + extraText).trim(), opts: messageOpts }
	}

	// Execute a tool-call block and return the result string
	async function executeToolCall(block) {
		const lines = block.content.trim().split("\n")
		const args = {}
		let currentKey = null
		for (const line of lines) {
			const kv = line.match(/^\s*(\w+)\s*:\s*(.*)$/)
			if (kv) {
				currentKey = kv[1]
				args[currentKey] = kv[2].trim()
			} else if (currentKey) {
				// Multi-line value (e.g. code)
				args[currentKey] += "\n" + line
			}
		}
		const toolName = args.tool
		const repo = window.repo
		try {
			if (toolName === "read_doc") {
				const h = await repo.find(args.url)
				const doc = h.doc()
				return JSON.stringify(doc, null, 2) || "null"
			} else if (toolName === "edit_doc") {
				const h = await repo.find(args.url)
				let val
				try { val = JSON.parse(args.value) } catch { val = args.value }
				h.change(d => { d[args.field] = val })
				return "OK — set " + args.field + " on " + args.url
			} else if (toolName === "inspect_iframe") {
				const url = args.url
				for (const [iframeUrl, wrap] of pinnedIframes) {
					if (iframeUrl === url || iframeUrl.includes(url)) {
						const iframe = wrap.querySelector("iframe")
						let result = ""
						try {
							const body = iframe?.contentDocument?.body
							result += "DOM:\n" + (body?.innerHTML || "(empty)")
						} catch { result += "DOM: (cross-origin, cannot access)\n" }
						const logs = pinnedDocLogs.get(iframeUrl) || []
						const errors = logs.filter(l => l.level === "error").slice(-10)
						if (errors.length > 0) {
							result += "\n\nErrors:\n" + errors.map(e => e.args.join(" ")).join("\n")
						}
						return result || "No content found"
					}
				}
				return "No pinned iframe found for " + url
			} else if (toolName === "eval_in_iframe") {
				const url = args.url
				const code = args.code
				for (const [iframeUrl, wrap] of pinnedIframes) {
					if (iframeUrl === url || iframeUrl.includes(url)) {
						const iframe = wrap.querySelector("iframe")
						try {
							const result = iframe?.contentWindow?.eval(code)
							return String(result) ?? "undefined"
						} catch (e) {
							return "eval error: " + e.message
						}
					}
				}
				return "No pinned iframe found for " + url
			} else {
				return "Unknown tool: " + toolName
			}
		} catch (e) {
			return "Tool error: " + e.message
		}
	}

	// Gather errors and DOM state from all pinned iframes
	function gatherPinnedIframeStatus() {
		const reports = []
		for (const [url, wrap] of pinnedIframes) {
			const iframe = wrap.querySelector("iframe")
			let dom = ""
			try {
				const body = iframe?.contentDocument?.body
				dom = body?.innerHTML?.slice(0, 3000) || "(empty)"
			} catch { dom = "(cross-origin)" }
			const logs = pinnedDocLogs.get(url) || []
			const errors = logs.filter(l => l.level === "error")
			const recentErrors = errors.slice(-10)
			const doc = handle.doc()
			const dlEntry = (doc?.docs || []).find(d => d.url === url)
			const name = dlEntry?.name || url
			reports.push({
				name,
				url,
				errorCount: errors.length,
				errors: recentErrors.map(e => e.args.join(" ")),
				domSnippet: dom,
			})
		}
		return reports
	}

	let activeAbortController = null

	async function respondToUser(userMsg) {
		// Show typing (and keep it alive while thinking)
		broadcastComputerTyping(true)
		const typingInterval = setInterval(() => broadcastComputerTyping(true), 2000)

		const abortController = new AbortController()
		activeAbortController = abortController

		const context = await assembleContext()
		const messages = [
			{role: "system", content: COMPUTER_SYSTEM_PROMPT},
			...context,
			{role: "user", content: userMsg.text},
		]

		// Create a streaming message doc that we'll update live
		const repo = window.repo
		let streamingMsgHandle = null
		const replyToId = userMsg.id // Computer replies to the triggering message

		async function ensureStreamingMsg() {
			if (streamingMsgHandle) return
			const msgData = {
				id: generateId(),
				name: "Computer",
				text: "…",
				timestamp: Date.now(),
				isComputer: true,
				font: "monospace",
				streaming: true,
				replyTo: replyToId,
			}
			streamingMsgHandle = await repo.create2(msgData)

			// Cache and subscribe so token updates trigger re-renders
			const smUrl = streamingMsgHandle.url
			msgDocCache.set(smUrl, {data: msgData, handle: streamingMsgHandle})
			if (!msgDocSubscribed.has(smUrl)) {
				msgDocSubscribed.add(smUrl)
				streamingMsgHandle.on("change", () => {
					const updated = streamingMsgHandle.doc()
					if (updated) msgDocCache.set(smUrl, {data: updated, handle: streamingMsgHandle})
					scheduleRender()
				})
			}

			handle.change(d => {
				if (!d.messages) d.messages = []
				d.messages.push({ref: true, url: smUrl, timestamp: msgData.timestamp})
			})

		}

		function onToken(fullText) {
			if (!streamingMsgHandle) return
			const clean = fullText.replace(/^\[Computer\]\s*/i, "")
			console.log("[Chat] onToken:", clean.slice(0, 80))
			streamingMsgHandle.change(d => {
				d.text = clean
			})
			// Update cache and force re-render to show streaming text
			const smUrl = streamingMsgHandle.url
			const cached = msgDocCache.get(smUrl)
			if (cached) {
				cached.data = {...cached.data, text: clean}
			}
			scheduleRender(true)
		}

		// Throttle token updates to avoid excessive doc changes
		let tokenThrottleTimer = null
		let latestTokenText = ""
		function onTokenThrottled(fullText) {
			latestTokenText = fullText
			if (!tokenThrottleTimer) {
				tokenThrottleTimer = setTimeout(() => {
					tokenThrottleTimer = null
					onToken(latestTokenText)
				}, 200)
			}
		}

		try {
			// Tool-use loop: let the LLM call tools up to 5 times
			const MAX_TOOL_ROUNDS = 5
			let madeChanges = false
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				await ensureStreamingMsg()
				let response = await generateLLM(messages, onTokenThrottled, abortController.signal)
				// Flush any pending throttled update
				if (tokenThrottleTimer) { clearTimeout(tokenThrottleTimer); tokenThrottleTimer = null }
				response = response.replace(/^\[Computer\]\s*/i, "")
				const parsed = parseRichBlocks(response)

				// Check for tool-call blocks
				const toolCalls = parsed.blocks.filter(b => b.type === "tool-call")
				const otherBlocks = parsed.blocks.filter(b => b.type !== "tool-call")

				if (toolCalls.length > 0) {
					// Finalize streaming message with the text portion
					if (otherBlocks.length > 0 || parsed.text.trim()) {
						const partial = { blocks: otherBlocks, text: parsed.text }
						const { text, opts } = await processRichBlocks(partial)
						if (streamingMsgHandle) {
							streamingMsgHandle.change(d => {
								d.text = text || ""
								delete d.streaming
								if (opts?.embeds) d.embeds = opts.embeds
							})
							streamingMsgHandle = null

						}
						if (otherBlocks.some(b => b.type === "patchwork-tool" || b.type === "file")) madeChanges = true
					} else {
						// Mark streaming msg as tool-use in progress
						if (streamingMsgHandle) {
							streamingMsgHandle.change(d => {
								d.text = "(using tools…)"
								delete d.streaming
							})
							streamingMsgHandle = null

						}
					}

					// Execute tool calls and feed results back
					let toolResults = ""
					for (const tc of toolCalls) {
						const result = await executeToolCall(tc)
						const toolArgs = tc.content.trim().split("\n")[0]
						toolResults += "\n[Tool result for " + toolArgs + "]\n" + result + "\n"
					}
					messages.push({role: "assistant", content: response})
					messages.push({role: "user", content: "[Tool results]\n" + toolResults})
					continue
				}

				// No tool calls — finalize the streaming message with final content
				if (otherBlocks.length > 0) {
					const { text, opts } = await processRichBlocks(parsed)
					if (streamingMsgHandle) {
						streamingMsgHandle.change(d => {
							d.text = text || "Here you go!"
							delete d.streaming
							if (opts?.embeds) d.embeds = opts.embeds
						})
						streamingMsgHandle = null
					}
					if (otherBlocks.some(b => b.type === "patchwork-tool" || b.type === "file")) madeChanges = true
				} else {
					if (streamingMsgHandle) {
						streamingMsgHandle.change(d => {
							d.text = response
							delete d.streaming
						})
						streamingMsgHandle = null
					}
				}

				// After making changes, check pinned iframes for errors
				if (madeChanges && pinnedIframes.size > 0) {
					// Wait for iframes to reload and render
					await new Promise(r => setTimeout(r, 2000))
					const status = gatherPinnedIframeStatus()
					const hasErrors = status.some(s => s.errors.length > 0)
					const isEmpty = status.some(s => s.domSnippet === "(empty)" || s.domSnippet.trim().length < 10)

					if (hasErrors || isEmpty) {
						// If nothing rendered, try reloading the iframe first
						if (isEmpty) {
							for (const [, wrap] of pinnedIframes) {
								const iframe = wrap.querySelector("iframe")
								if (iframe) iframe.src = iframe.src
							}
							await new Promise(r => setTimeout(r, 2500))
						}

						// Re-gather after potential reload
						const freshStatus = gatherPinnedIframeStatus()
						const stillBroken = freshStatus.some(s => s.errors.length > 0 || s.domSnippet === "(empty)" || s.domSnippet.trim().length < 10)

						if (stillBroken) {
							let selfCheckPrompt = "[Self-check] After your changes, I inspected the pinned iframes:\n\n"
							for (const s of freshStatus) {
								selfCheckPrompt += "### " + s.name + "\n"
								if (s.errors.length > 0) {
									selfCheckPrompt += "Errors:\n" + s.errors.join("\n") + "\n"
								}
								if (s.domSnippet === "(empty)" || s.domSnippet.trim().length < 10) {
									selfCheckPrompt += "DOM is empty or nearly empty — the tool may not be rendering.\n"
								} else {
									selfCheckPrompt += "DOM snippet:\n" + s.domSnippet.slice(0, 1500) + "\n"
								}
								selfCheckPrompt += "\n"
							}
							selfCheckPrompt += "Please fix the issues. If there are errors, update the tool code. Output a ```patchwork-tool block with the corrected code."

							messages.push({role: "assistant", content: response})
							messages.push({role: "user", content: selfCheckPrompt})
							madeChanges = false
							continue // go around again for a fix
						}
					}
				}
				break
			}
		} catch (err) {
			if (abortController.signal.aborted) {
				// User cancelled — finalize with whatever we have so far
				if (streamingMsgHandle) {
					streamingMsgHandle.change(d => {
						d.text = d.text === "…" ? "(cancelled)" : d.text + "\n\n_(cancelled)_"
						delete d.streaming
					})
				}
			} else if (streamingMsgHandle) {
				streamingMsgHandle.change(d => {
					d.text = "Sorry, I hit an error: " + err.message
					delete d.streaming
				})
			} else {
				await sendComputerMessage("Sorry, I hit an error: " + err.message)
			}
		} finally {
			if (tokenThrottleTimer) clearTimeout(tokenThrottleTimer)
			activeAbortController = null
			clearInterval(typingInterval)
			broadcastComputerTyping(false)
		}
	}

	async function createAndPinTool(code, taskDescription) {
		const repo = window.repo

		// Check if there's already a pinned tool we can update
		const doc = handle.doc()
		const existingPinned = (doc?.docs || []).find(d => d.pin)
		if (existingPinned) {
			// Try to find the tool folder and update its JS file
			try {
				const folderHandle = await repo.find(existingPinned.url)
				const folderDoc = folderHandle.doc()
				// Look in the chat docs for a folder containing a .js file
				// The pin points to an instance doc — we need to find the tool folder
				const suggestedUrl = folderDoc?.["@patchwork"]?.suggestedImportUrl
				if (suggestedUrl) {
					const toolFolder = await repo.find(suggestedUrl)
					const toolFolderDoc = toolFolder.doc()
					const jsEntry = toolFolderDoc?.docs?.find(d => d.name?.endsWith(".js"))
					if (jsEntry) {
						const existingToolId = existingPinned.pin || existingPinned.type
						let patchedCode = code.replace(
							/id:\s*["'][^"']+["']/g,
							'id: "' + existingToolId + '"'
						)
						const jsHandle = await repo.find(jsEntry.url)
						jsHandle.change(d => {
							d.content = patchedCode
						})
						// Update lastSyncAt on the folder to trigger reload
						toolFolder.change(d => { d.lastSyncAt = Date.now() })
						// Reload the module
						if (window.patchwork?.modules?.loadModules) {
							await window.patchwork.modules.loadModules([suggestedUrl])
						}
						// Reload the iframe
						const wrap = pinnedIframes.get(existingPinned.url)
						const iframe = wrap?.querySelector("iframe")
						if (iframe) iframe.src = iframe.src
						console.log("[Chat] Updated existing tool:", jsEntry.name)
						return {
							toolName: existingPinned.name || existingToolId,
							toolId: existingToolId,
							instanceUrl: existingPinned.url,
							folderUrl: suggestedUrl,
							updated: true,
						}
					}
				}
			} catch (e) {
				console.warn("[Chat] Could not update existing tool, creating new:", e)
			}
		}

		const toolName = randomToolName()
		const toolId = toolName // use the random name as the tool/datatype id
		const encoder = new TextEncoder()

		// Replace any hardcoded tool/datatype ids in the code with our toolName
		let patchedCode = code.replace(
			/id:\s*["'][^"']+["']/g,
			'id: "' + toolId + '"'
		)

		// Create a file doc containing the tool source
		const jsFileName = toolName + ".js"
		const content = patchedCode
		const fileHandle = await repo.create2({
			content,
			name: jsFileName,
			extension: ".js",
			mimeType: "application/javascript",
			"@patchwork": {type: "file"},
		})

		// Create a package.json doc
		const pkgContent = encoder.encode(
			JSON.stringify(
				{
					name: "@patchwork/" + toolName,
					type: "module",
					main: jsFileName,
					exports: {".": jsFileName},
				},
				null,
				2
			)
		)
		const pkgHandle = await repo.create2({
			content: pkgContent,
			name: "package.json",
			extension: ".json",
			mimeType: "application/json",
			"@patchwork": {type: "file"},
		})

		// Create folder doc (the tool package) linking the JS and package.json
		const toolFolderHandle = await repo.create2({
			title: toolName,
			docs: [
				{url: fileHandle.url, type: "application/javascript", name: jsFileName},
				{url: pkgHandle.url, type: "application/json", name: "package.json"},
			],
		})

		// Load the module into patchwork so it's registered
		try {
			if (window.patchwork?.modules?.loadModules) {
				await window.patchwork.modules.loadModules([toolFolderHandle.url])
				console.log("[Chat] Loaded tool module:", toolName)
			}
		} catch (e) {
			console.warn("[Chat] loadModules failed:", e)
		}

		// Create an instance doc of the tool's datatype, pointing to the tool package
		const instanceHandle = await repo.create2({
			title: toolName + " instance",
			"@patchwork": {
				type: toolId,
				suggestedImportUrl: toolFolderHandle.url,
			},
		})

		// Try to init the doc by calling the datatype init if we can eval it
		try {
			const blob = new Blob([patchedCode], {type: "application/javascript"})
			const blobUrl = URL.createObjectURL(blob)
			const mod = await import(blobUrl)
			URL.revokeObjectURL(blobUrl)
			const dt = mod.default?.init
				? mod.default
				: Object.values(mod).find(
						v => v && typeof v === "object" && typeof v.init === "function"
					)
			if (dt) {
				instanceHandle.change(d => {
					dt.init(d)
				})
			}
		} catch (e) {
			console.warn("[Chat] Could not auto-init tool doc:", e)
		}

		// Pin the instance doc in the sidebar with the new tool id
		handle.change(d => {
			if (!d.docs) d.docs = []
			d.docs.push({
				url: instanceHandle.url,
				type: toolId,
				name: toolName,
				pin: toolId,
			})
		})
		renderPinnedDocs()
		updateSidebarVisibility()

		return {
			toolName,
			toolId,
			instanceUrl: instanceHandle.url,
			folderUrl: toolFolderHandle.url,
		}
	}

	// ============================================================================
	// LLM Context Assembly
	// ============================================================================

	async function assembleContext() {
		const doc = handle.doc()
		const msgs = doc?.messages || []
		const contextMessages = []

		// Recent chat messages
		const recent = msgs.slice(-50)
		for (const entry of recent) {
			const msg = entry.ref ? msgDocCache.get(entry.url)?.data : entry
			if (!msg) continue
			let text = msg.text || ""
			if (msg.voiceUrl) {
				const recCached = recordingDocCache.get(msg.voiceUrl)
				if (recCached?.data?.transcription)
					text += "\n[Voice note transcription: " + recCached.data.transcription + "]"
				else
					text += "\n[Voice note attached, no transcription available]"
			}

			const role = msg.isComputer ? "assistant" : "user"
			const prefix = msg.isComputer ? "" : `[${msg.name}] `

			// If message has an image, build multipart content for vision models
			if (msg.imageUrl && !msg.isComputer) {
				const parts = []
				parts.push({type: "text", text: prefix + text})
				// Try to load the image as base64 data URL
				try {
					const repo = window.repo
					if (repo) {
						const fh = await repo.find(msg.imageUrl)
						const fdoc = fh.doc()
						if (fdoc?.content) {
							const bytes = fdoc.content instanceof Uint8Array
								? fdoc.content
								: new Uint8Array(fdoc.content)
							const mime = fdoc.mimeType || "image/png"
							// Convert to base64
							let binary = ""
							for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
							const b64 = btoa(binary)
							parts.push({
								type: "image_url",
								image_url: {url: `data:${mime};base64,${b64}`}
							})
						}
					}
				} catch (e) {
					// If image loading fails, just note it in text
					parts[0].text += "\n[Image attached: " + (msg.imageName || "image") + "]"
				}
				contextMessages.push({role, content: parts})
			} else {
				contextMessages.push({
					role,
					content: msg.isComputer ? text : prefix + text,
				})
			}
		}

		// Workspace file listing
		const logParts = []
		if (computerFolderUrl) {
			try {
				const folderHandle = await window.repo.find(computerFolderUrl)
				const folderDoc = folderHandle.doc()
				if (folderDoc?.docs?.length > 0) {
					const fileList = folderDoc.docs.map(d => `- ${d.name} (${d.type || "unknown"}) url=${d.url}`).join("\n")
					logParts.push("Computer's Workspace files:\n" + fileList)
				}
			} catch {}
		}
		// Chat doc files
		const chatDoc = handle.doc()
		if (chatDoc?.docs?.length > 0) {
			const fileList = chatDoc.docs.map(d => `- ${d.name} (${d.type || "unknown"}) url=${d.url}`).join("\n")
			logParts.push("Chat shared files:\n" + fileList)
		}

		// Console logs and errors from pinned iframes
		for (const [url, logs] of pinnedDocLogs) {
			const dlEntry = (doc?.docs || []).find(d => d.url === url)
			const name = dlEntry?.name || url
			const errors = logs.filter(l => l.level === "error")
			const warnings = logs.filter(l => l.level === "warn")
			const recentLogs = logs.slice(-30)

			let iframePart = "Pinned iframe: " + name + " (" + url + ")\n"
			if (errors.length > 0) {
				iframePart += "ERRORS (" + errors.length + "):\n" + errors.slice(-15).map(e => e.args.join(" ")).join("\n") + "\n"
			}
			if (warnings.length > 0) {
				iframePart += "Warnings (" + warnings.length + "):\n" + warnings.slice(-5).map(w => w.args.join(" ")).join("\n") + "\n"
			}
			if (recentLogs.length > 0) {
				iframePart += "Recent console:\n" + recentLogs.map(l => `[${l.level}] ${l.args.join(" ")}`).join("\n") + "\n"
			}

			// Also include DOM snapshot from the iframe
			const wrap = pinnedIframes.get(url)
			if (wrap) {
				const iframe = wrap.querySelector("iframe")
				try {
					const body = iframe?.contentDocument?.body
					const html = body?.innerHTML || ""
					if (html.length < 20) {
						iframePart += "DOM: (empty or nearly empty — tool may not be rendering)\n"
					}
				} catch {}
			}
			logParts.push(iframePart)
		}

		// Call transcript
		const callUrl = handle.doc()?.callUrl
		if (callUrl) {
			try {
				const callHandle = await repo.find(callUrl)
				const callDoc = callHandle.doc()
				if (callDoc?.content) {
					logParts.push("Call transcript:\n" + callDoc.content.slice(-4000))
				}
			} catch {}
		}

		if (logParts.length > 0) {
			contextMessages.unshift({
				role: "system",
				content: "Additional context:\n" + logParts.join("\n\n"),
			})
		}

		return contextMessages
	}

	// ============================================================================
	// Voice Note Transcription (Moonshine)
	// ============================================================================

	async function initWhisperWorker() {
		if (whisperWorker) return
		try {
			const workerUrl = new URL("./moonshine-worker.js", import.meta.url)
			console.log("[Chat] Loading moonshine worker from:", workerUrl.href)
			// Workers loaded from service-worker-served URLs (automerge:) can fail as
			// modules. Fetch the script and create a blob worker instead.
			let w
			try {
				const res = await fetch(workerUrl)
				const src = await res.text()
				const blob = new Blob([src], {type: "application/javascript"})
				w = new Worker(URL.createObjectURL(blob), {type: "module"})
				console.log("[Chat] Moonshine worker created via blob URL")
			} catch (blobErr) {
				console.warn("[Chat] Blob worker failed, trying direct URL:", blobErr)
				w = new Worker(workerUrl, {type: "module"})
			}
			whisperWorker = w
			whisperWorker.onmessage = e => {
				const msg = e.data
				console.log("[Chat] Moonshine worker message:", msg.type, msg.text || msg.message || "")
				if (msg.type === "ready") {
					whisperReady = true
				} else if (msg.type === "result" && msg._msgUrl) {
					handleTranscriptionResult(msg.text, msg._msgUrl)
				} else if (msg.type === "status") {
					// Could show in UI
				}
			}
			whisperWorker.onerror = e => {
				console.error("[Chat] Moonshine worker error:", e)
			}
		} catch (err) {
			console.warn("[Chat] Moonshine worker init failed:", err)
		}
	}

	async function transcribeVoiceNote(audioBlob, msgUrl) {
		if (pendingTranscriptions.has(msgUrl)) return
		pendingTranscriptions.set(msgUrl, true)
		if (!whisperWorker) await initWhisperWorker()
		if (!whisperWorker) return
		try {
			const audioCtx = new AudioContext({sampleRate: 16000})
			const arrayBuf = await audioBlob.arrayBuffer()
			const audioBuf = await audioCtx.decodeAudioData(arrayBuf)
			const pcm = audioBuf.getChannelData(0)
			audioCtx.close()
			whisperWorker.postMessage(
				{type: "transcribe", audio: pcm, _msgUrl: msgUrl},
				[pcm.buffer]
			)
		} catch (err) {
			console.warn("[Chat] transcription decode failed:", err)
			pendingTranscriptions.delete(msgUrl)
		}
	}

	function handleTranscriptionResult(text, recordingUrl) {
		pendingTranscriptions.delete(recordingUrl)
		// Update the recording doc with transcription
		const cached = recordingDocCache.get(recordingUrl)
		if (cached && cached.handle) {
			cached.handle.change(d => {
				d.transcription = text
			})
		} else {
			// Recording doc not cached yet, resolve and update
			resolveRecordingDoc(recordingUrl).then(c => {
				if (c && c.handle) {
					c.handle.change(d => {
						d.transcription = text
					})
				}
			})
		}
		render()
	}

	// ============================================================================
	// Wire pinned docs rendering into the change cycle
	// ============================================================================
	renderPinnedDocs()

	// Start loading the moonshine transcription worker eagerly
	initWhisperWorker()

	// Auto-join computer if the doc has one
	if (handle.doc()?.hasComputer && !computerActive) {
		computerActive = true
		const existingFolder = handle.doc()?.docs?.find(d => d.name === "Computer's Workspace" && d.type === "folder")
		if (existingFolder) computerFolderUrl = existingFolder.url
		lastComputerProcessedIndex = (handle.doc()?.messages?.length || 0)

		// Init LLM worker
		initLLMWorker().then(() => {
			if (llmWorker) llmWorker.postMessage({type: "preload"})
		})

		startComputerListener()
		renderPresence()
	}

	// Track scroll for read marking
	messagesArea.addEventListener("scroll", () => {
		markReadIfVisible()
	})

	const onChange = () => {
		const doc = handle.doc()
		const count = doc?.messages?.length || 0
		if (count > lastKnownMessageCount && lastKnownMessageCount > 0) {
			// New messages arrived
			const newEntries = (doc.messages || []).slice(lastKnownMessageCount)
			const fromOther = newEntries.some(e => {
				if (e.ref && e.url) {
					const cached = msgDocCache.get(e.url)
					return cached ? cached.data.name !== myName : true
				}
				return e.name !== myName
			})
			if (fromOther) {
				if (!isFocused || document.hidden) {
					hasUnread = true
					updateTitle()
					if (soundEnabled)
						getNotificationSound().then(audio => {
							if (audio) {
								audio.currentTime = 0
								audio.play().catch(() => {})
							}
						})
					// OS notification — find the last message from someone else for the notification body
					const lastOther = [...newEntries].reverse().find(e => {
						if (e.ref && e.url) {
							const c = msgDocCache.get(e.url)
							return c ? c.data.name !== myName : true
						}
						return e.name !== myName
					})
					if (lastOther) {
						// Resolve the message doc if needed (it's likely a ref that hasn't been cached yet)
						const notifyFrom = async () => {
							let data = lastOther
							if (lastOther.ref && lastOther.url) {
								const cached = msgDocCache.get(lastOther.url)
								if (cached) {
									data = cached.data
								} else {
									const resolved = await resolveMessageDoc(lastOther.url)
									if (resolved) data = resolved.data
								}
							}
							const name = data.name || "Someone"
							const text = data.text || ""
							const avUrl = data.avatarUrl
							const avBlob = avUrl ? avatarCache.get(avUrl) : undefined
							showOSNotification(name, text, avBlob)
						}
						notifyFrom()
					}
				} else {
					// Focused — check if at bottom, if so mark read
					markReadIfVisible()
				}
			}
		}
		lastKnownMessageCount = count
		render()
		renderPinnedDocs()
		updateSidebarVisibility()
	}
	handle.on("change", onChange)

	// Initialize message count
	const initDoc = handle.doc()
	lastKnownMessageCount = initDoc?.messages?.length || 0
	updateTitle()

	setTimeout(() => broadcastPresence(false), 500)

	return () => {
		handle.off("change", onChange)
		handle.off("ephemeral-message", onEphemeralMessage)
		if (draftSyncTimer) clearTimeout(draftSyncTimer)
		syncDraftToDoc() // flush any pending draft
		if (draftHandle) draftHandle.removeAllListeners("change")
		if (presenceInterval) clearInterval(presenceInterval)

		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			recSendOnStop = false
			mediaRecorder.stop()
		}
		cleanupRecordingUI()
		stopGifCamera()
		document.removeEventListener("visibilitychange", onVisible)
		window.removeEventListener("focus", onFocus)
		window.removeEventListener("blur", onBlur)
		// Clean up registered listeners
		for (const {target, event, handler} of cleanupListeners) {
			if (target.removeEventListener) target.removeEventListener(event, handler)
			else if (target.off) target.off(event, handler)
		}
		cleanupListeners.length = 0
		// Clean up pinned doc iframes
		for (const [, iframe] of pinnedIframes) iframe.remove()
		pinnedIframes.clear()
		pinnedDocLogs.clear()
		setFaviconUnread(false)
		root.remove()
		style.remove()
	}
}
