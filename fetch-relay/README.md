# fetch-relay

Fetches a URL for a Patchwork agent running in a browser, and returns what the
site sent, as it sent it.

Most sites do not let another site's page read them (CORS). Without help, the
agent in a browser keeps a third-party reader's text of each page, and a PDF
only when the site happens to allow it, so a person reviewing its work cannot
see the sources the way they were. Through a relay the agent keeps the PDF or
the page itself, with its text beside it, as it does when it runs in node.

```
GET <relay>/fetch?url=<target>      (and HEAD)
→ the target's status, body and content type
  x-relay-final-url   where redirects ended
  x-relay-error       only when the relay itself refused or failed
```

## Running it

As a Cloudflare Worker:

```
pnpm install
wrangler secret put RELAY_KEY
pnpm deploy
```

As a Node server (Node 18 or later), behind TLS for use from an https page:

```
RELAY_KEY=… PORT=8787 node server.mjs
```

Then give the agent its address and key: the agent's settings, under
**Fetch relay**. They are stored with the account's API keys, never in a
session.

| variable | default | |
|---|---|---|
| `RELAY_KEY` | none | Required in practice. Without it anyone who finds the relay can use it. |
| `RELAY_ORIGINS` | any | Comma-separated page origins allowed to call it from a browser. |
| `RELAY_MAX_BYTES` | 50 MB | Larger responses are refused (413). |
| `RELAY_TIMEOUT_MS` | 30 s | Slower sites are refused (502). |

## What it will not do

The same table the agent's own guard uses (`guard.js`, a copy of
`agent/tools/guard.js`; change them together), checked at the target and at
every redirect, which the relay follows itself:

- fetch anything but http and https;
- fetch localhost or any private, local or link-local address, in any
  spelling (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`, the cloud metadata
  address), nor a name that resolves to one (in the Node server; a Worker
  cannot reach private addresses anyway);
- fetch a path that names an automerge document;
- send anything but GET or HEAD, or forward cookies, credentials or any
  request header beyond `accept`, `accept-language`, `range` and the
  conditional ones — save one: Brave Search's key (`x-subscription-token`),
  passed to `api.search.brave.com` and nowhere else, redirects included, so
  the agent can search from a browser (`CREDENTIALS` in `relay.js`);
- pass a site's cookies back.

`relay.test.js` checks each of these, and that a PDF's bytes come back
exactly.

## What sites see

Requests come from Cloudflare's network (or the Node server's address), as
`PatchworkFetchRelay/1.0 (+https://www.inkandswitch.com/)` — some sites, such
as Wikipedia, refuse a request that does not say what it is. It names the
software, never who is using it. Some sites refuse fetchers like this whatever
they send (w3.org, for one); the agent then keeps the reader's text of the
page and says it is not the original.
