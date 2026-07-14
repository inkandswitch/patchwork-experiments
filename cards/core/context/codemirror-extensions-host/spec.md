# Codemirror extensions host

A single, always-installed CodeMirror extension that lets the canvas decide which
editor features are on. It brings no behavior of its own.

- reads the canvas `codemirror:extensions` context channel
- installs whatever feature cards have published there (each card publishes its
  own extension while it sits on the canvas), reconfiguring live as cards are
  added or removed
- does nothing outside a canvas — with no context store to read, it installs
  nothing, so features like mentions and stickers are no longer baked into every
  editor and instead ride in through their cards
