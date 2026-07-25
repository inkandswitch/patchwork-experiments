//  QBFScores -- high-score viewer and pluggable score store for Quick Brown Fox
// ---------------------------------------------------------------------------
// Port of the original QBFScoresViewer (Lively Kernel / QBFScoresServer).
//
// Score records keep the original shape, keyed by player then by level caption:
//   {
//     Dan: {
//       quick: { bestGame, bestWord, bestWordScore, time },
//       ...
//     }
//   }
//
// Connection to storage is pluggable. Install your own with qbfSetScoresStore(store).
// A store must answer:
//   getAllScores()                         -> { playerName: { levelCaption: record } }
//   getPlayerScores(playerName)            -> { levelCaption: record }
//   putPlayerScores(playerName, byLevel)   -> void  (replace that player's map)
//   putPlayerLevelScore(player, level, rec)-> void  (upsert one level)
//   getScoreEntries()                      -> [ {player, level, bestGame, ...}, ... ]
// and may optionally answer:
//   subscribe(listener) / unsubscribe(listener)  for live refresh
//
// The default store (QBFDocScoresStore) keeps a flat list on Lively.qbfHighScoreList so
// Automerge shares it. Swap it later for an HTTP / WebSocket store without changing
// the game or the viewer.

// PER-USER: which store instance this replica uses. The default is created lazily.
$qbfScoresStore = null;
// PER-USER: listeners interested in score changes (viewer refresh, etc.).
$qbfScoresListeners = null;

function qbfScoresStore() {
  /** The active scores store for this replica. */
  if ($qbfScoresStore) return $qbfScoresStore;
  $qbfScoresStore = new QBFDocScoresStore();
  return $qbfScoresStore;
}
function qbfSetScoresStore(store) {
  /**
   * Install a scores store. Pass null to fall back to the document store.
   * Existing viewers keep working -- they always go through qbfScoresStore().
   */
  $qbfScoresStore = store;
  qbfScoresNotify();
  return $qbfScoresStore;
}
function qbfScoresSubscribe(listener) {
  if (!$qbfScoresListeners) $qbfScoresListeners = [];
  $qbfScoresListeners.push(listener);
}
function qbfScoresUnsubscribe(listener) {
  if (!$qbfScoresListeners) return;
  deleteFromArray($qbfScoresListeners, listener);
}
function qbfScoresNotify() {
  if (!$qbfScoresListeners) return;
  $qbfScoresListeners.slice().forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.log('QBF scores listener error: ' + err);
    }
  });
}

function qbfPadLeft(str, width) {
  let s = '' + str;
  while (s.length < width) {
    s = ' ' + s;
  }
  return s;
}
function qbfPadRight(str, width) {
  let s = '' + str;
  while (s.length < width) {
    s = s + ' ';
  }
  return s;
}
function qbfPrintScoreTable(grid) {
  /** Monospaced table like the original Strings.printTable(..., {separator:' | '}). */
  if (!grid || grid.length === 0) return '';
  let widths = [];
  for (let c = 0; c < grid[0].length; c++) {
    let w = 0;
    for (let r = 0; r < grid.length; r++) {
      let cell = grid[r][c] != null ? String(grid[r][c]) : '';
      if (cell.length > w) {
        w = cell.length;
      }
    }
    widths.push(w);
  }
  let lines = [];
  for (let r = 0; r < grid.length; r++) {
    let parts = [];
    for (let c = 0; c < widths.length; c++) {
      parts.push(qbfPadRight(grid[r][c] != null ? String(grid[r][c]) : '', widths[c]));
    }
    lines.push(parts.join(' | '));
  }
  return lines.join('\n');
}
function qbfFormatScoreTime(timeVal) {
  /** Match the original Date(...).toString().substring(4, 21) look. */
  try {
    let d = timeVal instanceof Date ? timeVal : new Date(timeVal);
    if (isNaN(d.getTime())) return String(timeVal || '');
    return d.toString().substring(4, 21);
  } catch (err) {
    return String(timeVal || '');
  }
}
function qbfMergePlayerScore(prior, incoming) {
  /**
   * Same merge rules as the original postScoresToServer: keep the better game
   * (and its word), and bump the timestamp whenever anything improves.
   */
  if (!prior) {
    return {
      bestGame: incoming.bestGame,
      bestWord: incoming.bestWord,
      bestWordScore: incoming.bestWordScore,
      time: incoming.time,
    };
  }
  if (prior.bestGame >= incoming.bestGame && prior.bestWordScore >= incoming.bestWordScore) {
    return prior;
  }
  let next = {
    bestGame: prior.bestGame,
    bestWord: prior.bestWord,
    bestWordScore: prior.bestWordScore,
    time: incoming.time,
  };
  if (prior.bestGame < incoming.bestGame) {
    next.bestGame = incoming.bestGame;
    next.bestWord = incoming.bestWord;
    next.bestWordScore = incoming.bestWordScore;
  }
  return next;
}

