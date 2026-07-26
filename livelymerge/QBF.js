//  QBF -- the Quick Brown Fox
// ----------------------------
// A LivelyMerge port of the Quick Brown Fox, a word game written by Dan Ingalls in the
// Lively Kernel (original at https://smalltalkzoo.computerhistory.org/users/Dan/QBF2.html).
//
// Letter tiles ride in from the right on a conveyor belt, drop onto a rack, and slide
// left until they fall off the end. Type (or click) letters on the rack to build a word
// in the outbox, then hit enter to score it. Left alone, every tile eventually falls off
// the left end (costing its letter value); the final "!" tile ends the game.
// Word score = sum of the letter values times a multiplier that grows with word length.
// Invalid (??) or repeated (xx) words score against you, as do letters that fall off.
//
// Load this file the way newdefs.js is loaded -- evaluate it in a LivelyMerge workspace --
// then evaluate QBFScores.js (and optionally QBFSounds.js), then QBFWords.js for the
// tournament dictionary, and then runQBF() to put a game and the high-scores viewer in
// the world. (Fetch of QBFWords.txt is attempted as a convenience, but Patchwork does
// not serve that file, so evaluating QBFWords.js is the reliable way to enable checking.)
//
// Differences from the original, all deliberate:
//   - High scores use a pluggable store (default: Lively.qbfHighScores in the document)
//     instead of the Node QBFScoresServer. See QBFScores.js / qbfSetScoresStore.
//   - The word log is one monospaced text in three columns rather than several text morphs.
//   - Tiles are made as they enter the hopper rather than all 104 at once, which keeps the
//     document (and the op traffic) small.
//
// Style note: every for-loop body here is braced. The transpiler does not rewrite name
// references in a for body that is a bare statement, so `for (...) foo(Color.gray)`
// dies with "Color is not defined". Braces are the workaround.

// PER-USER ($-prefixed): the tournament word list is ~113k words. It is per-replica,
// never in the document, and must be reloaded after a reload of the page. With no list
// loaded every word is accepted -- see qbfLookupWord.
$qbfWordList = null;

// PER-USER: letters that should scream on their first tumble frame. Kept ephemeral so
// Automerge sync / other replicas cannot re-arm the fall sound (a doc-resident
// fallSoundPending flag was causing screams with no local tumble).
$qbfPendingFallSounds = null;

function qbfArmFallSound(letter) {
  if (!$qbfPendingFallSounds) $qbfPendingFallSounds = [];
  $qbfPendingFallSounds.push(letter);
}
function qbfConsumeFallSound(letter) {
  /** True once if this replica armed a scream for letter; clears that arming. */
  let pending = $qbfPendingFallSounds;
  if (!pending || pending.length === 0) return false;
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] === letter) {
      pending.splice(i, 1);
      return true;
    }
  }
  return false;
}

