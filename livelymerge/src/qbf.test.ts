import { describe, expect, it } from 'vitest';
import { makeGame, readQBFWordsText } from './qbfHarness';

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
    expect(rt.eval(`qbfGame.nameButton.shape.string`)).toBe('choose name');
    expect(rt.eval(`qbfGame.scoresButton.shape.string`)).toBe('show scores');
    expect(rt.eval(`!!qbfGame.bestGameBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.topWordBox && qbfGame.topWordBox.shape.string`)).toBe('0');
    expect(rt.eval(`!!qbfGame.quickButton && !!qbfGame.superQuickButton && !!qbfGame.notSoQuickButton`)).toBe(
      true,
    );
    expect(rt.eval(`qbfGame.finishButton.shape.string`)).toBe('finish');
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('auto play');
    expect(rt.eval(`qbfGame.infoButton.shape.string`)).toBe('how to play');
    expect(rt.eval(`!!qbfGame.multiplierBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.soloModeButton && !!qbfGame.socialModeButton`)).toBe(true);
    expect(rt.eval(`qbfGame.playMode`)).toBe('solo');
    // pause up with autoplay's old row; finish where pause was; autoplay where finish was.
    expect(
      rt.eval(
        `qbfGame.pauseButton.getBounds().topLeft.y < qbfGame.finishButton.getBounds().topLeft.y`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.finishButton.getBounds().topLeft.y == qbfGame.autoPlayButton.getBounds().topLeft.y`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.infoButton.getBounds().topLeft.y == qbfGame.restartButton.getBounds().topLeft.y`,
      ),
    ).toBe(true);
    expect(rt.eval(`String(qbfGame.gameNumberLabel.shape.string)`)).toMatch(/^Game #/);
    expect(rt.eval(`String(qbfGame.epochStatus.shape.string)`)).toMatch(/ready|open/);
    expect(rt.eval(`!!qbfScores && qbfScores.className`)).toBe('QBFScoresMorph');
    expect(rt.eval(`!!qbfScores.quickButton`)).toBe(false);
    expect(rt.eval(`!!qbfScores.recentText && !!qbfScores.scoresText`)).toBe(true);
    expect(rt.eval(`!!qbfScores.recentScroll && qbfScores.recentScroll.className`)).toBe('TextPane');
    expect(rt.eval(`!!qbfScores.scoresScroll && qbfScores.scoresScroll.className`)).toBe('TextPane');
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
    ticksUntil(`qbfGame.fallingLetters.length > 0`);
    // Miss tally waits for the thump on landing — not the start of the fall.
    expect(rt.eval(`qbfGame.pointsMissed`)).toBe(0);
    expect(rt.eval(`Number(qbfGame.missedPointsBox.shape.string)`)).toBe(0);
    expect(rt.eval(`qbfGame.fallingLetters.length`)).toBeGreaterThan(0);
    // The tile lands on the pile ledge and stops there; then the miss is scored.
    ticksUntil(`qbfGame.fallingLetters.length == 0`);
    expect(rt.eval(`qbfGame.pointsMissed`)).toBeGreaterThan(0);
    expect(rt.eval(`qbfGame.totalScore`)).toBeLessThan(0);
    expect(rt.eval(`Number(qbfGame.missedPointsBox.shape.string)`)).toBe(
      rt.eval(`-qbfGame.pointsMissed`),
    );
    const landY = rt.eval(`qbfGame.pile.getBounds().topLeft.y`) as number;
    const landedY = rt.eval(
      `qbfGame.submorphs.filter((m) => m.loc == 'falling').map((m) => m.boundsInOwnerAfterTransform().bottom()).pop()`,
    ) as number;
    expect(landedY).toBeCloseTo(landY, 5);
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
    rt.eval(`qbfGame.buttonFired('pause'); true`);
    expect(rt.eval(`qbfGame.paused`)).toBe(true);
    expect(rt.eval(`qbfGame.pauseButton.shape.string`)).toBe('resume');
    rt.eval(`qbfGame.buttonFired('pause'); true`);
    expect(rt.eval(`qbfGame.paused`)).toBe(false);

    // Pointer press/release on the button itself (owner coords). Catches the
    // $hitPoint vs hitPoint regression that left every QBF button dead.
    // $hitPoint is ephemeral — check it in the same eval that sets it.
    rt.eval(`
qbfBtn = qbfGame.pauseButton;
qbfP = qbfBtn.getBounds().center();
qbfBtn.onPointerDown(qbfP, { actorID: 'test' });
qbfHitOk = qbfBtn.$hitPoint != null;
qbfBtn.onPointerUp(qbfP, { actorID: 'test' });
true`);
    expect(rt.eval(`qbfHitOk`)).toBe(true);
    expect(rt.eval(`qbfGame.paused`)).toBe(true);
    expect(rt.eval(`qbfGame.pauseButton.shape.string`)).toBe('resume');

    // World canvas pipeline: ephemeral panels must count as frontmost or every
    // click is eaten by bringTopLevelPanelToFrontIfNeeded.
    rt.eval(`qbfGame.buttonFired('pause'); true`); // unpause
    rt.eval(`qbfPanel.beTopMorph(); true`);
    rt.eval(`
qbfBtn = qbfGame.pauseButton;
qbfC = qbfBtn.owner.globalize(qbfBtn.getBounds().center());
true`);
    const cx = rt.eval(`qbfC.x`) as number;
    const cy = rt.eval(`qbfC.y`) as number;
    dispatch('pointerdown', cx, cy);
    runFrame();
    dispatch('pointerup', cx, cy);
    runFrame();
    expect(rt.eval(`qbfGame.paused`)).toBe(true);

    rt.eval(`qbfGame.buttonFired('scores'); true`);
    expect(rt.eval(`!!findQBFScoresViewer()`)).toBe(true);
  }, 60_000);

  it('clicking a rack tile spells with it, and clicking it again takes it back', () => {
    const { rt, ticksUntil } = makeGame();
    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 2`);
    rt.eval(`
qbfLetter = qbfGame.activeLetters.filter((l) => l.loc == 'rack')[0];
qbfGame.letterClicked(qbfLetter, {});
true`);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(1);
    rt.eval(`
qbfGame.letterClicked(qbfLetter, {});
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
    expect(rt.eval(`!!qbfGame.levelButton`)).toBe(false);
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
qbfGame.playerName = 'Tester';
true`);
    ticksUntil(`qbfGame.gameOver`);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(42);
    expect(rt.eval(`qbfGame.logLines.pop()`)).toContain('game over');
    expect(rt.eval(`!!qbfGame._finalScorePosted`)).toBe(true);
    rt.eval(`qbfGame.doRestart()`);
    expect(rt.eval(`qbfGame.gameOver`)).toBe(false);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(0);
    expect(rt.eval(`Number(qbfGame.topWordBox.shape.string)`)).toBe(0);
  }, 60_000);

  it('waits for falling tiles to land before posting the final score', () => {
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
    rt.eval(`
Lively.qbfHighScoreList = [];
qbfGame.playerName = 'Faller';
qbfGame.tournamentGameNumber = 777;
qbfGame.totalScore = 50;
qbfGame.bestWord = 'CAT';
qbfGame.bestWordScore = 5;
qbfFall = new QBFLetterMorph('Z', 10, qbfGame.letterExtent(), 24);
qbfGame.addMorph(qbfFall);
qbfFall.loc = 'falling';
qbfFall.pendingMissValue = 10;
qbfFall.vel = pt(0, 20);
qbfFall.rot = 0;
qbfGame.fallingLetters = [qbfFall];
qbfGame.placeBottomRight(qbfFall, qbfGame.pile.getBounds().topLeft.addPt(pt(40, -80)));
qbfBang = new QBFLetterMorph('!', 0, qbfGame.letterExtent(), 24);
qbfGame.addMorph(qbfBang);
qbfBang.loc = 'rack';
qbfGame.placeBottomRight(qbfBang, qbfGame.rack.getBounds().topLeft.addPt(pt(0, 1)));
qbfGame.activeLetters = [qbfBang];
true`);
    ticksUntil(`qbfGame.gameOver`);
    expect(rt.eval(`qbfGame._finalScorePosted`)).toBe(false);
    expect(rt.eval(`qbfScoresStore().getScoreEntries().length`)).toBe(0);
    ticksUntil(`qbfGame._finalScorePosted`);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(40);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].bestGame`)).toBe(40);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].gameNo`)).toBe(777);
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('#777');
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

  it('installs QBFWords.txt text lowercased, skipping words over nine characters', () => {
    // qbfInstallWordListText is the regeneration path for the embedded list, so its
    // parse rules must keep matching what qbfEmbeddedWordList was built with.
    const source = readQBFWordsText();
    expect(source.split(/\r?\n/).slice(0, 5)).toEqual(['AA', 'AAH', 'AAHED', 'AAHING', 'AAHS']);

    const { rt } = makeGame();
    rt.eval(`qbfWordsSource = ${JSON.stringify(source)}`);
    const result = rt.eval(`qbfInstallWordListText(qbfWordsSource)`) as string;

    expect(result).toMatch(/^\d+ words loaded$/);
    expect(rt.eval(`qbfCompactStringToArray($qbfWordList).slice(0, 5).join(',')`)).toBe(
      'aa,aah,aahed,aahing,aahs',
    );
    expect(rt.eval(`qbfLookupWord('aardwolf')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('aardwolves')`)).toBe(false); // ten characters
    expect(
      rt.eval(`qbfCompactStringToArray($qbfWordList).every((word) => word.length <= 9)`),
    ).toBe(true);
    // Regenerating from today's QBFWords.txt reproduces the embedded list exactly.
    expect(rt.eval(`$qbfWordList === qbfEmbeddedWordList()`)).toBe(true);
  }, 60_000);

  it('posts high scores through the pluggable store and refreshes the viewer', () => {
    const { rt } = makeGame();
    rt.eval(`
