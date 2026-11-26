// What the queue browser shows of a task's code and its input: where the
// code is, in words a person can read, a link that opens it when a browser
// can, and its source on request; and the input with whatever it keeps under
// `keys` (its asker's secrets) hidden.
//
// Naive on purpose: the source is read the way a browser reads any file,
// `fetch` (a package's files are served at their path by the site's service
// worker, network or not), or decoded from a `data:` URL where it stands.

import { createSignal, Show } from 'solid-js';
import { onOrigin, parseAutomergeImport } from './import-url';

/** The most of a source that is shown, in characters: about 200 KB. */
export const MAX_SOURCE_CHARS = 200_000;

/** How many characters of a URL that cannot be opened (a `data:` URL) are shown. */
const MAX_ADDRESS_CHARS = 160;

/** What a field named `keys` reads as, wherever it is in a value shown. */
export const HIDDEN = '(hidden)';
const HIDDEN_MARK = '\u0000tq-hidden\u0000';

/**
 * A value as it would be typed (JSON, `indent` as JSON.stringify takes it),
 * with the value of every field named `keys`, at any depth, shown as
 * `(hidden)`: a task's input keeps its asker's secrets there.
 */
export function showValue(value: unknown, indent?: number): string {
  let text: string;
  try {
    text =
      JSON.stringify(
        value,
        function (this: unknown, key: string, field: unknown) {
          return key === 'keys' && !Array.isArray(this) ? HIDDEN_MARK : field;
        },
        indent,
      ) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.replaceAll(JSON.stringify(HIDDEN_MARK), HIDDEN);
}

/** This page's origin, when it is a site's (not in a test's document, say). */
function siteOrigin(): string | null {
  const origin = typeof location === 'undefined' ? null : location.origin;
  return origin && /^https?:\/\//.test(origin) ? origin : null;
}

/**
 * Where a browser can open a task's code: a file of a package on this site
 * (made on another site or none, it is moved to this one, as a pool moves
 * it), a path on this site, or an http(s) URL; null for anything else, a
 * `data:` URL included.
 */
export function openableUrl(importUrl: string): string | null {
  const origin = siteOrigin();
  if (parseAutomergeImport(importUrl)) {
    return origin ? onOrigin(importUrl, origin) : importUrl;
  }
  if (importUrl.startsWith('/') && !importUrl.startsWith('//')) {
    return importUrl;
  }
  try {
    const { protocol } = new URL(importUrl);
    return protocol === 'https:' || protocol === 'http:' ? importUrl : null;
  } catch {
    return null;
  }
}

/** An automerge url cut to its start: `automerge:2UbGsSi8…`. */
function shortDocUrl(url: string) {
  const id = url.replace(/^automerge:/, '');
  return `automerge:${id.length > 8 ? `${id.slice(0, 8)}…` : id}`;
}

/**
 * Where a task's code is, in words: which file of which package, or that it
 * is written into the task; null for any other URL, which says it itself.
 */
export function describeCode(importUrl: string): string | null {
  if (importUrl.startsWith('data:')) {
    return 'Code written into the task itself, as a data: URL.';
  }
  const found = parseAutomergeImport(importUrl);
  if (!found) {
    return null;
  }
  const version = found.heads ? `, at version ${found.heads.length > 8 ? `${found.heads.slice(0, 8)}…` : found.heads}` : '';
  return `The file ${found.path} of the package ${shortDocUrl(found.packageUrl)}${version}.`;
}

/** Percent-decoding as a browser reads a `data:` URL: a `%` that starts no escape is kept as it is. */
function percentDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < text.length; ) {
    const escape = text.slice(i + 1, i + 3);
    if (text[i] === '%' && /^[0-9a-fA-F]{2}$/.test(escape)) {
      bytes.push(parseInt(escape, 16));
      i += 3;
    } else {
      const char = String.fromCodePoint(text.codePointAt(i)!);
      for (const byte of encoder.encode(char)) {
        bytes.push(byte);
      }
      i += char.length;
    }
  }
  return Uint8Array.from(bytes);
}

