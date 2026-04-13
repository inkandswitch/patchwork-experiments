# Tic Tac Toe

## New game

An empty board ready to play.

```json
{
  "tool": "tic-tac-toe/tool.json",
  "tags": ["starter"],
  "value": {
    "x": 0, "y": 0,
    "width": 280, "height": 320,
    "board": ["", "", "", "", "", "", "", "", ""],
    "currentPlayer": "X",
    "winner": "",
    "gameOver": false
  },
  "width": 280,
  "height": 320
}
```

## Mid-game

A game in progress with several moves played.

```json
{
  "tool": "tic-tac-toe/tool.json",
  "tags": [],
  "value": {
    "x": 0, "y": 0,
    "width": 280, "height": 320,
    "board": ["X", "", "O", "", "X", "", "", "", "O"],
    "currentPlayer": "X",
    "winner": "",
    "gameOver": false
  },
  "width": 280,
  "height": 320
}
```

## X wins

A completed game where X wins with a diagonal.

```json
{
  "tool": "tic-tac-toe/tool.json",
  "tags": [],
  "value": {
    "x": 0, "y": 0,
    "width": 280, "height": 320,
    "board": ["X", "O", "", "", "X", "O", "", "", "X"],
    "currentPlayer": "O",
    "winner": "X",
    "gameOver": true
  },
  "width": 280,
  "height": 320
}
```