qbfGame.playerName = 'Ada';
qbfGame.totalScore = 99;
qbfGame.bestWord = 'QUICK';
qbfGame.bestWordScore = 20;
qbfGame.tournamentGameNumber = 321;
qbfGame.postScoresToStore();
true`);
    expect(rt.eval(`qbfScoresStore().getScoreEntries().length`)).toBe(1);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].bestGame`)).toBe(99);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].gameNo`)).toBe(321);
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('Ada');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('QUICK');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('#321');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('score');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('speed');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain(
      'Scores are only retained for 30 days',
    );
    // A worse score does not overwrite.
    rt.eval(`
qbfGame.totalScore = 10;
qbfGame.bestWordScore = 1;
qbfGame.tournamentGameNumber = 999;
qbfGame.postScoresToStore();
true`);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].bestGame`)).toBe(99);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].gameNo`)).toBe(321);
    // Swap stores without touching the game or viewer code.
    rt.eval(`
qbfAlt = new QBFMemoryScoresStore();
qbfSetScoresStore(qbfAlt);
qbfPostLevelScore('Bea', 'quick', { bestGame: 5, bestWord: 'BE', bestWordScore: 4, time: 't', gameNo: 12 });
true`);
    expect(rt.eval(`qbfScoresStore().getScoreEntries().length`)).toBe(1);
    expect(rt.eval(`qbfScoresStore().getScoreEntries()[0].player`)).toBe('Bea');
  }, 60_000);

  it('formats recent games and high scores with QBFGameScore columns', () => {
    const { rt } = makeGame();
    rt.eval(`