function qbfScoreRecordPlain(rec) {
  return {
    bestGame: Number(rec.bestGame),
    bestWord: String(rec.bestWord == null ? '' : rec.bestWord),
    bestWordScore: Number(rec.bestWordScore),
    time: String(rec.time == null ? '' : rec.time),
  };
}

function qbfPostLevelScore(playerName, levelCaption, record) {
  /**
   * Merge one level's score for a player into the active store.
   * Used by QBFMorph at game over. Answers true if the store accepted an update.
   */
  if (!playerName || !levelCaption || !record) return false;
  let store = qbfScoresStore();
  let priorMap = store.getPlayerScores(playerName);
  let prior = priorMap ? priorMap[levelCaption] : null;
  let merged = qbfMergePlayerScore(prior, record);
  if (prior && merged === prior) return false;
  store.putPlayerLevelScore(playerName, levelCaption, qbfScoreRecordPlain(merged));
  return true;
}

//  QBFDocScoresStore
// -------------------
// Default store: a flat array on the world (Automerge-friendly). Each entry is
// { player, level, bestGame, bestWord, bestWordScore, time }.
class QBFDocScoresStore {
  list() {
    if (!Lively.qbfHighScoreList) Lively.qbfHighScoreList = [];
    return Lively.qbfHighScoreList;
  }
  getAllScores() {
    // Prefer the flat entry list for display -- nested maps are awkward in LM.
    let entries = this.getScoreEntries ? this.getScoreEntries() : [];
    let out = {};
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (!e || e.player == null || e.level == null) continue;
      if (!out[e.player]) out[e.player] = {};
      out[e.player][e.level] = {
        bestGame: e.bestGame,
        bestWord: e.bestWord,
        bestWordScore: e.bestWordScore,
        time: e.time,
      };
    }
    return out;
  }
  getScoreEntries() {
    return this.list();
  }
  getPlayerScores(playerName) {
    let entries = this.getScoreEntries();
    let out = {};
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (!e || e.player !== playerName) continue;
      out[e.level] = {
        bestGame: e.bestGame,
        bestWord: e.bestWord,
        bestWordScore: e.bestWordScore,
        time: e.time,
      };
    }
    return out;
  }
  putPlayerScores(playerName, byLevel) {
    let list = this.list();
    let kept = [];
    for (let i = 0; i < list.length; i++) {
      let e = list[i];
      if (e && e.player !== playerName) kept.push(e);
    }
    clearArray(list);
    for (let i = 0; i < kept.length; i++) {
      list.push(kept[i]);
    }
    Object.keys(byLevel || {}).forEach((level) => {
      let rec = qbfScoreRecordPlain(byLevel[level]);
      list.push({
        player: playerName,
        level: level,
        bestGame: rec.bestGame,
        bestWord: rec.bestWord,
        bestWordScore: rec.bestWordScore,
        time: rec.time,
      });
    });
    qbfScoresNotify();
  }
  putPlayerLevelScore(playerName, levelCaption, record) {
    let list = this.list();
    let rec = qbfScoreRecordPlain(record);
    let found = false;
    for (let i = 0; i < list.length; i++) {
      let e = list[i];
      if (e && e.player === playerName && e.level === levelCaption) {
        e.bestGame = rec.bestGame;
        e.bestWord = rec.bestWord;
        e.bestWordScore = rec.bestWordScore;
        e.time = rec.time;
        found = true;
        break;
      }
    }
    if (!found) {
      list.push({
        player: playerName,
        level: levelCaption,
        bestGame: rec.bestGame,
        bestWord: rec.bestWord,
        bestWordScore: rec.bestWordScore,
        time: rec.time,
      });
    }
    qbfScoresNotify();
  }
  subscribe(listener) {
    qbfScoresSubscribe(listener);
  }
  unsubscribe(listener) {
    qbfScoresUnsubscribe(listener);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFMemoryScoresStore
// ----------------------
// In-memory only (per replica). Same flat-list shape as the document store.
class QBFMemoryScoresStore {
  constructor() {
    this.entries = [];
  }
  getAllScores() {
    let entries = this.getScoreEntries();
    let out = {};
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (!e || e.player == null || e.level == null) continue;
      if (!out[e.player]) out[e.player] = {};
      out[e.player][e.level] = {
        bestGame: e.bestGame,
        bestWord: e.bestWord,
        bestWordScore: e.bestWordScore,
        time: e.time,
      };
    }
    return out;
  }
  getScoreEntries() {
    return this.entries;
  }
  getPlayerScores(playerName) {
    let entries = this.getScoreEntries();
    let out = {};
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (!e || e.player !== playerName) continue;
      out[e.level] = {
        bestGame: e.bestGame,
        bestWord: e.bestWord,
        bestWordScore: e.bestWordScore,
        time: e.time,
      };
    }
    return out;
  }
  putPlayerScores(playerName, byLevel) {
    let kept = [];
    for (let i = 0; i < this.entries.length; i++) {
      let e = this.entries[i];
      if (e && e.player !== playerName) kept.push(e);
    }
    this.entries = kept;
    Object.keys(byLevel || {}).forEach((level) => {
      let rec = qbfScoreRecordPlain(byLevel[level]);
      this.entries.push({
        player: playerName,
        level: level,
        bestGame: rec.bestGame,
        bestWord: rec.bestWord,
        bestWordScore: rec.bestWordScore,
        time: rec.time,
      });
    });
    qbfScoresNotify();
  }
  putPlayerLevelScore(playerName, levelCaption, record) {
    let rec = qbfScoreRecordPlain(record);
    let found = false;
    for (let i = 0; i < this.entries.length; i++) {
      let e = this.entries[i];
      if (e && e.player === playerName && e.level === levelCaption) {
        e.bestGame = rec.bestGame;
        e.bestWord = rec.bestWord;
        e.bestWordScore = rec.bestWordScore;
        e.time = rec.time;
        found = true;
        break;
      }
    }
    if (!found) {
      this.entries.push({
        player: playerName,
        level: levelCaption,
        bestGame: rec.bestGame,
        bestWord: rec.bestWord,
        bestWordScore: rec.bestWordScore,
        time: rec.time,
      });
    }
    qbfScoresNotify();
  }
  subscribe(listener) {
    qbfScoresSubscribe(listener);
  }
  unsubscribe(listener) {
    qbfScoresUnsubscribe(listener);
  }
  static new(...args) {
    return new this(...args);
  }
}

