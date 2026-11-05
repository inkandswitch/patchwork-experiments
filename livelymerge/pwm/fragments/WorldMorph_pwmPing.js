// Class fragment for WorldMorph — install via:
//   replaceMethod('WorldMorph', <this file's body>)
// or: pnpm pwm:eval --replace WorldMorph --fragment pwm/fragments/WorldMorph_pwmPing.js
pwmPing() {
  // Tiny live-collab smoke: returns a string peers can eval; also flashes a note.
  let note = new TextMorph(rect(420, 400, 280, 24), 'pong from Grok (live install)');
  Lively.addMorph(note);
  return 'pong';
}
