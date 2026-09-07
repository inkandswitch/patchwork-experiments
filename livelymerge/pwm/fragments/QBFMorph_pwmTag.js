// Class fragment for QBFMorph — PWM live-collab smoke.
// Install: replaceMethod('QBFMorph', <body>) or join --replace QBFMorph --fragment …
pwmTag() {
  // Visible on the board: a small banner peers can see when the game is shared.
  let note = new TextMorph(rect(12, 12, 320, 24), 'Hello from Grok — QBF collab!');
  this.addMorph(note);
  if (typeof note.beTopMorph === 'function') note.beTopMorph();
  return 'qbf-pong';
}