//  QBFScoresMorph
// ----------------
// The high-scores window body: a monospaced table plus an Update button.
class QBFScoresMorph extends Morph {
  constructor() {
    super(rect(0, 0, 520, 320));
    this.setStyles(Color.orange.darker(), 1, Color.black);
    this.build();
    this._onScoresChanged = () => {
      this.refresh();
    };
    let store = qbfScoresStore();
    if (store.subscribe) store.subscribe(this._onScoresChanged);
    this.refresh();
  }
  build() {
    (this.submorphs || []).slice().forEach((m) => this.removeMorph(m));
    let title = this.addMorph(
      new QBFTextMorph(rect(12, 10, 400, 22), 'Quick Brown Fox High Scores'),
    );
    qbfStyleText(title, {
      fontSize: 16,
      boxColor: null,
      borderWidth: 0,
      textColor: Color.white,
    });
    this.updateButton = this.addMorph(
      new QBFButtonMorph(rect(420, 8, 80, 24), 'Update', 'update'),
    );
    this.scoresText = this.addMorph(
      new QBFTextMorph(rect(12, 40, 496, 260), 'Looking for scores...'),
    );
    qbfStyleText(this.scoresText, {
      fontSize: 11,
      fontFamily: 'Courier, monospace',
      boxColor: Color.white,
      borderWidth: 1,
      borderColor: Color.gray,
      lineHeight: 14,
    });
    // Allow selecting / copying the table; keep it non-editable.
    this.scoresText.shape.disableSelectionRendering = false;
  }
  buttonFired(actionName) {
    if (actionName === 'update') this.refresh();
  }
  onPointerDown(p, evt) {
    if (!this.includesPt(p)) return false;
    if (this.bringTopLevelPanelToFrontIfNeeded(p)) return true;
    if (effectiveMetaKey(evt)) return super.onPointerDown(p, evt);
    let localP = this.relativize(p);
    let consumed = false;
    this.eachSubmorph((sub) => {
      if (sub.fullBounds().includesPt(localP)) {
        // Update button uses QBFButtonMorph (fires on pointerUp via actionName).
        if (sub.actionName === 'update' && sub.onPointerDown) {
          consumed = sub.onPointerDown(localP, evt) || consumed;
        } else if (sub.onPointerDown) {
          consumed = sub.onPointerDown(localP, evt) || consumed;
        }
      }
    });
    return true;
  }
  panelMorph() {
    let m = this.owner;
    while (m && !(m.titleBar && m.paneLayoutBounds)) {
      m = m.owner;
    }
    return m;
  }
  refresh() {
    this.scoresText.setText('Looking for scores...');
    try {
      let store = qbfScoresStore();
      let entries = store.getScoreEntries ? store.getScoreEntries() : null;
      if (entries) {
        this.showScoreEntries(entries);
      } else {
        this.showScores(store.getAllScores());
      }
    } catch (err) {
      this.regret(err);
    }
  }
  regret(errIfAny) {
    let msg = 'Sorry, scores are not available.';
    if (errIfAny) msg = msg + '\n' + errIfAny;
    this.scoresText.setText(msg);
  }
  showScoreEntries(entries) {
    let lineItems = [];
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (!e || e.bestGame == null) continue;
      lineItems.push({
        level: e.level,
        player: e.player,
        bestGame: e.bestGame,
        bestWord: e.bestWord,
        bestWordScore: e.bestWordScore,
        time: e.time,
      });
    }
    this.renderScoreLines(lineItems);
  }
  showScores(allScores) {
    let lineItems = [];
    let players = allScores || {};
    Object.keys(players).forEach((userName) => {
      let userObj = players[userName] || {};
      Object.keys(userObj).forEach((level) => {
        let rec = userObj[level];
        if (!rec || rec.bestGame == null) return;
        lineItems.push({
          level: level,
          player: userName,
          bestGame: rec.bestGame,
          bestWord: rec.bestWord,
          bestWordScore: rec.bestWordScore,
          time: rec.time,
        });
      });
    });
    this.renderScoreLines(lineItems);
  }
  renderScoreLines(lineItems) {
    lineItems.sort((a, b) => {
      if (a.level > b.level) return 1;
      if (a.level < b.level) return -1;
      if (a.bestGame < b.bestGame) return 1;
      return -1;
    });
    let grid = [];
    let level = 'none';
    grid.push(['game score', 'best word', 'score', 'player', 'time']);
    for (let i = 0; i < lineItems.length; i++) {
      let item = lineItems[i];
      if (item.level !== level) {
        level = item.level;
        grid.push([level, '', '', '', '']);
      }
      grid.push([
        String(item.bestGame),
        item.bestWord || '',
        String(item.bestWordScore),
        item.player,
        qbfFormatScoreTime(item.time),
      ]);
    }
    let footer = '\n      -- Scores are shared in this document --';
    if (lineItems.length === 0) {
      this.scoresText.setText(
        qbfPrintScoreTable([
          ['game score', 'best word', 'score', 'player', 'time'],
          ['(no scores yet)', '', '', '', ''],
        ]) + footer,
      );
      return;
    }
    this.scoresText.setText(qbfPrintScoreTable(grid) + footer);
  }
  remove() {
    let store = qbfScoresStore();
    if (store.unsubscribe && this._onScoresChanged) {
      store.unsubscribe(this._onScoresChanged);
    }
    return super.remove();
  }
  setPaneBoundsIn(newBounds) {
    Morph.prototype.setBounds.call(this, newBounds);
    if (this.scoresText) {
      let b = this.getBounds();
      this.scoresText.setBounds(rect(12, 40, Math.max(80, b.width() - 24), Math.max(40, b.height() - 52)));
      if (this.updateButton) {
        this.updateButton.setBounds(rect(b.width() - 100, 8, 80, 24));
      }
    }
  }
  static new(...args) {
    return new this(...args);
  }
}

