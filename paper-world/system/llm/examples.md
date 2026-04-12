# LLM Chat

## Fresh chat

An empty LLM chat with default configuration.

```json
{
  "tool": "llm/tool.json",
  "tags": ["starter"],
  "value": {
    "config": {
      "apiUrl": "https://openrouter.ai/api/v1",
      "model": "anthropic/claude-opus-4.6"
    },
    "runs": []
  }
}
```

## Chat with prompt

A chat session with a pre-filled prompt and response.

```json
{
  "tool": "llm/tool.json",
  "tags": [],
  "value": {
    "config": {
      "apiUrl": "https://openrouter.ai/api/v1",
      "model": "anthropic/claude-opus-4.6"
    },
    "runs": [
      {
        "prompt": "What is 2 + 2?",
        "output": [{ "type": "text", "content": "2 + 2 equals 4." }],
        "done": true
      }
    ]
  }
}
```
