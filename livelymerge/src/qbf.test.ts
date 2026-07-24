import { describe, expect, it } from 'vitest';
import { makeGame } from './qbfHarness';

/**
 * Full-stack tests for QBF.js (the Quick Brown Fox): the game is built, stepped, typed
 * at, and clicked on inside the real LivelyMerge runtime.
 */

describe('QBF', () => {
  it('builds a board with a rack, a belt, readouts and buttons', () => {
    const { rt } = makeGame();
    expect(rt.eval(`qbfGame.className`)).toBe('QBFMorph');
    expect(rt.eval(`qbfGame.level.caption`)).toBe('quick');
    expect(rt.eval(`qbfGame.rackSize`)).toBe(8);
    expect(rt.eval(`qbfGame.multBoxes.length`)).toBe(8);
    expect(rt.eval(`qbfGame.multBoxes[3].shape.string`)).toBe('x2'); // bonus starts at 4 letters
    // letterSet rounds each letter's share down, so 103 asked for makes a 100-tile set;
    // plus the "!" that ends the game, less the two tiles already in play.
    expect(rt.eval(`qbfGame.letterQueue.length`)).toBe(99);
    // The board fills its panel, just under the title bar (panel-local coordinates).
    expect(rt.eval(`qbfGame.getBounds().width() == qbfPanel.getBounds().width()`)).toBe(true);
    expect(rt.eval(`qbfGame.getBounds().topLeft.y`)).toBe(rt.eval(`qbfPanel.titleBarHeight`));
  }, 60_000);

  it('carries tiles in on the belt and drops them onto the rack', () => {
    const { rt, ticks } = makeGame();
    expect(rt.eval(`qbfGame.activeLetters[0].loc`)).toBe('belt');
    const startX = rt.eval(`qbfGame.activeLetters[0].getBounds().topLeft.x`) as number;
    ticks(4);
    expect(rt.eval(`qbfGame.activeLetters[0].getBounds().topLeft.x`)).toBeLessThan(startX);
    // Within a couple of belt-lengths a tile has landed on the rack.
    let ticked = 0;
    while (ticked < 400 && !rt.eval(`qbfGame.activeLetters.some((l) => l.loc == 'rack')`)) {
      ticks(10);
      ticked += 10;
    }
    expect(rt.eval(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length`)).toBeGreaterThan(
      0,
    );
    // Feeding the rack pulls tiles out of the queue, and the readout keeps count.
    expect(rt.eval(`Number(qbfGame.nLeftBox.shape.string) == qbfGame.letterQueue.length`)).toBe(
      true,
    );
  }, 60_000);

  it('scores a typed word, and returns the tiles to play on delete', () => {
    const { rt, ticks, ticksUntil, type } = makeGame();
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 3`);
    const chars = rt.eval(
      `qbfGame.activeLetters.filter((l) => l.loc == 'rack').map((l) => l.shape.string).join('')`,
    ) as string;
    expect(chars.length).toBeGreaterThanOrEqual(3);
    type(chars[0]);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(1);
    expect(rt.eval(`qbfGame.letterScore`)).toBeGreaterThan(0);
    // A one-letter word gets no multiplier at all.
    expect(rt.eval(`qbfGame.wordScore`)).toBe(0);
    type(chars[1]);
    type(chars[2]);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(3);
    expect(rt.eval(`qbfGame.wordScore`)).toBe(rt.eval(`qbfGame.letterScore`)); // x1 at three
    // Delete puts the last tile back in play; esc clears the rest.
    type('Backspace');
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(2);
    type('Escape');
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(0);
    expect(rt.eval(`qbfGame.activeLetters.every((l) => l.copyInOutbox == null)`)).toBe(true);
    // Submitting takes the tiles off the rack and posts a line to the log.
    const nRackBefore = rt.eval(`qbfGame.activeLetters.length`) as number;
    type(chars[0]);
    type(chars[1]);
    const word = chars.slice(0, 2);
    type('Enter');
    expect(rt.eval(`qbfGame.activeLetters.length`)).toBe(nRackBefore - 2);
    expect(rt.eval(`qbfGame.logLines.length`)).toBe(1);
    expect(rt.eval(`qbfGame.logLines[0]`)).toContain(word);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(0);
    ticks(5); // and the game keeps running afterwards
  }, 60_000);

  it('checks words against a loaded list, scoring bad and repeated words against you', () => {
    const { rt, ticksUntil, type } = makeGame();
    rt.eval(`qbfSetWordList(['at', 'to'])`);
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 4`);
    // Force a known rack so the word is predictable.
    rt.eval(`
qbfGame.activeLetters.filter((l) => l.loc == 'rack').slice(0, 2).forEach((l, i) => {
  l.shape.setText(i == 0 ? 'A' : 'T');
});
true`);
    type('A');
    type('T');
    const letterScore = rt.eval(`qbfGame.letterScore`) as number;
    type('Enter');
    // 'at' is in the list, but two-letter words earn a x0 multiplier: no gain, no loss.
    expect(rt.eval(`qbfGame.logLines[0]`)).toContain('at'.toUpperCase());
    expect(rt.eval(`qbfGame.logLines[0]`)).not.toContain('??');
    expect(rt.eval(`qbfGame.totalScore`)).toBe(0);
    // A word that is not in the list is marked ?? and costs its letter score.
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 2`);
    rt.eval(`
qbfGame.activeLetters.filter((l) => l.loc == 'rack').slice(0, 2).forEach((l, i) => {
  l.shape.setText(i == 0 ? 'X' : 'Z');
});
true`);
    type('X');
    type('Z');
    const badScore = rt.eval(`qbfGame.letterScore`) as number;
    type('Enter');
    expect(rt.eval(`qbfGame.logLines[1]`)).toContain('??');
    expect(rt.eval(`qbfGame.totalScore`)).toBe(-badScore);
    expect(letterScore).toBeGreaterThan(0);
  }, 60_000);

  it('penalizes tiles that fall off the end, and tumbles them onto the pile', () => {
    const { rt, ticksUntil } = makeGame();
    ticksUntil(`qbfGame.nMissed > 0`);
    expect(rt.eval(`qbfGame.pointsMissed`)).toBeGreaterThan(0);
    expect(rt.eval(`qbfGame.totalScore`)).toBeLessThan(0);
    expect(rt.eval(`Number(qbfGame.missedPointsBox.shape.string)`)).toBe(
      rt.eval(`-qbfGame.pointsMissed`),
    );
    expect(rt.eval(`qbfGame.fallingLetters.length`)).toBeGreaterThan(0);
    // The tile lands on the pile and stops there.
    ticksUntil(`qbfGame.fallingLetters.length == 0`);
    const pileY = rt.eval(`qbfGame.pile.getBounds().topLeft.y`) as number;
    const landedY = rt.eval(
      `qbfGame.submorphs.filter((m) => m.loc == 'falling').map((m) => m.getBounds().bottomRight().y).pop()`,
    ) as number;
    expect(landedY).toBeCloseTo(pileY, 5);
  }, 60_000);

  it('pauses and resumes, and stops stepping while its window is collapsed', () => {
    const { rt, ticks } = makeGame();
    // Stay early so the tracked tile is still the belt letter (the only one tick moves
    // directly); later, mid-rack tiles only slide when pressed from the right.
    ticks(5);
    rt.eval(`qbfTrack = qbfGame.activeLetters[0]`);
    rt.eval(`qbfGame.doPause(true)`);
    expect(rt.eval(`qbfGame.paused`)).toBe(true);
    expect(rt.eval(`qbfGame.pauseButton.shape.string`)).toBe('resume');
    const pausedX = rt.eval(`qbfTrack.getBounds().topLeft.x`) as number;
    ticks(20);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBe(pausedX);
    rt.eval(`qbfGame.doPause(false)`);
    ticks(10);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBeLessThan(pausedX);
    // Collapsing the window is a pause too. Re-grab the current belt letter so we are
    // still watching a tile that tick will move.
    rt.eval(`qbfTrack = qbfGame.activeLetters[0]`);
    rt.eval(`qbfPanel.toggleCollapse()`);
    const collapsedX = rt.eval(`qbfTrack.getBounds().topLeft.x`) as number;
    ticks(20);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBe(collapsedX);
    rt.eval(`qbfPanel.toggleCollapse()`);
    ticks(10);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBeLessThan(collapsedX);
  }, 60_000);

  it('runs its buttons and clicks through the real event pipeline', () => {
    const { rt, dispatch, runFrame } = makeGame();
    const bx = rt.eval(
      `qbfGame.pauseButton.globalize(qbfGame.pauseButton.shape.getBounds().center()).x`,
    ) as number;
    const by = rt.eval(
      `qbfGame.pauseButton.globalize(qbfGame.pauseButton.shape.getBounds().center()).y`,
    ) as number;
    dispatch('pointerdown', bx, by);
    runFrame();
    dispatch('pointerup', bx, by);
    runFrame();
    expect(rt.eval(`qbfGame.paused`)).toBe(true);
    expect(rt.eval(`Lively.$keyboardFocus == qbfGame`)).toBe(true);
    dispatch('pointerdown', bx, by);
    runFrame();
    dispatch('pointerup', bx, by);
    runFrame();
    expect(rt.eval(`qbfGame.paused`)).toBe(false);
  }, 60_000);

  it('clicking a rack tile spells with it, and clicking it again takes it back', () => {
    const { rt, ticksUntil } = makeGame();
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 2`);
    // Drive QBFMorph.onPointerDown the way the world would after localizing into the
    // panel: letter hits are handled on pointerDown (buttons use pointerUp + focus).
    rt.eval(`
qbfLetter = qbfGame.activeLetters.filter((l) => l.loc == 'rack')[0];
qbfLocal = qbfGame.owner.localize(qbfLetter.globalize(qbfLetter.shape.getBounds().center()));
qbfGame.onPointerDown(qbfLocal, { actorID: 'actor-test', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
true`);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(1);
    rt.eval(`
qbfGame.onPointerDown(qbfLocal, { actorID: 'actor-test', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false });
true`);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(0);
  }, 60_000);

  it('switches levels, rebuilding the board and resizing the panel', () => {
    const { rt } = makeGame();
    const width = rt.eval(`qbfGame.getBounds().width()`) as number;
    rt.eval(`qbfGame.gameOver = true; qbfGame.chooseLevelNamed('not so quick')`);
    expect(rt.eval(`qbfGame.level.caption`)).toBe('not so quick');
    expect(rt.eval(`qbfGame.rackSize`)).toBe(9);
    expect(rt.eval(`qbfGame.multBoxes.length`)).toBe(9);
    expect(rt.eval(`qbfGame.levelButton.shape.string`)).toBe('not so quick');
    expect(rt.eval(`qbfGame.getBounds().width()`)).toBeGreaterThan(width);
    expect(rt.eval(`qbfPanel.getBounds().width()`)).toBe(rt.eval(`qbfGame.getBounds().width()`));
    expect(rt.eval(`qbfGame.gameOver`)).toBe(false); // a fresh game
    expect(rt.eval(`qbfGame.paused`)).toBe(false);
  }, 60_000);

  it('ends the game when the "!" tile falls off, and records the best game for the level', () => {
    const { rt, game, ticksUntil } = makeGame();
    rt.change(() => {
      while (game.activeLetters.length > 0) {
        (game.activeLetters as any).pop().remove();
      }
      (game as any).fallingLetters = [];
      if ((game as any).letterInBin) {
        (game as any).letterInBin.remove();
        (game as any).letterInBin = null;
      }
      (game as any).letterQueue = [];
    });
    // Build the "!" tile in one top-level statement chain (no let / nested scopes).
    rt.eval(`
qbfBang = new QBFLetterMorph('!', 0, qbfGame.letterExtent(), 24);
qbfGame.addMorph(qbfBang);
qbfBang.loc = 'rack';
qbfGame.placeBottomRight(qbfBang, qbfGame.rack.getBounds().topLeft.addPt(pt(0, 1)));
qbfGame.activeLetters = [qbfBang];
qbfGame.totalScore = 42;
qbfGame.totalScoreBox.setText('42');
true`);
    ticksUntil(`qbfGame.gameOver`);
    expect(rt.eval(`qbfGame.level.bestGameScore`)).toBe(42);
    expect(rt.eval(`qbfGame.logLines.pop()`)).toContain('game over');
    rt.eval(`qbfGame.doRestart()`);
    expect(rt.eval(`qbfGame.gameOver`)).toBe(false);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(0);
    expect(rt.eval(`qbfGame.level.bestGameScore`)).toBe(42);
    expect(rt.eval(`Number(qbfGame.bestGameBox.shape.string)`)).toBe(42);
  }, 60_000);

  it('encodes and decodes compact word lists', () => {
    const { rt } = makeGame();
    const words = ['aa', 'aah', 'aahed', 'aahing', 'aahs', 'aal', 'zoner'];
    rt.eval(`qbfWords = ${JSON.stringify(words)}; qbfCompact = qbfCompactStringFromArray(qbfWords)`);
    expect(rt.eval(`qbfCompactStringToArray(qbfCompact).join(',')`)).toBe(words.join(','));
    expect(rt.eval(`qbfCompact.length`)).toBeLessThan(words.join('').length);
    rt.eval(`qbfSetWordList(qbfCompact)`);
    expect(rt.eval(`qbfLookupWord('aahing')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('zoner')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('aa')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('nope')`)).toBe(false);
    // With no list loaded, anything goes.
    rt.eval(`qbfSetWordList(null)`);
    expect(rt.eval(`qbfLookupWord('nope')`)).toBe(true);
  }, 60_000);
});