function qbfSound(eventName, argIfAny) {
  /**
   * Optional sound hook. Quiet unless QBFSounds.js has been evaluated.
   * eventName is one of: 'letterFall', 'letterDrop', 'letterUndrop',
   * 'wordCommit', 'wordReject'.
   */
  if (typeof QBFSounds === 'undefined' || !QBFSounds) return;
  let fn = QBFSounds[eventName];
  if (typeof fn !== 'function') return;
  try {
    fn.call(QBFSounds, argIfAny);
  } catch (err) {
    console.log('QBF sound error (' + eventName + '): ' + err);
  }
}
function qbfCompactStringForEach(str, func) {
  /**
   * Walk the words of a compact word list, calling func(word) with each.
   * The encoding (from the original QBF) stores a sorted list as the tail of each word
   * preceded by a "stop code" giving how many leading characters it shares with the one
   * before: 'a<0>bilities<6>y...' with counts encoded as 'A'..'Z'. So there must be no
   * capitals in the list and no word longer than 26 characters.
   * func may return false to stop the walk early (the list is sorted, so a lookup can).
   */
  let charOffset = 'A'.charCodeAt(0);
  let maxStopCode = charOffset + 25;
  let word = '';
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code > maxStopCode) {
      word += str[i];
      continue;
    }
    if (func(word) === false) return;
    word = word.slice(0, code - charOffset);
  }
  func(word);
}
function qbfCompactStringToArray(str) {
  let words = [];
  qbfCompactStringForEach(str, (w) => {
    words.push(w);
  });
  return words;
}
function qbfCompactStringFromArray(words) {
  /** Encode a sorted word array for compact in-memory lookup. */
  let charOffset = 'A'.charCodeAt(0);
  let matchLength = (a, b) => {
    let lim = Math.min(a.length, b.length);
    for (let i = 0; i < lim; i++) {
      if (a[i] !== b[i]) return i;
    }
    return lim;
  };
  let str = '';
  let prev = null;
  words.forEach((each) => {
    let word = each.toLowerCase();
    let nSame = 0;
    if (prev !== null) {
      nSame = matchLength(word, prev);
      str += String.fromCharCode(nSame + charOffset);
    }
    str += word.slice(nSame);
    prev = word;
  });
  return str;
}
function qbfWordsFromText(text) {
  /**
   * Parse QBFWords.txt: one uppercase word per line in the source distribution.
   * As in the original QBF, ignore words longer than nine letters and install
   * lowercase words. Empty lines are ignored.
   */
  let words = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line) => {
      let word = line.trim().toLowerCase();
      if (word.length > 0 && word.length <= 9) {
        words.push(word);
      }
    });
  return words;
}
function qbfInstallWordListText(text) {
  /** Parse and compact the text form before installing it as per-user state. */
  let words = qbfWordsFromText(text);
  qbfSetWordList(qbfCompactStringFromArray(words));
  return words.length + ' words loaded';
}
function qbfSetWordList(listOrCompactString) {
  /** Give the game a word list: either an array of words or a compact string. */
  $qbfWordList = listOrCompactString;
  return $qbfWordList
    ? Array.isArray($qbfWordList)
      ? $qbfWordList.length + ' words loaded'
      : 'compact word list loaded'
    : 'word checking off';
}
function qbfLookupWord(word) {
  /** Is word in the loaded list? With no list loaded, anything goes (as in the original). */
  let list = $qbfWordList;
  if (!list) return true;
  if (Array.isArray(list)) return list.includes(word);
  let found = false;
  qbfCompactStringForEach(list, (each) => {
    if (each === word) {
      found = true;
    }
    // The list is sorted, so we are past it once we reach a longer/later word.
    return !found && each <= word;
  });
  return found;
}
function qbfInstallFetchedWordList(text) {
  /**
   * Install text fetched off-thread. Promise callbacks run outside Automerge.change
   * (unlike setTimeout), so wrap the install when a runtime is available.
   * Keep this a top-level function: LM promise callbacks must not close over outer
   * locals (nested free-var capture is unreliable).
   */
  let rt = window.runtime;
  let msg =
    rt && typeof rt.change === 'function'
      ? rt.change(() => qbfInstallWordListText(text))
      : qbfInstallWordListText(text);
  console.log('QBF: ' + msg);
  return msg;
}
function qbfLoadWordListFromUrl(urlIfAny) {
  /**
   * Try to fetch a word-list text file (one uppercase word per line), discard words
   * longer than nine characters, lowercase and compact the remainder, then enable
   * word checking. Prefer evaluating QBFWords.js instead: relative fetch of
   * QBFWords.txt usually 404s under Patchwork because that file is not a served asset.
   *
   * Note: .then callbacks here only call top-level functions / use their parameters.
   * Do not close over locals from this function -- LM free-var capture in nested
   * promise callbacks is unreliable.
   */
  let url = urlIfAny != null ? urlIfAny : 'QBFWords.txt';
  try {
    return fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.text();
      })
      .then((text) => qbfInstallFetchedWordList(text))
      .catch((err) => {
        console.log(
          'QBF: no word list via fetch (' +
            err +
            '); evaluate QBFWords.js after QBF.js, or all words will be accepted',
        );
        return null;
      });
  } catch (err) {
    console.log(
      'QBF: cannot fetch a word list here (' +
        err +
        '); evaluate QBFWords.js after QBF.js, or all words will be accepted',
    );
    return null;
  }
}
function qbfPad(str, width) {
  /** Right-pad for the monospaced word log. */
  let s = '' + str;
  while (s.length < width) s += ' ';
  return s;
}
function qbfGameFor(morph) {
  /** The QBFMorph owning morph, if any. */
  let m = morph;
  while (m && m.className !== 'QBFMorph') m = m.owner;
  return m;
}
function qbfButtonHostFor(morph) {
  /** Nearest owner that handles buttonFired (game board or scores viewer). */
  let m = morph;
  while (m && typeof m.buttonFired !== 'function') m = m.owner;
  return m;
}
function qbfStyleText(morph, opts) {
  /**
   * Give a TextMorph the flat, non-editable look the game uses for tiles and readouts.
   * Two heights are at play: qbfBoxHeight is the height the morph was made with, while
   * TextBox.setText has already shrunk the box to one line of the default size. So we
   * restore that height, and pick a lineHeight that makes later setText calls leave it
   * alone -- compose answers inset.y + lineHeight + 2 for a single line.
   */
  let o = opts || {};
  let s = morph.shape;
  let hgt = morph.qbfBoxHeight != null ? morph.qbfBoxHeight : s.getBounds().height();
  let fontSize = o.fontSize != null ? o.fontSize : 14;
  s.font = fontSize + 'px ' + (o.fontFamily != null ? o.fontFamily : 'sans-serif');
  s.inset = pt(o.insetX != null ? o.insetX : 3, 2);
  s.lineHeight = o.lineHeight != null ? o.lineHeight : Math.max(8, hgt - 4);
  s.hang = o.hang != null ? o.hang : Math.max(0, Math.round((hgt - fontSize) / 2) - 1);
  s.composeBottomPad = 0;
  s.centerGlyph = !!o.center;
  s.setNoBreak(!!o.noBreak);
  s.boxColor = o.boxColor !== undefined ? o.boxColor : Color.veryLightGray;
  s.fill = s.boxColor;
  s.textColor = o.textColor != null ? o.textColor : Color.black;
  s.setBorderWidth(o.borderWidth != null ? o.borderWidth : 1);
  s.setBorderColor(o.borderColor != null ? o.borderColor : Color.gray);
  // Chrome, not an editor: no selection, no menu highlight, no keyboard focus.
  s.disableSelectionRendering = true;
  s.noMenuLineHighlight = true;
  s.$selStart = null;
  s.$selStop = null;
  let b = morph.getBounds();
  morph.setBounds(rect(b.topLeft.x, b.topLeft.y, b.width(), hgt));
  s.compose();
  return morph;
}

