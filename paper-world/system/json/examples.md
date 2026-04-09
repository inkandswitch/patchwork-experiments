# JSON Viewer

## Empty object

A blank JSON document.

```json
{
  "tool": "json/tool.json",
  "tags": [],
  "value": {},
  "width": 280,
  "height": 200
}
```

## User profile

A typical user profile object.

```json
{
  "tool": "json/tool.json",
  "tags": [],
  "value": {
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "role": "admin",
    "active": true,
    "loginCount": 42
  },
  "width": 280,
  "height": 200
}
```

## Nested config

A configuration object with nested sections.

```json
{
  "tool": "json/tool.json",
  "tags": [],
  "value": {
    "database": {
      "host": "localhost",
      "port": 5432,
      "name": "app_db"
    },
    "cache": {
      "enabled": true,
      "ttl": 3600
    },
    "features": ["dark-mode", "notifications", "export"]
  },
  "width": 280,
  "height": 300
}
```
