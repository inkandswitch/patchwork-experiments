/**
 * Converts an automerge: URL to the HTTP path the service worker handles.
 * e.g. "automerge:abc123" → "/automerge%3Aabc123"
 */
function toSwPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', '/automerge%3A');
}

export function makeDefaultSource(): string {
  const libUrl = `${toSwPath(__ROOT_DIR_URL__)}/dist/p3net/index.js`;
  return `import { defineNet } from '${libUrl}'

export default defineNet({
  places: ['idle', 'running', 'done'],
  transitions: [
    {
      id: 'start',
      from: ['idle'],
      to: ['running'],
      guard(token) {
        return token.state.ready === true
      },
      onToken(token) {
        token.change(s => { s.startedAt = Date.now() })
      },
    },
    {
      id: 'finish',
      from: ['running'],
      to: ['done'],
    },
  ],
  initial: {
    idle: [{ id: 'token-1', state: { ready: true } }],
  },
})
`;
}