function findQBFScoresViewer() {
  /** The open QBFScoresMorph in the world, if any. */
  if (!Lively) return null;
  let found = null;
  // The viewer panel is per-user UI, so it normally lives in Lively.$submorphs.
  // eachSubmorph scans both persistent and ephemeral layers.
  Lively.eachSubmorph((m) => {
    if (found) return;
    if (m.className === 'QBFScoresMorph') {
      found = m;
      return;
    }
    if (m.submorphs) {
      m.submorphs.forEach((sub) => {
        if (!found && sub.className === 'QBFScoresMorph') found = sub;
      });
    }
  });
  return found;
}

function openQBFScores(topLeftIfAny) {
  /** Put a high-scores viewer in a panel; answers the panel. */
  let existing = findQBFScoresViewer();
  if (existing) {
    let panel = existing.panelMorph();
    if (panel) {
      if (panel.collapsed && panel.toggleCollapse) panel.toggleCollapse();
      panel.beTopMorph && panel.beTopMorph();
    }
    existing.refresh();
    return panel || existing;
  }
  let tl = topLeftIfAny != null ? topLeftIfAny : pt(560, 40);
  let viewer = new QBFScoresMorph();
  let ext = viewer.getBounds().extent;
  let panel = new PanelMorph(
    rect(tl.x, tl.y, ext.x, ext.y + PanelTitleBar.prototype.HEIGHT),
  );
  panel.setPanelTitle('QBFScoresViewer');
  Lively.addEphemeralMorph(panel);
  panel.addMorph(viewer);
  viewer.setPaneBoundsIn(panel.paneLayoutBounds());
  panel.layoutChrome();
  return panel;
}

