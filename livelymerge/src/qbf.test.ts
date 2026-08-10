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
    expect(rt.eval(`!!qbfGame.wordLog1 && !!qbfGame.wordLog2 && !!qbfGame.liveScoresLog`)).toBe(
      true,
    );
    expect(rt.eval(`qbfGame.wordLogLabel.shape.string`)).toBe('words played');
    expect(rt.eval(`qbfGame.wordLog1.shape.string.trim()`)).toBe('');
    expect(rt.eval(`qbfGame.liveScoresLabel.shape.string`)).toBe('active games');
    expect(rt.eval(`qbfGame.liveScoresLog.shape.string.trim()`)).toBe('');
    expect(
      rt.eval(
        `Math.abs(qbfGame.wordLog1.getBounds().width() - qbfGame.wordLog2.getBounds().width()) <= 1`,
      ),
    ).toBe(true);
    // Live scores sit under the speed column.
    expect(
      rt.eval(`
lay = qbfGame.computeLayout();
qbfGame.liveScoresLog.getBounds().topLeft.x == lay.launch.topLeft.x &&
qbfGame.liveScoresLog.getBounds().topLeft.y == lay.liveScores.topLeft.y &&
lay.liveScores.topLeft.y >= lay.launch.topLeft.y + 52 + 2 * lay.speedRow + lay.speedBtnH + 15
`),
    ).toBe(true);
    // Game # / speeds / active games start ~30px below the belt, ~20px right of the word list.
    expect(
      rt.eval(`
lay = qbfGame.computeLayout();
beltBottom = lay.belt.topLeft.y + 16 + 2;
Math.abs(lay.launch.topLeft.y - (beltBottom + 30)) <= 2 &&
Math.abs(lay.launch.topLeft.x - (lay.log.topLeft.x + lay.log.width() + 20 + qbfGame.letterW)) <= 2
`),
    ).toBe(true);
    // Autoplays / how to play / show scores share one horizontal row under the word list.
    expect(
      rt.eval(
        `qbfGame.autoPlayButton.getBounds().topLeft.y == qbfGame.infoButton.getBounds().topLeft.y &&
qbfGame.infoButton.getBounds().topLeft.y == qbfGame.scoresButton.getBounds().topLeft.y`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.autoPlayButton.getBounds().topLeft.y > qbfGame.wordLog1.getBounds().bottom() - 4`,
      ),
    ).toBe(true);
    expect(rt.eval(`qbfGame.wordLog === qbfGame.wordLog1`)).toBe(true);
    expect(rt.eval(`!!qbfGame.titleText && qbfGame.titleText.shape.string`)).toBe(
      'The Quick  Brow Fox',
    );
    expect(
      rt.eval(
        `Math.abs(qbfGame.titleText.getBounds().center().x - qbfGame.computeLayout().rack.center().x) <= 2`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.titleText.getBounds().topLeft.y == qbfGame.computeLayout().fox.topLeft.y`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.nameButton.getBounds().center().x == qbfGame.computeLayout().fox.center().x`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.nameButton.getBounds().topLeft.y == qbfGame.computeLayout().fox.bottom() + 20`,
      ),
    ).toBe(true);
    expect(rt.eval(`qbfGame.scoresButton.shape.string`)).toBe('show scores');
    expect(rt.eval(`!!qbfGame.pauseButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.finishButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.restartButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.bestGameBox`)).toBe(false);
    // Right-column score readouts are off (conflict with active-games block).
    expect(rt.eval(`!!qbfGame.letterScoreBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.totalScoreBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.topWordBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.topWordLetters`)).toBe(false);
    // Word-score tile sits left of the outbox while a board is playing.
    expect(rt.eval(`!!qbfGame.wordScoreBox && qbfGame.wordScoreBox.getBounds().width() > 0`)).toBe(
      true,
    );
    expect(
      rt.eval(
        `qbfGame.titleText.getBounds().width() >= qbfGame.computeLayout().rack.width() + 160`,
      ),
    ).toBe(true);
    expect(rt.eval(`!!qbfGame.quickButton && !!qbfGame.superQuickButton && !!qbfGame.notSoQuickButton`)).toBe(
      true,
    );
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('auto play');
    expect(rt.eval(`qbfGame.infoButton.shape.string`)).toBe('how to play');
    expect(rt.eval(`!!qbfGame.multiplierBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.soloModeButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.socialModeButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.clearButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.backButton`)).toBe(false);
    expect(rt.eval(`!!qbfGame.enterButton`)).toBe(false);
    expect(rt.eval(`qbfGame.quickButton.getBounds().height()`)).toBe(22);
    // Game # sits in the launch column (with the speed buttons).
    expect(
      rt.eval(`
lay = qbfGame.computeLayout();
qbfGame.gameNumberLabel.getBounds().topLeft.x == lay.launch.topLeft.x &&
qbfGame.gameNumberLabel.getBounds().topLeft.y == lay.launch.topLeft.y
`),
    ).toBe(true);
    // Horizontal control row: autoplay left of how-to-play left of show-scores.
    expect(
      rt.eval(
        `qbfGame.autoPlayButton.getBounds().topLeft.x < qbfGame.infoButton.getBounds().topLeft.x`,
      ),
    ).toBe(true);
    expect(
      rt.eval(
        `qbfGame.infoButton.getBounds().topLeft.x < qbfGame.scoresButton.getBounds().topLeft.x`,
      ),
    ).toBe(true);
    expect(rt.eval(`String(qbfGame.gameNumberLabel.shape.string)`)).toMatch(/^Game #/);
    expect(rt.eval(`String(qbfGame.epochStatus.shape.string)`)).toMatch(/ready|open|playing/);
    expect(
      rt.eval(
        `qbfGame.epochStatus.getBounds().topLeft.x === qbfGame.computeLayout().launch.topLeft.x + 3`,
      ),
    ).toBe(true);
    expect(rt.eval(`!!qbfScores && qbfScores.className`)).toBe('QBFScoresMorph');
    expect(rt.eval(`!!qbfScores.quickButton`)).toBe(false);
    expect(rt.eval(`!!qbfScores.recentText && !!qbfScores.scoresText`)).toBe(true);
    expect(rt.eval(`!!qbfScores.recentScroll && qbfScores.recentScroll.className`)).toBe('TextPane');
    expect(rt.eval(`!!qbfScores.scoresScroll && qbfScores.scoresScroll.className`)).toBe('TextPane');
    // Wide enough that the date column ("Jul 25 12:00") is not clipped.
    expect(rt.eval(`qbfScores.getBounds().width()`)).toBe(578);
    expect(rt.eval(`qbfScores.recentScroll.getBounds().width()`)).toBe(558);
    expect(rt.eval(`qbfScores.scoresScroll.getBounds().width()`)).toBe(558);
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
    expect(rt.eval(`qbfGame.$logLines.length`)).toBe(1);
    expect(rt.eval(`qbfGame.$logLines[0]`)).toContain(word);
    expect(rt.eval(`qbfGame.outboxLetters.length`)).toBe(0);
    expect(rt.eval(`qbfGame.wordLog1.shape.string`)).toContain(word);
    // Live scores only fill once a Game # is claimed (tournament launch).
    expect(
      rt.eval(
        `qbfGame.tournamentGameNumber == null || /\\d/.test(qbfGame.liveScoresLog.shape.string)`,
      ),
    ).toBe(true);
    ticks(5); // and the game keeps running afterwards
  }, 60_000);

  it('tracks live active-player scores for the current Game # in column 3', () => {
    const { rt, ticksUntil, type } = makeGame();
    rt.eval(`
Lively.qbfLiveScores = [];
Lively.qbfLiveGameNumber = null;
Lively.qbfGameNumber = 100;
Lively.qbfEpochStartMs = Date.now();
Lively.qbfEpochSpeed = 'quick';
qbfGame.playerName = 'Ada';
qbfGame.tournamentGameNumber = 100;
qbfGame.reportLiveScore();
true`);
    expect(rt.eval(`qbfLiveScoreRowsForGame(100).length`)).toBe(1);
    expect(rt.eval(`qbfLiveScoreRowsForGame(100)[0].player`)).toBe('Ada');
    expect(rt.eval(`qbfGame.liveScoresLog.shape.string`)).toContain('Ada');
    expect(rt.eval(`Number(qbfGame.liveScoresLog.shape.font.replace(/px.*/, ''))`)).toBe(12);

    ticksUntil(`qbfGame.activeLetters.filter((l) => l.loc == 'rack').length >= 2`);
    rt.eval(`
qbfGame.activeLetters.filter((l) => l.loc == 'rack').slice(0, 2).forEach((l, i) => {
  l.shape.setText(i == 0 ? 'A' : 'T');
});
true`);
    type('A');
    type('T');
    type('Enter');
    expect(rt.eval(`qbfLiveScoreRowsForGame(100)[0].score`)).toBe(
      rt.eval(`qbfGame.totalScore`),
    );

    rt.eval(`
qbfPostLiveScore('Bea', 40, 100);
qbfPostLiveScore('VeryLongPlayerNameXYZ', 7, 100);
qbfGame.refreshLiveScoresPane();
true`);
    expect(rt.eval(`qbfLiveScoreRowsForGame(100).length`)).toBe(3);
    expect(rt.eval(`qbfGame.liveScoresLog.shape.string`)).toContain('Bea');
    expect(rt.eval(`qbfGame.liveScoresLog.shape.string`)).toContain('VeryLongPlay');
    expect(rt.eval(`qbfGame.liveScoresLog.shape.string.indexOf('VeryLongPlayerNameXYZ') < 0`)).toBe(
      true,
    );
    // Column 2 only fills after column 1 is full (height-based).
    rt.eval(`
qbfGame.resetWordLog();
for (let i = 0; i < qbfGame.logColumnMaxRows() + 2; i++) qbfGame.appendLog('x' + i);
true`);
    expect(rt.eval(`qbfGame.wordLogLabel.shape.string`)).toBe('words played');
    expect(rt.eval(`qbfGame.wordLog1.shape.string`)).toContain('x0');
    expect(rt.eval(`qbfGame.wordLog2.shape.string`)).toContain('x');
    // Column 2 starts only after column 1 is full.
    expect(
      rt.eval(
        `qbfGame.wordLog1.shape.string.split('\\n').length == qbfGame.logColumnMaxRows()`,
      ),
    ).toBe(true);
  }, 60_000);

  it('assigns Dan 2 when a second board joins with the same player name', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfLiveScores = [];
Lively.qbfLiveGameNumber = null;
Lively.qbfGameNumber = 100;
Lively.qbfEpochStartMs = Date.now();
Lively.qbfEpochSpeed = 'quick';
qbfPostLiveScore('Dan', 0, 100);
qbfA = qbfClaimUniqueLiveName('Dan', 100);
qbfB = qbfClaimUniqueLiveName('Bea', 100);
true`);
    expect(rt.eval(`qbfA`)).toBe('Dan 2');
    expect(rt.eval(`qbfB`)).toBe('Bea');
  }, 60_000);

  it('claims Otto 2 when a second board enables autoplay', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfLiveScores = [];
Lively.qbfLiveGameNumber = null;
Lively.qbfGameNumber = 100;
Lively.qbfEpochStartMs = Date.now();
Lively.qbfEpochSpeed = 'quick';
qbfGame.tournamentGameNumber = 100;
qbfGame.idle = false;
qbfGame.playerName = 'Ada';
qbfGame.$livePlayerName = null;
qbfGame.$liveNameForGame = null;
qbfGame.reportLiveScore();
qbfGame.toggleAutoPlay();
qbfFirst = qbfGame.playerName;
// Simulate another board already named Otto, then a second claim.
qbfSecond = qbfClaimUniqueLiveName('Otto', 100);
true`);
    expect(rt.eval(`qbfFirst`)).toBe('Otto');
    expect(rt.eval(`qbfSecond`)).toBe('Otto 2');
    expect(rt.eval(`qbfGame.nameButton.shape.string`)).toBe('Otto');
  }, 60_000);

  it('keeps active games after the epoch ends, and flips to final scores when all finish', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfGameNumber = 100;
Lively.qbfEpochStartMs = Date.now();
Lively.qbfEpochSpeed = 'quick';
Lively.qbfLiveScores = [
  { player: 'Ada', score: 10, gameNo: 100, finished: false },
  { player: 'Bea', score: 20, gameNo: 100, finished: false },
];
Lively.qbfLiveGameNumber = 100;
qbfGame.tournamentGameNumber = 100;
qbfGame.refreshLiveScoresPane();
qbfActive = qbfGame.liveScoresLog.shape.string;
Lively.qbfEpochStartMs = Date.now() - 31000;
qbfCloseTournamentEpoch();
qbfAfterEpoch = qbfGame.liveScoresLog.shape.string;
qbfLen = Lively.qbfLiveScores.length;
qbfPostLiveScore('Ada', 99, 100);
qbfAdaScore = qbfLiveScoreRowsForGame(100).find((r) => r.player === 'Ada').score;
qbfPostLiveScore('Ada', 99, 100, { finished: true });
qbfMid = qbfLiveScoresHeaderFor(100);
qbfPostLiveScore('Bea', 40, 100, { finished: true });
qbfGame.refreshLiveScoresPane();
qbfFinal = qbfGame.liveScoresLog.shape.string;
qbfHeader = qbfLiveScoresHeaderFor(100);
true`);
    expect(rt.eval(`qbfActive`)).toContain('Ada');
    expect(rt.eval(`qbfLen`)).toBe(2);
    expect(rt.eval(`qbfAfterEpoch`)).toContain('Ada');
    expect(rt.eval(`qbfAdaScore`)).toBe(99);
    expect(rt.eval(`qbfMid`)).toBe('active games');
    expect(rt.eval(`qbfHeader`)).toBe('final scores');
    expect(rt.eval(`qbfFinal`)).toContain('Ada');
    expect(rt.eval(`qbfFinal`)).toContain('Bea');
    expect(rt.eval(`qbfGame.liveScoresLabel.shape.string`)).toBe('final scores');
  }, 60_000);

  it('checks words against a loaded list, scoring bad words against you', () => {
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
    expect(rt.eval(`qbfGame.$logLines[0]`)).toContain('at'.toUpperCase());
    expect(rt.eval(`qbfGame.$logLines[0]`)).not.toContain('??');
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
    expect(rt.eval(`qbfGame.$logLines[1]`)).toContain('??');
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
    const pausedX = rt.eval(`qbfTrack.getBounds().topLeft.x`) as number;
    ticks(20);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBe(pausedX);
    rt.eval(`qbfGame.doPause(false)`);
    ticks(10);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBeLessThan(pausedX);
    // Collapse drops steppers (board leaves the world). Expand must restart them.
    rt.eval(`qbfTrack = qbfGame.activeLetters[0]`);
    expect(rt.eval(`qbfGame.isStepping('tick')`)).toBe(true);
    rt.eval(`qbfPanel.toggleCollapse()`);
    expect(rt.eval(`qbfPanel.collapsed`)).toBe(true);
    expect(rt.eval(`qbfGame.isInWorld()`)).toBe(false);
    rt.eval(`qbfPanel.toggleCollapse()`);
    expect(rt.eval(`qbfPanel.collapsed`)).toBe(false);
    expect(rt.eval(`qbfGame.isStepping('tick')`)).toBe(true);
    const expandedX = rt.eval(`qbfTrack.getBounds().topLeft.x`) as number;
    ticks(10);
    expect(rt.eval(`qbfTrack.getBounds().topLeft.x`)).toBeLessThan(expandedX);
  }, 60_000);

  it('runs its buttons and clicks through the real event pipeline', () => {
    const { rt, dispatch, runFrame } = makeGame();
    // Pause / finish are locked (and currently hidden); firing them is a no-op.
    rt.eval(`qbfGame.buttonFired('pause'); true`);
    expect(rt.eval(`qbfGame.paused`)).toBe(false);
    expect(rt.eval(`!!qbfGame.pauseButton`)).toBe(false);
    rt.eval(`
qbfBeforeFinish = qbfGame.letterQueue.join('');
qbfGame.buttonFired('finishTiles');
true`);
    expect(rt.eval(`qbfGame.letterQueue.join('')`)).toBe(rt.eval(`qbfBeforeFinish`));
    expect(rt.eval(`!!qbfGame.finishButton`)).toBe(false);

    // Pointer press/release on a live button (owner coords). Catches the
    // $hitPoint vs hitPoint regression that left every QBF button dead.
    // $hitPoint is ephemeral — check it in the same eval that sets it.
    rt.eval(`
qbfBtn = qbfGame.autoPlayButton;
qbfP = qbfBtn.getBounds().center();
qbfBtn.onPointerDown(qbfP, { actorID: 'test' });
qbfHitOk = qbfBtn.$hitPoint != null;
qbfBtn.onPointerUp(qbfP, { actorID: 'test' });
true`);
    expect(rt.eval(`qbfHitOk`)).toBe(true);
    expect(rt.eval(`qbfGame.autoPlay`)).toBe(true);
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('Otto');
    expect(rt.eval(`qbfGame.playerName`)).toBe('Otto');

    // World canvas pipeline: ephemeral panels must count as frontmost or every
    // click is eaten by bringTopLevelPanelToFrontIfNeeded.
    rt.eval(`qbfGame.buttonFired('autoPlay'); true`); // toggle off
    expect(rt.eval(`qbfGame.autoPlay`)).toBe(false);
    expect(rt.eval(`qbfGame.playerName`)).toBe('Anonymous');
    rt.eval(`qbfPanel.beTopMorph(); true`);
    rt.eval(`
qbfBtn = qbfGame.autoPlayButton;
qbfC = qbfBtn.owner.globalize(qbfBtn.getBounds().center());
true`);
    const cx = rt.eval(`qbfC.x`) as number;
    const cy = rt.eval(`qbfC.y`) as number;
    dispatch('pointerdown', cx, cy);
    runFrame();
    dispatch('pointerup', cx, cy);
    runFrame();
    expect(rt.eval(`qbfGame.autoPlay`)).toBe(true);
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('Otto');
    expect(rt.eval(`qbfGame.playerName`)).toBe('Otto');

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
qbfGame.playerName = 'Tester';
true`);
    ticksUntil(`qbfGame.gameOver`);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(42);
    expect(rt.eval(`qbfGame.$logLines.pop()`)).toContain('game over');
    expect(rt.eval(`!!qbfGame._finalScorePosted`)).toBe(true);
    // Restart is locked in social play; a fresh setup rebuilds the board.
    rt.eval(`qbfGame.doRestart(); true`);
    expect(rt.eval(`qbfGame.gameOver`)).toBe(true);
    rt.eval(`qbfGame.setup(); true`);
    expect(rt.eval(`qbfGame.gameOver`)).toBe(false);
    expect(rt.eval(`qbfGame.totalScore`)).toBe(0);
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

  it('adds words into a compact list, keeping sort and encoding', () => {
    const { rt } = makeGame();
    rt.eval(`
      qbfBase = qbfCompactStringFromArray(['able', 'acid', 'zebra']);
      qbfAdded = qbfAddWordsToCompactString(qbfBase, ['vape', 'ABLE', 'toolongword', 'evite']);
    `);
    expect(rt.eval(`qbfAdded.added.slice().sort().join(',')`)).toBe('evite,vape');
    expect(rt.eval(`qbfAdded.words.join(',')`)).toBe('able,acid,evite,vape,zebra');
    expect(rt.eval(`qbfCompactStringToArray(qbfAdded.compact).join(',')`)).toBe(
      'able,acid,evite,vape,zebra',
    );
    // Embedded list should include the test additions from regeneration.
    expect(rt.eval(`qbfLookupWord('vape')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('vapes')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('evite')`)).toBe(true);
    expect(rt.eval(`qbfLookupWord('evites')`)).toBe(true);
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
    // Embedded list may include extra hand-added words beyond QBFWords.txt
    // (see qbfAddWordsToEmbeddedList in QBF.js); do not require byte-equality.
    expect(rt.eval(`$qbfWordList.length < qbfEmbeddedWordList().length`)).toBe(true);
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
qbfPostRecentGameResult(new QBFGameScore(9, 'VeryLongPlayerNameXYZ', 'quick', 'HI', 2, 101, '2026-07-25T12:01:00Z'));
qbfScores.refresh();
true`);
    const recent = rt.eval(`qbfScores.recentText.shape.string`) as string;
    expect(recent).toContain('score');
    expect(recent).toContain('player');
    expect(recent).toContain('Ada');
    expect(recent).toContain('VeryLongPlay');
    expect(recent).not.toContain('VeryLongPlayerNameXYZ');
    expect(recent).toContain('FOX');
    expect(recent).toContain('#100');
    expect(recent).not.toContain('2026');
    const header = rt.eval(`QBFGameScore.headerRow().join(',')`) as string;
    expect(header).toBe('score,player,speed,best word,pts,game #,date');
    expect(rt.eval(`qbfFormatScoreTime('2026-07-25T15:30:00Z')`)).not.toContain('2026');
    expect(rt.eval(`qbfTruncateName('VeryLongPlayerNameXYZ', 12)`)).toBe('VeryLongPlay');
  }, 60_000);

  it('shows top 5 high scores per speed and keeps recent games height fixed', () => {
    const { rt } = makeGame();
    rt.eval(`
qbfAlt = new QBFMemoryScoresStore();
qbfSetScoresStore(qbfAlt);
// 6 quick scores from different players — only top 5 should appear.
[90,80,70,60,50,40].forEach((sc, i) => {
  qbfPostLevelScore('P'+i, 'quick', {
    bestGame: sc, bestWord: 'W', bestWordScore: 1, time: Date.now(), gameNo: 100+i,
  });
});
// Same player, 6 more quick games — each Game # is kept; top 5 still by score.
[95,85,75,65,55,45].forEach((sc, i) => {
  qbfPostLevelScore('Repeat', 'quick', {
    bestGame: sc, bestWord: 'R', bestWordScore: 1, time: Date.now(), gameNo: 400+i,
  });
});
qbfPostLevelScore('Fast', 'super quick', {
  bestGame: 120, bestWord: 'Z', bestWordScore: 2, time: Date.now(), gameNo: 200,
});
qbfPostLevelScore('Slow', 'not so quick', {
  bestGame: 30, bestWord: 'A', bestWordScore: 1, time: Date.now(), gameNo: 300,
});
qbfScores.refresh();
qbfRecentH = qbfScores.recentScroll.getBounds().height();
qbfHighH = qbfScores.scoresScroll.getBounds().height();
qbfText = qbfScores.scoresText.shape.string;
qbfQuickRows = qbfTopScoresPerLevel(
  qbfAlt.getScoreEntries().map((e) => QBFGameScore.fromAny(e)),
  5,
).filter((s) => s.speed === 'quick');
true`);
    expect(rt.eval(`qbfRecentH`)).toBe(220);
    // High-scores pane tall enough for header + 15 rows + footer at 14px line height.
    expect(rt.eval(`qbfHighH >= 17 * 14`)).toBe(true);
    expect(rt.eval(`qbfText`)).toContain('Fast');
    expect(rt.eval(`qbfText`)).toContain('Slow');
    expect(rt.eval(`qbfText`)).toContain('Repeat'); // multi-game player
    expect(rt.eval(`qbfText`)).toContain('P0'); // 90 still in mix if high enough
    expect(rt.eval(`qbfQuickRows.length`)).toBe(5);
    expect(rt.eval(`qbfQuickRows[0].score`)).toBe(95);
    expect(rt.eval(`qbfQuickRows.filter((s) => s.player === 'Repeat').length >= 2`)).toBe(true);
    expect(rt.eval(`qbfTopScoresPerLevel([
      new QBFGameScore(1,'a','quick','',0,1,''),
      new QBFGameScore(2,'b','quick','',0,2,''),
      new QBFGameScore(3,'c','quick','',0,3,''),
      new QBFGameScore(4,'d','quick','',0,4,''),
      new QBFGameScore(5,'e','quick','',0,5,''),
      new QBFGameScore(6,'f','quick','',0,6,''),
    ], 5).map((s) => s.player).join(',')`)).toBe('f,e,d,c,b');
  }, 60_000);

  it('omits high scores older than 30 days from the top-scores pane', () => {
    const { rt } = makeGame();
    rt.eval(`
qbfAlt = new QBFMemoryScoresStore();
qbfSetScoresStore(qbfAlt);
let now = Date.now();
let old = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
let recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
qbfPostLevelScore('Oldie', 'quick', {
  bestGame: 999, bestWord: 'OLD', bestWordScore: 9, time: old, gameNo: 501,
});
qbfPostLevelScore('Newbie', 'quick', {
  bestGame: 50, bestWord: 'NEW', bestWordScore: 5, time: recent, gameNo: 502,
});
// Refresh prunes expired rows and must not display them.
qbfScores.refresh();
qbfText = qbfScores.scoresText.shape.string;
qbfAfter = qbfAlt.getScoreEntries().length;
qbfFreshOk = qbfScoreIsFresh(recent);
qbfOldBad = !qbfScoreIsFresh(old);
true`);
    expect(rt.eval(`qbfFreshOk`)).toBe(true);
    expect(rt.eval(`qbfOldBad`)).toBe(true);
    expect(rt.eval(`qbfAfter`)).toBe(1);
    expect(rt.eval(`qbfText`)).toContain('Newbie');
    expect(rt.eval(`qbfText`)).not.toContain('Oldie');
    expect(rt.eval(`qbfText`)).not.toContain('999');
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
    expect(rt.eval(`qbfGame.autoPlayButton.shape.string`)).toBe('Otto');
    expect(rt.eval(`qbfGame.playerName`)).toBe('Otto');
  }, 60_000);

  it('starts a Game # epoch on first speed click and shares the queue for 30 seconds', () => {
    const { rt } = makeGame();
    // Reset to idle board: tournament starts from speed launch.
    rt.eval(`
Lively.qbfGameNumber = null;
Lively.qbfEpochStartMs = null;
Lively.qbfEpochSpeed = null;
qbfClearEpochEndTimer();
qbfGame.setup({ idle: true });
true`);
    // Idle: no tournament clock yet, display waits without a fake #100.
    expect(rt.eval(`Lively.qbfEpochStartMs == null`)).toBe(true);
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #—');
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('ready');
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toContain(
      'Start a new game at your chosen speed',
    );
    // Idle startup: no right-column scores; word-score tile hidden until play.
    expect(rt.eval(`!!qbfGame.letterScoreBox`)).toBe(false);
    expect(rt.eval(`!!qbfGame.topWordBox`)).toBe(false);
    expect(
      rt.eval(`!!qbfGame.wordScoreBox && qbfGame.wordScoreBox.getBounds().width() === 0`),
    ).toBe(true);
    // Idle help sits 4px above the rack rail.
    expect(
      rt.eval(
        `qbfGame.idleHelpPlate.getBounds().bottom() == qbfGame.rack.getBounds().topLeft.y - 4`,
      ),
    ).toBe(true);

    // First ever start is Game #100 (not random).
    rt.eval(`qbfGame.launchLevel('quick'); true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfShuffleGen`)).toBe(1);
    expect(rt.eval(`Lively.qbfEpochStartMs != null`)).toBe(true);
    expect(rt.eval(`Lively.qbfEpochSpeed`)).toBe('quick');
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(100);
    // Speeds stay in home slots; word score is a tile left of the outbox.
    expect(
      rt.eval(`
qbfGame.quickButton.getBounds().topLeft.y === qbfGame.$launchBtnHomes.quick.topLeft.y &&
qbfGame.superQuickButton.getBounds().width() > 0 &&
qbfGame.notSoQuickButton.getBounds().width() > 0
`),
    ).toBe(true);
    expect(rt.eval(`!!qbfGame.wordScoreBox`)).toBe(true);
    expect(
      rt.eval(`
lay = qbfGame.computeLayout();
ws = qbfGame.wordScoreBox.getBounds();
outY = lay.outbox.topLeft.y + 1 - qbfGame.letterH;
ws.width() === qbfGame.letterW &&
ws.height() === qbfGame.letterH &&
Math.abs(ws.topLeft.x - (lay.outbox.topLeft.x - 2 * qbfGame.letterW)) <= 1 &&
ws.topLeft.y === outY &&
Number(qbfGame.wordScoreBox.shape.font.replace(/px.*/, '')) === 24 &&
qbfGame.wordScoreBox.shape.borderWidth === 2 &&
!!qbfGame.wordScoreBox.$scoreLabel &&
qbfGame.wordScoreBox.$scoreLabel.shape.string === 'points'
`),
    ).toBe(true);
    const queue1 = rt.eval(`qbfGame.tournamentLetterQueue.join('')`) as string;
    expect(queue1.length).toBeGreaterThan(10);
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(true);
    expect(rt.eval(`Lively.$qbfEpochEndTimer != null`)).toBe(true);
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('playing');
    // All speeds remain visible while playing (chosen one stays enabled).
    expect(rt.eval(`qbfGame.quickButton.getBounds().width()`)).toBeGreaterThan(0);
    expect(rt.eval(`qbfGame.superQuickButton.getBounds().width()`)).toBeGreaterThan(0);
    expect(rt.eval(`qbfGame.notSoQuickButton.getBounds().width()`)).toBeGreaterThan(0);
    // After starting, idle help is hidden; re-idle board shows the join message.
    rt.eval(`qbfGame.setup({ idle: true })`);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toContain('A game is open');
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
    expect(rt.eval(`String(qbfGame.epochStatus.shape.string)`)).toMatch(/^open/);
    expect(rt.eval(`qbfGame.quickButton.getBounds().width()`)).toBeGreaterThan(0);
    expect(rt.eval(`qbfGame.superQuickButton.getBounds().width()`)).toBeGreaterThan(0);
    rt.eval(`qbfGame.launchLevel('quick')`);
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('playing');

    // A second signup in the same epoch joins the same number and letters.
    rt.eval(`
qbfJoin2 = qbfJoinOrStartTournamentGame('quick');
true`);
    expect(rt.eval(`qbfJoin2.gameNumber`)).toBe(100);
    expect(rt.eval(`qbfJoin2.started`)).toBe(false);
    expect(rt.eval(`qbfJoin2.queue.join('')`)).toBe(queue1);
    // Wrong speed is rejected while the window is open.
    expect(rt.eval(`qbfJoinOrStartTournamentGame('super quick').rejected`)).toBe(true);

    // After 30s: epoch clears, Game # stays (bump happens on next start).
    rt.eval(`
Lively.qbfEpochStartMs = Date.now() - 31000;
qbfGame.tickGameClock();
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfEpochStartMs`)).toBe(null);
    expect(rt.eval(`Lively.qbfEpochSpeed`)).toBe(null);
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #100');
    // Epoch closed, but this panel is still mid-game → stay on "playing".
    expect(rt.eval(`qbfGame.epochStatus.shape.string`)).toBe('playing');
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);

    // Next signup bumps to 101; wrap 999 → 100.
    rt.eval(`qbfGame.launchLevel('super quick')`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(101);
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(101);
    expect(rt.eval(`qbfGame.tournamentLetterQueue.join('')`)).not.toBe(queue1);

    rt.eval(`
Lively.qbfGameNumber = 999;
Lively.qbfEpochStartMs = Date.now() - 31000;
Lively.qbfEpochSpeed = 'quick';
qbfGame.tickGameClock();
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(999);
    expect(rt.eval(`Lively.qbfEpochStartMs`)).toBe(null);
    expect(rt.eval(`qbfGame.isStepping('tickGameClock')`)).toBe(false);
    rt.eval(`
qbfGenBeforeWrap = Lively.qbfShuffleGen;
qbfGame.launchLevel('quick');
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(100);
    expect(rt.eval(`Lively.qbfShuffleGen`)).toBe(rt.eval(`qbfGenBeforeWrap + 1`));
    // Wrapped Game #100 must not reuse the first visit's letter queue.
    expect(rt.eval(`qbfGame.tournamentLetterQueue.join('')`)).not.toBe(queue1);
    rt.eval(`qbfClearEpochEndTimer()`);
  }, 60_000);

  it('soft-idles after game over without clearing the board', () => {
    const { rt } = makeGame();
    rt.eval(`
Lively.qbfGameNumber = 100;
Lively.qbfEpochStartMs = null;
Lively.qbfEpochSpeed = null;
qbfClearEpochEndTimer();
qbfGame.setup({ idle: true });
qbfGame.launchLevel('quick');
true`);
    expect(rt.eval(`Lively.qbfGameNumber`)).toBe(101);
    expect(rt.eval(`qbfGame.tournamentGameNumber`)).toBe(101);
    expect(rt.eval(`Lively.qbfEpochStartMs != null`)).toBe(true);
    expect(rt.eval(`qbfGame.idle`)).toBe(false);

    rt.eval(`
qbfGame.playerName = 'Player';
qbfGame.gameOver = true;
qbfGame._finalScorePosted = false;
qbfGame.fallingLetters = [];
qbfKeepLog = qbfGame.wordLog.shape.string;
qbfGame.maybePostFinalScore();
true`);
    expect(rt.eval(`qbfGame.idle`)).toBe(true);
    expect(rt.eval(`qbfGame.idleHelpText.shape.string`)).toMatch(/Start a new game|A game is open/);
    // Finished board left in place (log morph still present with prior text).
    expect(rt.eval(`qbfGame.wordLog.shape.string`)).toBe(rt.eval(`qbfKeepLog`));
    // Word-score tile hidden so the board looks ready for another game.
    expect(
      rt.eval(`!!qbfGame.wordScoreBox && qbfGame.wordScoreBox.getBounds().width() === 0`),
    ).toBe(true);
    expect(rt.eval(`qbfGame.gameNumberLabel.shape.string`)).toBe('Game #101');
  }, 60_000);

  it('advances shuffle generation so wrapped Game #s get fresh letter queues', () => {
    const { rt } = makeGame();
    rt.eval(`
qbfClearEpochEndTimer();
Lively.qbfGameNumber = null;
Lively.qbfShuffleGen = 0;
qbfQ100a = qbfTileQueueForGame(100, 1).join('');
qbfQ100b = qbfTileQueueForGame(100, 2).join('');
qbfN1 = qbfBumpGameNumber();
qbfG1 = Lively.qbfShuffleGen;
qbfN2 = qbfBumpGameNumber();
true`);
    expect(rt.eval(`qbfN1`)).toBe(100);
    expect(rt.eval(`qbfG1`)).toBe(1);
    expect(rt.eval(`qbfN2`)).toBe(101);
    expect(rt.eval(`Lively.qbfShuffleGen`)).toBe(2);
    expect(rt.eval(`qbfQ100a === qbfQ100b`)).toBe(false);
  }, 60_000);

  it('Otto tries 5 then 4, and uses the Otto player name', () => {
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
    // Prefers 5 when available.
    rt.eval(`
qbfSetWordList(['able', 'ables']);
qbfGame.activeLetters.slice().forEach((l) => l.remove());
qbfGame.activeLetters = [];
['A','B','L','E','S'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, qbfGame.letterValue(ch), qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfOtto = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfOtto.word`)).toBe('ABLES');

    // Six available, but Otto still prefers 5.
    rt.eval(`
qbfSetWordList(['able', 'ables', 'ablest']);
qbfGame.activeLetters.slice().forEach((l) => l.remove());
qbfGame.activeLetters = [];
['A','B','L','E','S','T'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, qbfGame.letterValue(ch), qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfO5 = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfO5.word`)).toBe('ABLES');

    // No 5: fall back to 4. Ignore 3-letter words.
    rt.eval(`
qbfSetWordList(['max', 'able']);
qbfGame.activeLetters.slice().forEach((l) => l.remove());
qbfGame.activeLetters = [];
['M','A','X','A','B','L','E'].forEach((ch, i) => {
  let L = new QBFLetterMorph(ch, qbfGame.letterValue(ch), qbfGame.letterExtent(), 24);
  qbfGame.addMorph(L);
  L.loc = 'rack';
  L.setBounds(rect(130 + i * 45, 100, 45, 50));
  qbfGame.activeLetters.push(L);
});
qbfO4 = qbfGame.findAutoPlayWord();
true`);
    expect(rt.eval(`qbfO4.word`)).toBe('ABLE');

    rt.eval(`
qbfGame.playerName = 'Anonymous';
qbfGame.toggleAutoPlay();
qbfOnName = qbfGame.playerName;
qbfOnBtn = qbfGame.autoPlayButton.shape.string;
qbfNameBtn = qbfGame.nameButton.shape.string;
qbfGame.toggleAutoPlay();
qbfOffName = qbfGame.playerName;
true`);
    expect(rt.eval(`qbfOnName`)).toBe('Otto');
    expect(rt.eval(`qbfOnBtn`)).toBe('Otto');
    expect(rt.eval(`qbfNameBtn`)).toBe('Otto');
    expect(rt.eval(`qbfOffName`)).toBe('Anonymous');
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

  it('scores viewer ticks once a second so posted results show up on their own', () => {
    const { rt } = makeGame();
    // openQBFScores registered the 1s tick with the world.
    expect(
      rt.eval(
        `Lively.activeStepList().some((s) => s.stepMorph === qbfScores && s.methodName === 'tickScores')`,
      ),
    ).toBe(true);
    // Silent store write (as a synced remote write would): the next tick refreshes.
    rt.eval(`
qbfScoresStore().entries.push({
  player: 'Remoter', level: 'quick', bestGame: 321,
  bestWord: 'synced', bestWordScore: 32, time: Date.now(), gameNo: 555,
});
qbfScores.tickScores();
true`);
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('Remoter');
    expect(rt.eval(`qbfScores.scoresText.shape.string`)).toContain('321');
  }, 60_000);
});