qbfPostRecentGameResult(new QBFGameScore(42, 'Ada', 'quick', 'FOX', 18, 100, '2026-07-25T12:00:00Z'));
qbfScores.refresh();
true`);
    const recent = rt.eval(`qbfScores.recentText.shape.string`) as string;
    expect(recent).toContain('score');
    expect(recent).toContain('player');
    expect(recent).toContain('Ada');
    expect(recent).toContain('FOX');
    expect(recent).toContain('#100');
    expect(recent).not.toContain('2026');
    const header = rt.eval(`QBFGameScore.headerRow().join(',')`) as string;
    expect(header).toBe('score,player,speed,best word,pts,game #,date');
    expect(rt.eval(`qbfFormatScoreTime('2026-07-25T15:30:00Z')`)).not.toContain('2026');
  }, 60_000);

  it('finish button cuts the tile queue down to a terminal "!"', () => {
    const { rt } = makeGame();
    expect(rt.eval(`qbfGame.letterQueue.length`)).toBeGreaterThan(1);
    rt.eval(`qbfGame.finishTiles()`);
    expect(rt.eval(`qbfGame.letterQueue.join('')`)).toBe('!');
    expect(rt.eval(`Number(qbfGame.nLeftBox.shape.string)`)).toBe(1);
    // Second finish while "!" is still queued stays a single bang.
    rt.eval(`qbfGame.finishTiles()`);
    expect(rt.eval(`qbfGame.letterQueue.join('')`)).toBe('!');
  }, 60_000);

  it('auto play finds the leftmost 4-letter lexicon word on the rack', () => {
    const { rt, game } = makeGame();
    rt.change(() => {
      while (game.activeLetters.length > 0) {
        (game.activeLetters as any).pop().remove();
      }
      if ((game as any).letterInBin) {
        (game as any).letterInBin.remove();
        (game as any).letterInBin = null;
      }
    });
    rt.eval(`