/** The text a `data:` URL holds, as UTF-8. */
export function decodeDataUrl(url: string): string {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0) {
    throw new Error('its data: URL has no comma, so holds no code');
  }
  const bytes = percentDecode(url.slice(comma + 1));
  if (/;base64$/i.test(url.slice(5, comma))) {
    let encoded = '';
    for (const byte of bytes) {
      encoded += String.fromCharCode(byte);
    }
    const binary = atob(encoded.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  }
  return new TextDecoder().decode(bytes);
}

/** A task's source: decoded from a `data:` URL, else fetched from where its URL says. */
export async function loadSource(importUrl: string): Promise<string> {
  if (importUrl.startsWith('data:')) {
    return decodeDataUrl(importUrl);
  }
  const response = await fetch(openableUrl(importUrl) ?? importUrl);
  if (!response.ok) {
    throw new Error(`the site answered ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  return await response.text();
}

/** A sentence from a reason: its first letter as it was, a full stop at its end. */
function sentence(reason: string) {
  const text = reason.trim() || 'no reason was given';
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

type Loaded = { text: string } | { error: string };

/**
 * Where a task's code is, and its source on request: loaded the first time
 * a person asks and kept while this is mounted (the task's details are open),
 * so redraws and Hide/Show load nothing more.
 */
export const TaskCode = (props: { importUrl: string }) => {
  const [shown, setShown] = createSignal(false);
  const [loaded, setLoaded] = createSignal<Loaded | null>(null);
  let asked = false;

  function toggle() {
    if (!asked) {
      asked = true;
      loadSource(props.importUrl).then(
        (text) => setLoaded({ text }),
        (error) => setLoaded({ error: String(error?.message ?? error) }),
      );
    }
    setShown((now) => !now);
  }

  const address = () =>
    props.importUrl.length > MAX_ADDRESS_CHARS ? `${props.importUrl.slice(0, MAX_ADDRESS_CHARS - 1)}…` : props.importUrl;

  return (
    <div class="tq-code-view">
      <Show when={describeCode(props.importUrl)}>
        {(words) => (
          <p class="tq-choice-note tq-code-where" title={parseAutomergeImport(props.importUrl)?.docUrl}>
            {words()}
          </p>
        )}
      </Show>
      <div class="tq-code-address">
        <Show when={openableUrl(props.importUrl)} fallback={<code class="tq-code tq-code-url">{address()}</code>}>
          {(href) => (
            <a class="tq-code tq-code-url" href={href()} target="_blank" rel="noopener noreferrer">
              {props.importUrl}
            </a>
          )}
        </Show>
        <button class="tq-link tq-code-toggle" aria-expanded={shown()} onClick={toggle}>
          {shown() ? 'Hide code' : 'Show code'}
        </button>
      </div>
      <Show when={shown()}>
        <Show when={loaded()} fallback={<p class="tq-muted tq-code-note">Loading the code…</p>}>
          {(result) => {
            const now = result();
            if ('error' in now) {
              return <p class="tq-error tq-code-note">Could not load this code: {sentence(now.error)}</p>;
            }
            const cut = now.text.length > MAX_SOURCE_CHARS;
            return (
              <>
                <pre class="tq-source tq-code-source">{cut ? now.text.slice(0, MAX_SOURCE_CHARS) : now.text}</pre>
                <Show when={cut}>
                  <p class="tq-choice-note tq-code-note">
                    Cut short: the first {Math.round(MAX_SOURCE_CHARS / 1000)} KB of{' '}
                    {Math.round(now.text.length / 1000).toLocaleString()} KB are shown.
                  </p>
                </Show>
              </>
            );
          }}
        </Show>
      </Show>
    </div>
  );
};
