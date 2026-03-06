---
name: chat-document
description: Read and write a Patchwork chat document by Automerge URL. Use when you need to list messages, send a message, or inspect the chat schema.
---

# Chat Document Skill

Interact with a Patchwork chat document using `repo`.

## Import

```js
const { getChatDocument } = await loadSkill('chat-document');
```

## API

### `getChatDocument(repo, url)` — async

Returns `{ listMessages(), sendMessage(data), getTitle(), setTitle(title) }` for the chat at `url`.

| Method | Description |
|--------|-------------|
| `listMessages()` | Returns the full `messages` array from the document snapshot. |
| `sendMessage(data)` | Appends a message object to `doc.messages`. `data` must include at least `{ name, text }`. |
| `getTitle()` | Returns the chat title string. |
| `setTitle(title)` | Sets the chat title. |

## Document Schema

```js
{
  title: string,
  messages: [
    {
      id: string,            // generateId() — random + timestamp
      name: string,          // sender display name
      text: string,
      timestamp: number,     // Date.now()
      font?: string,         // custom font family from sender's chat profile
      avatarUrl?: string,    // automerge URL to avatar file doc
      replyTo?: string,      // id of the message being replied to
      imageUrl?: string,     // automerge URL to pasted image file doc
      imageName?: string,
      voiceUrl?: string,     // automerge URL to recording doc
      voiceDuration?: number,
      gifSelfieUrl?: string, // automerge URL to GIF file doc
      reactions?: {          // emoji -> array of user display names
        [emoji: string]: string[]
      },
      isComputer?: boolean,  // true if sent by the Computer AI
      embeds?: any[],        // inline embedded doc views
      emoticons?: {          // name -> automerge URL for custom emoticons used in this message
        [name: string]: string
      }
    }
  ],
  docs: [                    // DocLinks for all files referenced by messages
    { url: string, type: string, name: string }
  ],
  hasComputer?: boolean,     // true if Computer AI is active in this chat
  computerHostName?: string  // display name of the peer hosting the Computer AI
}
```

## User Identity

Resolved from `window.accountDocHandle`:

```js
const ad = window.accountDocHandle.doc()
const contactHandle = await repo.find(ad.contactUrl)
const contact = contactHandle.doc()
// contact.name             -> display name
// contact.chatProfileUrl   -> automerge URL to chat profile doc
// contact.avatarUrl        -> avatar file doc URL
```

### Chat Profile Doc

Stored at `contact.chatProfileUrl`:

```js
{
  font?: string,           // custom font family for this user's messages
  readPositions: {
    [chatUrl: string]: number  // timestamp of last read message per chat
  }
}
```

## Message Grouping

Consecutive messages from the same author within 5 minutes are visually grouped (continuation rows — avatar and name are not repeated). Replies always break continuation and show the full avatar and name.

## Example

```js
const { getChatDocument } = await loadSkill('chat-document');
const chat = await getChatDocument(repo, 'automerge:XXXXX');

// Read messages
const messages = chat.listMessages();
const recent = messages.slice(-10);

// Send a message
chat.sendMessage({
  id: crypto.randomUUID(),
  name: 'Chee',
  text: 'Hello from Chee!',
  timestamp: Date.now(),
});

// Reply to a message
chat.sendMessage({
  id: crypto.randomUUID(),
  name: 'Chee',
  text: 'Good point!',
  timestamp: Date.now(),
  replyTo: recent[0].id,
});
```