//  QBFDecorMorph
// ---------------
// Board furniture -- rack, belt, pulleys, hopper, pile -- drawn but never interactive,
// so that every click inside the board reaches the game itself.
class QBFDecorMorph extends Morph {
  onPointerDown(p, evt) {
    return false;
  }
  onPointerMove(p, evt) {
    return false;
  }
  onPointerUp(p, evt) {
    return false;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFTextMorph
// --------------
// A readout or label: shows text, never edits it.
class QBFTextMorph extends TextMorph {
  constructor(bounds, str) {
    super(bounds, str);
    this.qbfBoxHeight = bounds.height(); // the height we want kept; see qbfStyleText
  }
  onPointerDown(p, evt) {
    return false;
  }
  onPointerMove(p, evt) {
    return false;
  }
  onPointerUp(p, evt) {
    return false;
  }
  onKeyDown(evt) {
    return true;
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFButtonMorph
// ----------------
// Game button. It carries the *name* of its action rather than a closure, so the whole
// board stays plain data in the document; QBFMorph.buttonFired does the dispatch.
class QBFButtonMorph extends SimpleButtonMorph {
  constructor(bounds, label, actionName) {
    super(bounds, label);
    this.actionName = actionName;
    // SimpleButtonMorph insets its text by (0,0), so height = lineHeight + 2. Restore the
    // bounds setText shrank, and centre the label in them.
    let hgt = bounds.height();
    this.shape.lineHeight = Math.max(8, hgt - 2);
    this.shape.verticalNudge = Math.max(0, Math.round((hgt - 14) / 2) - 1);
    this.setBounds(bounds);
    this.shape.compose();
  }
  onPointerUp(p, evt) {
    // SimpleButtonMorph (and Morph) keep the press in hitPoint.
    let pressed = this.hitPoint != null && this.includesPt(p);
    super.onPointerUp(p, evt);
    if (!pressed) return true;
    let host = qbfButtonHostFor(this);
    if (host) host.buttonFired(this.actionName);
    return true;
  }
  setLabel(str) {
    this.setText(str);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFLetterMorph
// ----------------
// One letter tile, with its point value in the corner. A tile passes through several
// phases, recorded in loc:
//    null       -- in the hopper, or not yet in play
//    'belt'     -- riding in on the belt
//    'rack'     -- on the rack, and so typeable
//    'outbox'   -- a copy of a rack tile, spelling out the current word
//    'falling'  -- tumbling off the left end onto the pile
class QBFLetterMorph extends TextMorph {
  constructor(ch, value, ext, fontSize) {
    super(rect(0, 0, ext.x, ext.y), ch);
    this.qbfBoxHeight = ext.y; // see qbfStyleText
    this.letterPoints = value;
    this.loc = null;
    this.original = null; // for an outbox tile: the rack tile it stands for
    this.copyInOutbox = null; // for a rack tile: its outbox copy, if any
    this.vel = pt(0, 0);
    this.rot = 0;
    qbfStyleText(this, {
      fontSize: fontSize,
      center: true,
      noBreak: true,
      borderWidth: 2,
      borderColor: Color.black,
    });
    if (value > 0) {
      this.valueBox = this.addMorph(
        new QBFTextMorph(rect(ext.x - 17, ext.y - 16, 15, 13), String(value)),
      );
      qbfStyleText(this.valueBox, {
        fontSize: 9,
        center: true,
        noBreak: true,
        boxColor: null,
        borderWidth: 0,
      });
    }
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    let game = qbfGameFor(this);
    if (!game) return false;
    game.letterClicked(this, evt);
    return true;
  }
  onPointerMove(p, evt) {
    return false;
  }
  onPointerUp(p, evt) {
    return false;
  }
  onKeyDown(evt) {
    return true;
  }
  setLetterColor(color) {
    // Text and border together, so that a tile can be greyed out (in use) or blanked
    // out to the background colour (while paused).
    this.shape.setBorderColor(color);
    this.shape.textColor = color;
    if (this.valueBox) this.valueBox.shape.textColor = color;
    this.changed();
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFMorph
// ----------
// The board: rack, belt, hopper, outbox, readouts, buttons, and the game itself.
class QBFMorph extends Morph {
  constructor() {
    super(rect(0, 0, 100, 100));
    this.setup();
  }
  addButton(r, label, actionName) {
    return this.addMorph(new QBFButtonMorph(r, label, actionName));
  }
  addPulley(center, r) {
    let pulley = this.addMorph(new QBFDecorMorph(null, new Ellipse(center, r)));
    pulley.setStyles(Color.green, 2, Color.black);
    // Spokes and hub are submorphs, in pulley-local coordinates centred on the axle,
    // so they turn with the wheel.
    for (let a = 0; a < Math.PI - 0.01; a += Math.PI / 3) {
      let d = pt(r * Math.cos(a), r * Math.sin(a));
      pulley.addMorph(new QBFDecorMorph(null, new PolyLine([d.negated(), d], 2, Color.black)));
    }
    let hub = pulley.addMorph(new QBFDecorMorph(null, new Ellipse(pt(0, 0), 2)));
    hub.setStyles(Color.black, 1, Color.black);
    return pulley;
  }
  addReadout(r, labelStr, fontSizeIfAny) {
    let label = this.addMorph(
      new QBFTextMorph(rect(r.topLeft.x + 3, r.topLeft.y - 16, r.width(), 16), labelStr),
    );
    qbfStyleText(label, { fontSize: 11, boxColor: null, borderWidth: 0 });
    let box = this.addMorph(new QBFTextMorph(r, '0'));
    let fontSize = fontSizeIfAny != null ? fontSizeIfAny : 15;
    qbfStyleText(box, { fontSize: fontSize, noBreak: true, center: fontSize > 20 });
    return box;
  }
  addToOutbox(letter) {
    // Copy a rack tile into the outbox, greying out the original.
    if (letter.copyInOutbox != null) {
      // Clicking the most recently used tile again takes it back.
      if (letter.copyInOutbox === this.outboxLetters[this.outboxLetters.length - 1]) this.doDelete();
      return;
    }
    if (this.outboxLetters.length >= this.rackSize) return;
    let outLetter = this.addMorph(
      new QBFLetterMorph(letter.shape.string, letter.letterPoints, this.letterExtent(), 24),
    );
    outLetter.original = letter;
    outLetter.loc = 'outbox';
    letter.copyInOutbox = outLetter;
    this.fillLetter(letter, Color.gray);
    this.outboxLetters.push(outLetter);
    this.updateOutbox();
    qbfSound('letterDrop', this.outboxLetters.length);
  }
  addWordLabel(scoreRect) {
    let m = this.addMorph(
      new QBFTextMorph(rect(scoreRect.topLeft.x, scoreRect.bottom(), scoreRect.width(), 18), ' '),
    );
    qbfStyleText(m, { fontSize: 12, noBreak: true });
    return m;
  }
  appendLog(entry) {
    /** Post one line to the word log, which reads down three columns. */
    let maxRows = 16;
    this.logLines.push(entry);
    while (this.logLines.length > 3 * maxRows) this.logLines.shift();
    let rows = [];
    for (let row = 0; row < maxRows; row++) {
      let line = '';
      for (let col = 0; col < 3; col++) {
        let ix = col * maxRows + row;
        let cell = ix < this.logLines.length ? this.logLines[ix] : '';
        line += col === 2 ? cell : qbfPad(cell, 20);
      }
      rows.push(line);
    }
    while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop();
    this.wordLog.setText(rows.join('\n'));
  }
  buildBoard(lay) {
    this.setupRackEtc(lay);
    this.setupBoxes(lay);
    this.setupButtons(lay);
    this.setupMultipliers();
    this.setupFox(lay);
  }
  buttonFired(actionName) {
    if (this.paused && (actionName === 'clear' || actionName === 'delete' || actionName === 'enter'))
      return;
    if (actionName === 'clear') this.doClear();
    if (actionName === 'delete') this.doDelete();
    if (actionName === 'enter') this.doEnter();
    if (actionName === 'pause') this.doPause(!this.paused);
    if (actionName === 'restart') this.doRestart();
    if (actionName === 'level') this.doChooseLevel();
    if (actionName === 'rules') this.doShowRules();
    if (actionName === 'scores') this.doOpenScores();
    if (actionName === 'name') this.doChoosePlayerName();
    this.focusKeyboard();
  }
  chooseLevelNamed(caption) {
    let level = this.levels.find((each) => each.caption === caption);
    if (!level) return;
    if (level === this.level) {
      this.doPause(false);
      return;
    }
    let panel = this.panelMorph();
    let switchNow = () => {
      this.level = level;
      this.setup();
    };
    if (this.gameOver || !panel || !panel.promptConfirm) {
      switchNow();
      return;
    }
    this.doPause(true);
    panel.promptConfirm(
      'OK to end this game and switch levels?',
      'yes, switch',
      'no, keep playing',
      (ok) => {
        if (ok) {
          switchNow();
        } else {
          this.doPause(false);
        }
      },
    );
  }
  computeLayout() {
    /** Every rectangle of the board, in board-local coordinates. */
    let lw = this.letterW;
    let lh = this.letterH;
    let rackX = 130;
    let rackY = 150;
    let rackW = this.rackSize * lw + 6;
    let outboxY = rackY + 70;
    let beltX = rackX + rackW + 7;
    let beltW = this.beltSize * lw;
    let scoreX = rackX + rackW + 30;
    let scoreY = outboxY - 30;
    let scoreW = 2 * lw;
    let hSpacing = 110;
    let vSpacing = 48;
    return {
      rack: rect(rackX, rackY, rackW, 5),
      outbox: rect(rackX, outboxY, rackW, 5),
      belt: rect(beltX, rackY - 5, beltW, 2),
      binTopRight: pt(beltX + beltW + 23, 24),
      pile: rect(30, 430, rackX - 60, 3),
      log: rect(rackX + 5, outboxY + 66, 8 * lw, 206),
      score: rect(scoreX, scoreY, scoreW, 30),
      keyButtons: rect(rackX + 20, rackY - lh - 59, rackW - 40, 42),
      gameButtons: rect(scoreX, scoreY + 4 * vSpacing + 26, 100, 24),
      fox: rect(28, 24, 64, 64),
      hSpacing: hSpacing,
      vSpacing: vSpacing,
      boardExtent: pt(scoreX + hSpacing + scoreW + 16, 504),
    };
  }
  doChooseLevel() {
    let world = this.worldOrNull();
    if (!world) return;
    let game = this;
    let captions = this.levels.map((each) => each.caption);
    let pos = getPointerLocation();
    let menu = new MenuMorph(
      rect(pos.x, pos.y, 180, 24 + captions.length * 20),
      captions,
      function (item) {
        menu.remove();
        game.chooseLevelNamed(item);
      },
    );
    menu.isFleetingMenu = true;
    world.addMorph(menu);
  }
  doChoosePlayerName(thenFnIfAny) {
    /** Ask for a name used when posting high scores. */
    let game = this;
    let resume = thenFnIfAny;
    if (typeof qbfPromptPlayerName !== 'function') {
      if (!game.playerName) game.playerName = 'anonymous';
      if (resume) resume.call(game);
      return;
    }
    qbfPromptPlayerName(game.playerName, (name) => {
      if (name) game.playerName = name;
      if (game.nameButton) {
        game.nameButton.setLabel(game.playerName ? game.playerName : 'choose name');
      }
      game.focusKeyboard();
      if (resume) resume.call(game);
    });
  }
  doClear() {
    // Esc key or clear button: take all the tiles back out of the outbox.
    while (this.outboxLetters.length > 0) this.removeFromOutbox(this.outboxLetters.pop());
    this.updateOutbox();
  }
  doDelete() {
    // Delete key or button: take back the tile most recently added.
    if (this.outboxLetters.length === 0) return;
    this.removeFromOutbox(this.outboxLetters.pop());
    this.updateOutbox();
    qbfSound('letterUndrop');
  }
  doEnter() {
    // Enter key or button: submit the word now in the outbox.
    if (this.outboxLetters.length === 0) return;
    let committedLength = this.outboxLetters.length;
    let word = '';
    this.outboxLetters.forEach((letter) => {
      word += letter.shape.string;
      let original = letter.original;
      this.removeFromOutbox(letter);
      if (original) {
        deleteFromArray(this.activeLetters, original);
        original.remove();
      }
    });
    let valid = qbfLookupWord(word.toLowerCase());
    // Only three of the one-letter "words" count.
    if (word.length === 1 && 'AIO'.indexOf(word) < 0) valid = false;
    let scoreLine = qbfPad(this.wordScore, 4) + ' ' + word;
    if (!valid) scoreLine = qbfPad('-' + this.letterScore, 4) + ' ' + word + ' ??';
    if (this.usedWords.includes(word)) {
      scoreLine = qbfPad('-' + this.letterScore, 4) + ' ' + word + ' xx';
      valid = false;
    }
    if (valid) this.usedWords.push(word);
    this.appendLog(scoreLine);
    if (valid || this.noCheck) this.totalScore += this.wordScore;
    if (!valid && !this.noCheck) this.totalScore -= this.letterScore;
    this.pointsUsed += this.letterScore;
    this.totalScoreBox.setText(String(this.totalScore));
    this.showMultiplier();
    if ((valid || this.noCheck) && this.wordScore > this.bestWordScore) {
      this.bestWordScore = this.wordScore;
      this.bestWord = word;
      this.bestWordBox.setText(String(this.bestWordScore));
      this.bestWordLetters.setText(this.bestWord);
    }
    this.outboxLetters = [];
    this.updateOutbox();
    if (valid || this.noCheck) {
      qbfSound('wordCommit', committedLength);
    } else {
      qbfSound('wordReject');
    }
  }
  doPause(val) {
    this.paused = !!val;
    this.pauseButton.setLabel(this.paused ? 'resume' : 'pause');
    // Blank the tiles in motion while paused, so that pausing is no way to study the rack.
    let inBin = this.letterInBin ? [this.letterInBin] : [];
    inBin
      .concat(this.outboxLetters, this.fallingLetters, this.activeLetters)
      .forEach((letter) => {
        if (this.paused) {
          letter.colorBeforePause = letter.shape.borderColor.copy();
        }
        this.fillLetter(
          letter,
          this.paused ? Color.veryLightGray : letter.colorBeforePause || Color.black,
        );
      });
    this.focusKeyboard();
  }
  doOpenScores() {
    /** Raise or open the high-scores viewer (QBFScores.js). */
    if (typeof openQBFScores === 'function') {
      openQBFScores();
    } else {
      console.log('QBF: load QBFScores.js to show the high-scores viewer');
    }
    this.focusKeyboard();
  }
  doRestart() {
    let panel = this.panelMorph();
    if (this.gameOver || !panel || !panel.promptConfirm) {
      this.setup();
      return;
    }
    this.doPause(true);
    panel.promptConfirm(
      'OK to end this game and restart?',
      'yes, restart',
      'no, keep playing',
      (ok) => {
        if (ok) {
          this.setup();
        } else {
          this.doPause(false);
        }
      },
    );
  }
  doShowRules() {
    let panel = this.panelMorph();
    let tl = panel ? panel.topLeftInWorld().addPt(pt(40, 40)) : pt(80, 80);
    Lively.addEphemeralMorph(
      new MethodPanel(
        tl.extent(pt(570, 350)),
        `The Quick Brown Fox lets you make words from letter tiles that move along a rack.
The letters arrive from the right on a conveyor belt, and drop off on the left. Type
any letter on the rack (or click it) to build a word in the outbox, and then hit enter
to score that word.

Words are scored by the sum of the point values of their letters. Scores for long words
are multiplied by a further bonus factor, shown in the row of x0 x0 x1 x2 ... boxes
under the outbox. Invalid (??) or repeated (xx) words are scored against you, as are
unused letters that fall off to the left. The multiplier readout shows your score so
far divided by all the points you have been given to play with.

You get ${this.numLetters} letters, and then a "!" tile arrives to end the game.

    The delete key or button retracts the most recent letter added.
    The esc key or 'clear' button retracts all letters from the outbox.
    The enter key or button submits the word currently in the outbox.
    Clicking the last letter you used also takes it back.
    Collapsing the game's window pauses the game; expanding it resumes.

Use the level button (it reads "${this.level.caption}" just now) to choose your speed,
and thus the difficulty, of play...
    Not-so-quick has a longer rack, and so one more letter to work with.
    Super-quick has a shorter conveyor, so the letters come faster.
High scores and best words are tallied for each level of play.

Words are checked against the tournament list when QBFWords.js has been evaluated
(or when QBFWords.txt can be fetched). The loader lowercases the words and, as in the
original game, ignores entries longer than nine letters. Without a loaded dictionary,
any string of letters counts as a word. To (re)load it, evaluate QBFWords.js, or
    qbfLoadWordListFromUrl()

The Quick Brown Fox was written by Dan Ingalls for the Lively Kernel; this is its port
to LivelyMerge.`,
        'About the Quick Brown Fox',
      ),
    );
  }
  fillLetter(letter, color) {
    if (letter && letter.setLetterColor) letter.setLetterColor(color);
  }
  findCharOnRack(char) {
    /** A rack tile showing char and not already in use, or null. */
    for (let i = 0; i < this.activeLetters.length; i++) {
      let letter = this.activeLetters[i];
      if (letter.shape.string === char && letter.copyInOutbox == null && letter.loc === 'rack')
        return letter;
    }
    return null;
  }
  focusKeyboard() {
    /** Claim keystrokes for this game, and make sure the host canvas can receive them. */
    let world = this.worldOrNull();
    if (world) world.setKeyboardFocus(this);
    // LM focus alone is not enough: keydown listeners are on the canvas, so the
    // browser must focus it too. Without this, openQBF() looks idle until you click.
    try {
      if (typeof canvas !== 'undefined' && canvas && canvas.focus) canvas.focus();
    } catch (err) {
      /* headless tests have no real canvas */
    }
  }
  freshLevels() {
    return [
      {
        caption: 'not so quick',
        beltSize: 3,
        rackSize: 9,
        bestWord: ' ',
        bestWordScore: 0,
        bestGameScore: 0,
      },
      {
        caption: 'quick',
        beltSize: 3,
        rackSize: 8,
        bestWord: ' ',
        bestWordScore: 0,
        bestGameScore: 0,
      },
      {
        caption: 'super quick',
        beltSize: 2,
        rackSize: 8,
        bestWord: ' ',
        bestWordScore: 0,
        bestGameScore: 0,
      },
    ];
  }
  letterClicked(letter, evt) {
    this.focusKeyboard();
    if (this.paused || this.gameOver) return;
    if (letter.loc !== 'rack') return;
    this.addToOutbox(letter);
  }
  letterDropOntoRack(letter) {
    // The belt tile has reached the rack: drop it, then feed a new tile onto the belt.
    if (letter.loc !== 'rack') {
      this.placeBottomRight(letter, this.rack.getBounds().topRight().addPt(pt(-3, 1)));
      this.fillLetter(letter, Color.black);
      this.lettersSlideOnRack();
      letter.loc = 'rack';
    }
    if (!this.letterInBin) return;
    let newLetter = this.letterInBin;
    newLetter.loc = 'belt';
    this.placeBottomRight(newLetter, this.belt.getBounds().topRight());
    this.activeLetters.unshift(newLetter);
    this.letterInBin = this.nextTile();
    this.nLeftBox.setText(String(this.letterQueue.length));
  }
  letterExtent() {
    return pt(this.letterW, this.letterH);
  }
  letterFallOffEnd() {
    // The leftmost tile has run off the end of the rack.
    let letter = this.activeLetters.pop();
    if (letter.copyInOutbox) {
      let other = this.findCharOnRack(letter.shape.string);
      if (other) {
        // Another tile shows the same letter: let the outbox copy stand for that one.
        other.copyInOutbox = letter.copyInOutbox;
        other.copyInOutbox.original = other;
        this.fillLetter(other, Color.gray);
      } else {
        deleteFromArray(this.outboxLetters, letter.copyInOutbox);
        letter.copyInOutbox.remove();
        this.updateOutbox();
      }
    }
    if (letter.shape.string === '!') {
      this.gameOver = true;
      this.postFinalScore();
      letter.remove();
      return;
    }
    this.nMissed++;
    this.pointsMissed += this.letterValue(letter.shape.string);
    this.missedPointsBox.setText(String(-this.pointsMissed));
    this.totalScore -= this.letterValue(letter.shape.string);
    this.totalScoreBox.setText(String(this.totalScore));
    this.showMultiplier();
    // Now set the tile tumbling onto the pile. The scream waits until the first
    // rotateBy in letterFallToPile so it starts with the tumble, not the drop-off.
    // Arm the sound in ephemeral per-replica state (not on the letter) so sync
    // cannot replay it on another replica or after a merge.
    letter.loc = 'falling';
    letter.copyInOutbox = null;
    qbfArmFallSound(letter);
    letter.moveBy(pt(-8, 0));
    this.fillLetter(letter, Color.gray);
    letter.vel = pt(-2 + Math.random() * 0.5, 0);
    letter.rot = -0.05 - Math.random() * 0.1;
    this.fallingLetters.push(letter);
    this.promote(letter); // frontmost, so we watch it land
  }
  letterFallToPile(letter) {
    // One frame of an accelerating, tumbling fall.
    if (qbfConsumeFallSound(letter)) qbfSound('letterFall');
    letter.moveBy(letter.vel);
    letter.vel = letter.vel.addPt(pt(0, 1));
    letter.rotateBy(letter.rot);
    let pileY = this.pile.getBounds().topLeft.y;
    let b = letter.getBounds();
    if (b.bottomRight().y <= pileY) return;
    // Landed: stop it here, resting on the pile.
    deleteFromArray(this.fallingLetters, letter);
    letter.moveBy(pt(0, pileY - b.bottomRight().y));
  }
  lettersSlideOnRack() {
    // Leftward motion propagates along the rack wherever tiles touch.
    for (let i = 0; i < this.activeLetters.length - 1; i++) {
      let letter = this.activeLetters[i];
      let next = this.activeLetters[i + 1];
      let deltaX = next.getBounds().topRight().x - letter.getBounds().topLeft.x;
      if (deltaX < 0) return;
      next.moveBy(pt(-deltaX + 1, 0)); // tweaked so that the borders merge
    }
  }
  letterSet(nLetters) {
    /** nLetters tiles, in the proportions letters have in English text. */
    let probs = this.letterFrequencies;
    let letters = [];
    Object.keys(probs)
      .sort()
      .forEach((letr) => {
        let n = Math.max(1, Math.floor((probs[letr] / 100) * nLetters));
        if (letr === 'U') {
          n = 4; // Q needs the help
        }
        for (let i = 0; i < n; i++) {
          letters.push(letr);
        }
      });
    return letters;
  }
  letterValue(char) {
    return this.letterValues[char] || 1;
  }
  nextTile() {
    /** The next tile out of the queue, sitting in the hopper, or null when spent. */
    if (this.letterQueue.length === 0) return null;
    let ch = this.letterQueue.shift();
    let value = ch === '!' ? 0 : this.letterValue(ch);
    let tile = new QBFLetterMorph(ch, value, this.letterExtent(), 24);
    this.fillLetter(tile, Color.gray);
    this.addMorphBack(tile); // behind the hopper, so it seems to come out of it
    this.placeInBin(tile);
    return tile;
  }
  onKeyDown(evt) {
    if (this.paused || this.gameOver) return true;
    let key = evt.key;
    if (key === 'Backspace' || key === 'Delete') {
      this.doDelete();
      return true;
    }
    if (key === 'Escape' || key === 'Esc') {
      this.doClear();
      return true;
    }
    if (key === 'Enter') {
      this.doEnter();
      return true;
    }
    if (!key || key.length !== 1) return true;
    let char = key.toUpperCase();
    if (char < 'A' || char > 'Z') return true;
    let letter = this.findCharOnRack(char);
    if (letter) this.addToOutbox(letter);
    return true;
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    if (effectiveMetaKey(evt)) return super.onPointerDown(p, evt); // let meta-click raise a halo
    // Typing goes to the game from now on, wherever in the board you clicked.
    this.focusKeyboard();
    let localP = this.relativize(p);
    let consumed = false;
    this.eachSubmorph((sub) => {
      if (sub.fullBounds().includesPt(localP)) {
        consumed = sub.onPointerDown(localP, evt) || consumed;
      }
    });
    return true;
  }
  panelMorph() {
    /** The panel this board lives in, if any. */
    let m = this.owner;
    while (m && !(m.titleBar && m.paneLayoutBounds)) m = m.owner;
    return m;
  }
  placeBottomRight(morph, p) {
    let ext = morph.getBounds().extent;
    morph.setBounds(rect(p.x - ext.x, p.y - ext.y, ext.x, ext.y));
  }
  placeInBin(letter) {
    let c = this.bin.getBounds().center();
    let ext = letter.getBounds().extent;
    letter.setBounds(rect(c.x - ext.x / 2, c.y - ext.y / 2 + 2, ext.x, ext.y));
  }
  postFinalScore() {
    // Best word and best word score are only kept along with a best game.
    if (this.totalScore > this.level.bestGameScore) {
      this.level.bestGameScore = this.totalScore;
      this.level.bestWord = this.bestWord;
      this.level.bestWordScore = this.bestWordScore;
    }
    this.postLevelStats();
    this.appendLog('-- game over --');
    this.postScoresToStore();
  }
  postScoresToStore() {
    /**
     * Publish this level's bests through the pluggable scores store.
     * If the player has no name yet, ask first and retry.
     */
    if (typeof qbfPostLevelScore !== 'function') return;
    if (!this.playerName) {
      this.doChoosePlayerName(this.postScoresToStore);
      return;
    }
    qbfPostLevelScore(this.playerName, this.level.caption, {
      bestGame: this.level.bestGameScore,
      bestWord: this.level.bestWord,
      bestWordScore: this.level.bestWordScore,
      time: new Date().toISOString(),
    });
    let viewer = typeof findQBFScoresViewer === 'function' ? findQBFScoresViewer() : null;
    if (viewer) viewer.refresh();
  }
  postLevelStats() {
    this.bestWordBox.setText(String(this.bestWordScore));
    this.bestWordLetters.setText(this.bestWord || ' ');
    this.bestGameBox.setText(String(this.level.bestGameScore));
    this.levelWordBox.setText(String(this.level.bestWordScore));
    this.levelWordLetters.setText(this.level.bestWord || ' ');
  }
  removeFromOutbox(letter) {
    if (letter.original) {
      letter.original.copyInOutbox = null; // the original is free again
      this.fillLetter(letter.original, Color.black);
    }
    letter.remove();
  }
  resizeOwningPanel() {
    /** Levels differ in rack length, so the board -- and its panel -- change size. */
    let panel = this.panelMorph();
    if (!panel) return;
    let ext = this.getBounds().extent;
    let b = panel.getBounds();
    panel.setBounds(rect(b.topLeft.x, b.topLeft.y, ext.x, ext.y + panel.titleBarHeight));
    panel.layoutChrome();
    panel.relayoutContentPanes();
  }
  setPaneBoundsIn(newBounds) {
    // The board has a fixed layout: take the pane's top left, but keep our own extent.
    Morph.prototype.setBounds.call(this, newBounds.topLeft.extent(this.getBounds().extent));
  }
  setup() {
    /** (Re)build the board for a fresh game at the current level. */
    if (this.worldOrNull()) this.stopStepping('tick'); // setup also runs before we are in a world

    (this.submorphs || []).slice().forEach((m) => this.removeMorph(m));
    if (!this.levels) this.levels = this.freshLevels();
    if (!this.level) this.level = this.levels[1];
    this.paused = false;
    this.gameOver = false;
    this.noCheck = false; // set true to score unrecognized words anyway
    this.rackSize = this.level.rackSize;
    this.beltSize = this.level.beltSize;
    this.letterScore = 0;
    this.wordScore = 0;
    this.totalScore = 0;
    this.bestWord = ' ';
    this.bestWordScore = 0;
    this.nMissed = 0;
    this.pointsMissed = 0;
    this.pointsUsed = 0;
    this.usedWords = [];
    this.logLines = [];
    this.activeLetters = [];
    this.outboxLetters = [];
    this.fallingLetters = [];
    this.letterInBin = null;
    this.xStep = -this.letterW / 4; // brisk at first; normal pace from the 5th tile on
    let lay = this.computeLayout();
    this.setBounds(this.getBounds().topLeft.extent(lay.boardExtent));
    this.setStyles(Color.orange.darker(), 1, Color.black);
    this.buildBoard(lay);
    this.letterQueue = this.shuffledLetters(this.letterSet(this.numLetters)).concat(['!']);
    // First tile onto the belt, second into the hopper behind it.
    let letter = this.nextTile();
    letter.loc = 'belt';
    this.placeBottomRight(letter, this.belt.getBounds().topRight().addPt(pt(0, -3)));
    this.activeLetters = [letter];
    this.letterInBin = this.nextTile();
    this.nLeftBox.setText(String(this.letterQueue.length));
    this.missedPointsBox.setText('0');
    this.updateOutbox();
    this.postLevelStats();
    this.resizeOwningPanel();
    this.startTicking();
  }
  setupBoxes(lay) {
    let s = lay.score;
    let h = lay.hSpacing;
    let v = lay.vSpacing;
    this.letterScoreBox = this.addReadout(s, 'letter score');
    this.wordScoreBox = this.addReadout(s.translatedBy(pt(0, v)), 'word score');
    this.totalScoreBox = this.addReadout(s.translatedBy(pt(0, 2 * v)), 'game score');
    this.bestWordBox = this.addReadout(s.translatedBy(pt(0, 3 * v)), 'top word');
    this.bestWordLetters = this.addWordLabel(s.translatedBy(pt(0, 3 * v)));
    this.multiplierBox = this.addReadout(
      rect(s.topLeft.x + h, s.topLeft.y, s.width(), 2 * v - 18),
      ' multiplier',
      30,
    );
    this.bestGameBox = this.addReadout(s.translatedBy(pt(h, 2 * v)), 'best game');
    this.levelWordBox = this.addReadout(s.translatedBy(pt(h, 3 * v)), 'best word');
    this.levelWordLetters = this.addWordLabel(s.translatedBy(pt(h, 3 * v)));
    this.wordLog = this.addMorph(new QBFTextMorph(lay.log, ' '));
    qbfStyleText(this.wordLog, {
      fontSize: 10,
      fontFamily: 'monospace',
      lineHeight: 12,
      hang: 0,
      insetX: 0,
      noBreak: true,
      boxColor: null,
      borderWidth: 0,
    });
    let c = this.bin.getBounds().center();
    this.nLeftBox = this.addMorph(new QBFTextMorph(rect(c.x - 30, c.y - 7, 60, 22), '0'));
    qbfStyleText(this.nLeftBox, { fontSize: 15, center: true, boxColor: null, borderWidth: 0 });
    let p = lay.pile;
    this.missedPointsBox = this.addMorph(
      new QBFTextMorph(rect(p.topLeft.x, p.bottom() + 4, p.width(), 24), '0'),
    );
    qbfStyleText(this.missedPointsBox, {
      fontSize: 14,
      center: true,
      boxColor: null,
      borderWidth: 0,
    });
  }
  setupButtons(lay) {
    let k = lay.keyButtons;
    let w = Math.floor((k.width() - 20) / 3);
    this.clearButton = this.addButton(
      rect(k.topLeft.x, k.topLeft.y, w, k.height()),
      'clear (esc)',
      'clear',
    );
    this.backButton = this.addButton(
      rect(k.topLeft.x + w + 10, k.topLeft.y, w, k.height()),
      'delete (del)',
      'delete',
    );
    this.enterButton = this.addButton(
      rect(k.topLeft.x + 2 * (w + 10), k.topLeft.y, w, k.height()),
      'enter (retn)',
      'enter',
    );
    let g = lay.gameButtons;
    this.pauseButton = this.addButton(g, 'pause', 'pause');
    this.levelButton = this.addButton(
      g.translatedBy(pt(lay.hSpacing, 0)),
      this.level.caption,
      'level',
    );
    this.restartButton = this.addButton(g.translatedBy(pt(0, 30)), 'restart', 'restart');
    this.infoButton = this.addButton(
      g.translatedBy(pt(lay.hSpacing, 30)),
      'how to play',
      'rules',
    );
    // Scores / name sit to the left of the score column, as in the original.
    let scoresOrigin = rect(lay.rack.topLeft.x - 110, g.topLeft.y, 100, 24);
    this.scoresButton = this.addButton(scoresOrigin, 'show scores', 'scores');
    this.nameButton = this.addButton(
      scoresOrigin.translatedBy(pt(0, 30)),
      this.playerName ? this.playerName : 'choose name',
      'name',
    );
  }
  setupFox(lay) {
    // The fox himself -- the one item on the original's yetToDo list.
    try {
      let fox = this.addMorph(new EmojiMorph('\u{1F98A}', 56));
      fox.setBounds(lay.fox);
      fox.onPointerDown = function () {
        return false;
      };
    } catch (err) {
      // No canvas to render an emoji into; the game plays just as well without him.
    }
  }
  setupMultipliers() {
    // The row of multiplier boxes under the outbox, lighting up as a word grows.
    this.multBoxes = [];
    let ext = pt(this.letterW - 5, this.letterH - 18);
    for (let i = 0; i < this.rackSize; i++) {
      let box = new QBFLetterMorph('x' + this.multipliers[i + 1], 0, ext, 16);
      this.outbox.addMorph(box);
      box.setBounds(rect(i * this.letterW + 5, 6, ext.x, ext.y));
      this.fillLetter(box, Color.gray);
      this.multBoxes.push(box);
    }
  }
  setupRackEtc(lay) {
    // Note: a nested function's parameter must not share its name with a local of the
    // enclosing method -- the LivelyMerge transpiler resolves both to the outer one.
    let rail = (railBounds) => {
      let m = this.addMorph(new QBFDecorMorph(railBounds));
      m.setStyles(Color.black, 1, Color.black);
      return m;
    };
    this.rack = rail(lay.rack);
    this.outbox = rail(lay.outbox);
    this.belt = rail(lay.belt);
    this.belt2 = rail(lay.belt.translatedBy(pt(0, 16)));
    this.pile = rail(lay.pile);
    let radius = 9;
    this.pulley = this.addPulley(lay.belt.topLeft.addPt(pt(0, radius)), radius);
    this.pulley2 = this.addPulley(lay.belt.topRight().addPt(pt(0, radius)), radius);
    let tr = lay.binTopRight;
    let verts = [pt(0, 0), pt(80, 0), pt(62, 30), pt(18, 30)].map((v) =>
      v.addPt(pt(tr.x - 80, tr.y)),
    );
    this.bin = this.addMorph(new QBFDecorMorph(null, new PolyLine(verts, 1, Color.black)));
    this.bin.shape.closed = true;
    this.bin.shape.fillColor = Color.green.lighter().lighter();
  }
  showMultiplier() {
    // The mean multiplier: what all the points you were given have earned you.
    let pointsSoFar = this.pointsMissed + this.pointsUsed;
    let mult = pointsSoFar > 0 ? this.totalScore / pointsSoFar : 0;
    let str = mult.toPrecision(2);
    if (mult < 1) str = mult.toPrecision(1);
    if (mult < 0.1) str = '-';
    this.multiplierBox.setText(str);
  }
  shuffle(inp) {
    let shuffled = inp.slice(0);
    for (let i = 0; i < shuffled.length; i++) {
      let j = Math.floor(Math.random() * shuffled.length);
      let t = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = t;
    }
    return shuffled;
  }
  shuffledLetters(letters) {
    /**
     * Shuffle, but keep the vowel/consonant ratio constant along the way, which avoids
     * frustrating runs of all vowels or all consonants. Makes a much better game!
     */
    let vowels = [];
    let consonants = [];
    letters.forEach((each) => {
      if ('AEIOUaeiou'.includes(each)) {
        vowels.push(each);
      } else {
        consonants.push(each);
      }
    });
    vowels = this.shuffle(vowels);
    consonants = this.shuffle(consonants);
    let ratio = vowels.length / (vowels.length + consonants.length);
    let mixed = [];
    while (vowels.length > 0 && consonants.length > 0) {
      if (vowels.length / (vowels.length + consonants.length) > ratio) mixed.push(vowels.pop());
      else mixed.push(consonants.pop());
    }
    return mixed.concat(consonants, vowels);
  }
  startTicking() {
    if (!this.worldOrNull()) return; // openQBF starts us once we are in the world
    this.startStepping('tick', null, Math.round(1000 / this.ticksPerSec));
  }
  tick() {
    let panel = this.panelMorph();
    if (panel && panel.collapsed) return; // a collapsed window pauses the game
    if (this.paused || (this.gameOver && this.fallingLetters.length === 0)) return;
    // Decorative spin: bump rotation directly. Morph.rotateBy -> setRotation does
    // center-fix math + changed() and was ~40% of tick time for no gameplay gain.
    this.pulley.transform.rotation += -Math.PI / 15;
    this.pulley2.transform.rotation += -Math.PI / 15;
    if (this.activeLetters.length === 4) this.xStep = -this.letterW / this.ticksPerSec;
    if (this.letterInBin) this.letterInBin.moveBy(pt(0, 0.3)); // the next tile creeps down
    if (this.fallingLetters.length > 0)
      this.fallingLetters.slice().forEach((each) => this.letterFallToPile(each));
    if (this.activeLetters.length === 0) return;
    let letter = this.activeLetters[0]; // the one on the belt
    letter.moveBy(pt(this.xStep, 0));
    if (letter.getBounds().topRight().x < this.rack.getBounds().topRight().x)
      this.letterDropOntoRack(letter);
    this.lettersSlideOnRack();
    let leftmost = this.activeLetters[this.activeLetters.length - 1];
    if (leftmost.getBounds().center().x < this.rack.getBounds().topLeft.x) this.letterFallOffEnd();
  }
  worldOrNull() {
    // Morph.world() answers `this` for an unowned morph, which is no world at all.
    let world = this.world();
    return world && world.startSteppingSpec ? world : null;
  }
  updateOutbox() {
    // Lay out the outbox tiles and score the word they spell so far.
    this.letterScore = 0;
    let nLetters = this.outboxLetters.length;
    let tl = this.outbox.getBounds().topLeft;
    for (let i = 0; i < nLetters; i++) {
      let letter = this.outboxLetters[i];
      this.letterScore += this.letterValue(letter.shape.string);
      letter.setBounds(
        rect(tl.x + i * this.letterW + 3, tl.y + 1 - this.letterH, this.letterW, this.letterH),
      );
    }
    for (let i = 0; i < this.multBoxes.length; i++) {
      this.fillLetter(this.multBoxes[i], Color.gray);
    }
    if (nLetters > 0) this.fillLetter(this.multBoxes[nLetters - 1], Color.blue);
    this.wordScore = this.letterScore * this.multipliers[nLetters];
    this.letterScoreBox.setText(String(this.letterScore));
    this.wordScoreBox.setText(String(this.wordScore));
  }
  static new(...args) {
    return new this(...args);
  }
}

// Scrabble-ish letter values.
QBFMorph.prototype.letterValues = {
  A: 1,
  B: 3,
  C: 3,
  D: 2,
  E: 1,
  F: 4,
  G: 2,
  H: 4,
  I: 1,
  J: 8,
  K: 5,
  L: 1,
  M: 3,
  N: 1,
  O: 1,
  P: 3,
  Q: 10,
  R: 1,
  S: 1,
  T: 1,
  U: 1,
  V: 4,
  W: 4,
  X: 8,
  Y: 4,
  Z: 10,
};
// Percentage frequencies of the letters in English text, used to make up the tiles.
QBFMorph.prototype.letterFrequencies = {
  E: 12.02,
  T: 9.1,
  A: 8.12,
  O: 7.68,
  I: 7.31,
  N: 6.95,
  S: 6.28,
  R: 6.02,
  H: 5.92,
  D: 4.32,
  L: 3.98,
  U: 2.88,
  C: 2.71,
  M: 2.61,
  F: 2.3,
  Y: 2.11,
  W: 2.09,
  G: 2.03,
  P: 1.82,
  B: 1.49,
  V: 1.11,
  K: 0.69,
  X: 0.17,
  Q: 0.11,
  J: 0.1,
  Z: 0.07,
};
// Word-score multiplier by word length: the bonus starts at four letters.
QBFMorph.prototype.multipliers = [0, 0, 0, 1, 2, 3, 4, 5, 6, 7];
QBFMorph.prototype.letterW = 45;
QBFMorph.prototype.letterH = 50;
QBFMorph.prototype.numLetters = 103;
QBFMorph.prototype.ticksPerSec = 20;

function openQBF(topLeftIfAny) {
  /**
   * Put a Quick Brown Fox in a panel in the world, and open the high-scores viewer
   * beside it when QBFScores.js is loaded. Answers the game panel.
   */
  let tl = topLeftIfAny != null ? topLeftIfAny : pt(40, 40);
  let game = new QBFMorph();
  let ext = game.getBounds().extent;
  let panel = new PanelMorph(
    rect(tl.x, tl.y, ext.x, ext.y + PanelTitleBar.prototype.HEIGHT),
  );
  panel.setPanelTitle('the Quick Brown Fox');
  Lively.addEphemeralMorph(panel);
  panel.addMorph(game);
  game.setPaneBoundsIn(panel.paneLayoutBounds());
  panel.layoutChrome();
  game.startTicking();
  if (typeof openQBFScores === 'function') {
    openQBFScores(pt(tl.x + ext.x + 16, tl.y));
  }
  game.focusKeyboard();
  return panel;
}

function runQBF() {
  /**
   * Open a Quick Brown Fox game (QBF.js must already have been evaluated).
   * From a workspace: runQBF()
   * Prefer evaluating QBFWords.js beforehand for word checking; this also tries
   * fetch('QBFWords.txt') as a convenience when that URL is served.
   * Prefer loading QBFScores.js as well so openQBF opens the high-scores viewer.
   */
  if (!$qbfWordList) qbfLoadWordListFromUrl();
  return openQBF();
}