qbfSetWordList(['able','test','word']);
qbfGame.activeLetters = [];
['X','A','B','L','E','Z'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, 1, qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfMatch = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfMatch.word`)).toBe('ABLE');
    expect(rt.eval(`qbfMatch.letters.map((l) => l.shape.string).join('')`)).toBe('ABLE');

    // Reverse of a contiguous 4: ELBA on the rack, lexicon has able.
    rt.eval(`
qbfGame.activeLetters.slice().forEach((l) => l.remove());
qbfGame.activeLetters = [];
['E','L','B','A'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, 1, qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfMatch = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfMatch.word`)).toBe('ABLE');
    expect(rt.eval(`qbfMatch.letters.map((l) => l.shape.string).join('')`)).toBe('ABLE');

    // Five tiles with one spare: A X B L E → drop X → ABLE.
    rt.eval(`
qbfGame.activeLetters.slice().forEach((l) => l.remove());
qbfGame.activeLetters = [];
['A','X','B','L','E'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, 1, qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfMatch = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfMatch.word`)).toBe('ABLE');
    expect(rt.eval(`qbfMatch.letters.map((l) => l.shape.string).join('')`)).toBe('ABLE');

    rt.eval(`qbfGame.toggleAutoPlay()`);
    expect(rt.eval(`qbfGame.autoPlay`)).toBe(true);
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('auto: on');
  }, 60_000);

  it('starts a Game # epoch on first speed click and shares the queue for a minute', () => {
    const { rt } = makeGame();
    // Reset to idle social board: tournament starts only from social speed launch.
    rt.eval(`
Lively.qbfGameNumber = null;
Lively.qbfEpochStartMs = null;
qbfClearEpochEndTimer();
qbfGame.setPlayMode('social');
qbfGame.setup({ idle: true });
true`);
    // Idle: no tournament clock yet, display waits at 100, clock not stepping.
    expect(rt.eval(`Lively.qbfEpochStartMs == null`)).toBe(true);
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('ready');
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toContain(
      'Start a new game at your chosen speed',
    );

    rt.eval(`qbfGame.launchLevel('quick')`);
    // Game # is assigned/bumped at start (first ever → 100).
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfEpochStartMs != null`)).toBe(true);
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(100);
    const queue1 = rt.eval(`qbfGame.tournamentLetterQueue.join('')`) as string;
    expect(queue1.length).toBeGreaterThan(10);
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(true);
    expect(rt.eval(`Lively.$qbfEpochEndTimer != null`)).toBe(true);
    expect(rt.eval(`String(qbfGame.epochStatus.shape.string)`)).toMatch(/^open/);
    // After starting, idle help is hidden; re-idle social board shows the join message.
    rt.eval(`qbfGame.setup({ idle: true })`);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toContain('A game has been started');
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
    rt.eval(`qbfGame.launchLevel('quick')`);

    // A second signup in the same epoch joins the same number and letters.
    rt.eval(`
qbfJoin2 = qbfJoinOrStartTournamentGame();
true`);
    expect(rt.eval(`qbfJoin2.gameNumber`)).toBe(100);
    expect(rt.eval(`qbfJoin2.started`)).toBe(false);
    expect(rt.eval(`qbfJoin2.queue.join('')`)).toBe(queue1);

    // After the minute: epoch clears, Game # stays (bump happens on next start).
    rt.eval(`
Lively.qbfEpochStartMs = Date.now() - 61000;
qbfGame.tickGameClock();
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfEpochStartMs`)).toBe(null);
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('ready');
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);

    // Next signup bumps to 101; wrap 999 → 100.
    rt.eval(`qbfGame.launchLevel('super quick')`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(101);
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(101);
    expect(rt.eval(`qbfGame.tournamentLetterQueue.join('')`)).not.toBe(queue1);

    rt.eval(`
Lively.qbfGameNumber = 999;
Lively.qbfEpochStartMs = Date.now() - 61000;
qbfGame.tickGameClock();
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(999);
    expect(rt.eval(`Lively.qbfEpochStartMs`)).toBe(null);
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);
    rt.eval(`qbfGame.launchLevel('quick')`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    rt.eval(`qbfClearEpochEndTimer()`);
  }, 60_000);

  it('solo start bumps Game # and soft-idles after game over without clearing the board', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfGameNumber = null;
Lively.qbfEpochStartMs = null;
qbfClearEpochEndTimer();
qbfGame.setPlayMode('solo');
qbfGame.setup({ idle: true });
qbfGame.launchLevel('quick');
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfEpochStartMs`)).toBe(null);
    expect(rt.eval(`qbfGame.idle`)).toBe(false);

    rt.eval(`
qbfGame.playerName = 'Soloist';
qbfGame.gameOver = true;
qbfGame._finalScorePosted = false;
qbfGame.fallingLetters = [];
qbfKeepLog = qbfGame.wordLog.shape.string;
qbfGame.maybePostFinalScore();
true`);
    expect(rt.eval(`qbfGame.idle`)).toBe(true);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toContain('Start a new game');
    // Finished board left in place (log morph still present with prior text).
    expect(rt.eval(`qbfGame.wordLog.shape.string`)).toBe(rt.eval(`qbfKeepLog`));
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
  }, 60_000);

  it('switching solo/social abandons the board with no score and resets to idle', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfHighScoreList = [];
qbfGame.setPlayMode('solo');
qbfGame.playerName = 'Switcher';
qbfGame.totalScore = 99;
qbfGame.gameOver = false;
qbfGame._finalScorePosted = false;
qbfGame.setPlayMode('social');
true`);
    expect(rt.eval(`qbfGame.idle`)).toBe(true);
    expect(rt.eval(`qbfGame.playMode`)).toBe('social');
    expect(rt.eval(`(qbfGame.activeLetters || []).length`)).toBe(0);
    expect(rt.eval(`(Lively.qbfHighScoreList || []).length`)).toBe(0);
  }, 60_000);

  it('reinstalls the embedded word list when a game opens on a fresh replica', () => {
    const { rt } = makeGame();
    // A page reload clears per-replica state: no list means every word is accepted.
    rt.eval(`qbfSetWordList(null)`);
    expect(rt.eval(`qbfLookupWord('qqq')`)).toBe(true);
    rt.eval(`openQBFPlaying({ levelCaption: 'quick' })`);
    expect(rt.eval(`!!$qbfWordList`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('qqq')`)).toBe(false);
    expect(rt.eval(`qbfLookupWord('aardvark')`)).toBe(true);
    // openQBF (idle board) reinstalls too, and a loaded list is left alone.
    rt.eval(`qbfSetWordList(null); openQBF(pt(300, 10))`);
    expect(rt.eval(`qbfLookupWord('qqq')`)).toBe(false);
    rt.eval(`qbfSetWordList(['zzq'])`);
    expect(rt.eval(`qbfEnsureWordList()`)).toBe('word list already loaded');
    expect(rt.eval(`qbfLookupWord('zzq')`)).toBe(true);
  }, 60_000);

  it('scores viewer polls so scores that arrive by sync (no local notify) show up', () => {
    const { rt } = makeGame();
    // openQBFScores registered the 1s poll step with the world.
    expect(
      rt.eval(
        `Lively.activeStepList().some((s) => s.stepMorph === qbfScores && s.methodName === 'pollRemoteScores')`,
      ),
    ).toBe(true);
    // Seed the change counter, then mutate the store silently (as a synced remote
    // write would): with the counter unchanged, the poll leaves the pane alone.
    rt.eval(`
qbfScores.pollRemoteScores();
qbfScoresStore().entries.push({
  player: 'Remoter', level: 'quick', bestGame: 321,
  bestWord: 'synced', bestWordScore: 32, time: Date.now(), gameNo: 555,
});
qbfScores.pollRemoteScores();
true`);
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).not.toContain('Remoter');
    // Once the counter moves (a remote change arrived), the poll refreshes.
    rt.eval(`qbfScores._externalChangesSeen = -1; qbfScores.pollRemoteScores(); true`);
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('Remoter');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('321');
  }, 60_000);
});