function runQBFScores() {
  /** Open (or raise) the high-scores viewer. */
  return openQBFScores();
}

function qbfPromptPlayerName(initialName, onDone) {
  /**
   * Small name-entry panel. Calls onDone(name) when the player confirms, or onDone(null)
   * if they close without OK. Uses a TextMorph so no host prompt API is required.
   */
  let start = initialName != null && initialName !== '' ? String(initialName) : 'anonymous';
  let panel = new PanelMorph(rect(200, 160, 320, 120));
  panel.setPanelTitle('player name');
  Lively.addMorph(panel);
  let inner = panel.paneLayoutBounds();
  let field = new TextMorph(
    rect(inner.topLeft.x + 12, inner.topLeft.y + 12, inner.width() - 24, 28),
    start,
  );
  panel.addMorph(field);
  field.shape.font = '14px sans-serif';
  field.shape.boxColor = Color.white;
  field.shape.setBorderWidth(1);
  field.shape.setBorderColor(Color.gray);
  field.shape.compose();
  let ok = new QBFButtonMorph(
    rect(inner.center().x - 40, inner.bottom() - 34, 80, 26),
    'OK',
    'ok',
  );
  panel.addMorph(ok);
  panel.buttonFired = function (actionName) {
    if (actionName !== 'ok') return;
    let name = field.shape.string;
    if (name != null) name = String(name).trim();
    if (!name) name = 'anonymous';
    panel.remove();
    if (onDone) onDone(name);
  };
  panel.layoutChrome();
  let world = panel.world && panel.world();
  if (world && world.setKeyboardFocus) world.setKeyboardFocus(field);
  return panel;
}
