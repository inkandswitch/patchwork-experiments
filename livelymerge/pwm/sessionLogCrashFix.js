// Live patch v4 — paste into Morphic do-it once.
// v3 created/raised a panel with ephemeral=false (leftover persistent chrome
// in the doc). This version REMOVES every SessionLogPanel first, then opens
// a fresh ephemeral one at a known place.
//
// Expect return containing: opened=SessionLogPanel ephemeral=true

(() => {
  let stamp = '2026-09-10 10:16 PDT (live patch v4)';
  NEWDEFS_WRITTEN_ON = stamp;
  if (typeof $global !== 'undefined') $global.NEWDEFS_WRITTEN_ON = stamp;

  if (typeof _errorPresentInProgress === 'undefined') _errorPresentInProgress = false;
  let _origPresentError = presentError;
  let presentErrorFixed = function (err, contextIfAny) {
    if (_errorPresentInProgress || (typeof _errorRecoveryInProgress !== 'undefined' && _errorRecoveryInProgress)) {
      try {
        console.error('error during presentError', err);
      } catch (_e) {}
      return null;
    }
    _errorPresentInProgress = true;
    try {
      return _origPresentError(err, contextIfAny);
    } finally {
      _errorPresentInProgress = false;
    }
  };
  presentError = presentErrorFixed;
  if (typeof $global !== 'undefined') $global.presentError = presentErrorFixed;

  function removeAllSessionLogPanels() {
    let removed = 0;
    let kill = function (m) {
      if (!m || m.className !== 'SessionLogPanel') return;
      try {
        if (typeof m.stopStepping === 'function') m.stopStepping();
      } catch (_s) {}
      try {
        if (typeof m.remove === 'function') m.remove();
        removed = removed + 1;
      } catch (_r) {}
    };
    // Shared / persistent children
    try {
      let pers = (Lively && Lively.submorphs) || [];
      for (let i = pers.length - 1; i >= 0; i--) kill(pers[i]);
    } catch (_p) {}
    // Ephemeral children
    try {
      if (Lively && typeof Lively.ephemeralSubmorphs === 'function') {
        let eph = Lively.ephemeralSubmorphs() || [];
        for (let j = eph.length - 1; j >= 0; j--) kill(eph[j]);
      }
    } catch (_e) {}
    SessionLog = null;
    if (typeof $global !== 'undefined') $global.SessionLog = null;
    return removed;
  }

  let openSessionLogFixed = function () {
    try {
      if (typeof SessionLogPanel === 'undefined') {
        console.error('openSessionLog: SessionLogPanel class missing');
        return null;
      }
      // Never reuse — stale persistent panels were the v3 invisible case.
      removeAllSessionLogPanels();

      let gb = getBounds();
      if (!gb || !Lively) {
        console.error('openSessionLog: no bounds/Lively', !!gb, !!Lively);
        return null;
      }
      let m = 8;
      let rw = Math.max(160, Math.floor(gb.width() / 2 - 2 * m));
      let rh = Math.max(120, Math.floor(gb.height() / 2 - 2 * m));
      let rx = gb.width() - rw - m;
      let ry = gb.height() - rh - m;
      let panel = new SessionLogPanel(rect(rx, ry, rw, rh));
      if (typeof Lively.addEphemeralMorph !== 'function') {
        console.error('openSessionLog: addEphemeralMorph missing');
        return null;
      }
      Lively.addEphemeralMorph(panel);
      // If something promoted it, force ephemeral attach again.
      if (panel.isEphemeralSubmorph && !panel.isEphemeralSubmorph()) {
        try {
          if (panel.owner && panel.owner.removeMorph) panel.owner.removeMorph(panel);
        } catch (_x) {}
        Lively.addEphemeralMorph(panel);
      }
      if (typeof panel.beTopMorph === 'function') panel.beTopMorph();
      if (typeof panel.ensureLocalSessionLogStepping === 'function') panel.ensureLocalSessionLogStepping();
      if (typeof panel.ensureSessionPromptUi === 'function') panel.ensureSessionPromptUi();
      SessionLog = panel;
      if (typeof $global !== 'undefined') $global.SessionLog = panel;
      if (!(Lively.sessionLogText || '').length && typeof sessionLog === 'function') {
        sessionLog('system', 'Session log opened (live patch v4). Enter sends; Shift-Enter newline.');
      } else if (typeof panel.syncFromSharedLog === 'function') {
        panel.syncFromSharedLog(true);
      }
      return panel;
    } catch (err) {
      try {
        console.error('openSessionLog failed', err);
      } catch (_e2) {}
      return null;
    }
  };

  openSessionLog = openSessionLogFixed;
  if (typeof $global !== 'undefined') $global.openSessionLog = openSessionLogFixed;

  try {
    if (typeof replaceMethod === 'function' && typeof SessionLogPanel !== 'undefined') {
      replaceMethod(
        'SessionLogPanel',
        `syncFromSharedLog(forceScroll) {
  if (this._syncReentry > 0) return;
  this._syncReentry = (this._syncReentry || 0) + 1;
  try {
    let t = String((typeof Lively !== 'undefined' && Lively && Lively.sessionLogText) || '');
    if (!forceScroll && t === this._lastSeenLog) return;
    this._lastSeenLog = t;
    let pane = this.transcriptPane;
    let content = pane && pane.contentPane;
    if (!content) return;
    if (typeof pane.setText === 'function') pane.setText(t, { force: true });
    else {
      content.setText(t);
      if (pane._savedTextSnapshot !== undefined) pane._savedTextSnapshot = t;
    }
    if (pane._scrollTranscriptBottomQuiet) pane._scrollTranscriptBottomQuiet();
    else if (typeof pane.scrollTranscriptToBottom === 'function') pane.scrollTranscriptToBottom();
  } finally {
    this._syncReentry--;
    if (this._syncReentry < 0) this._syncReentry = 0;
  }
}`,
      );
      replaceMethod(
        'SessionLogPanel',
        `sessionLogStep() {
  this.syncFromSharedLog(false);
}`,
      );
      replaceMethod(
        'SessionLogPanel',
        `ensureLocalSessionLogStepping() {
  if (this.isStepping && this.isStepping('sessionLogStep')) return;
  let world = this.world && this.world();
  if (!world || world === this || !world.startSteppingSpec) return;
  this.startStepping(400, 'sessionLogStep');
}`,
      );
    }
  } catch (_rm) {}

  let removed = removeAllSessionLogPanels();
  let p = openSessionLogFixed();
  let b = p && p.getBounds && p.getBounds();
  let ownerName = p && p.owner && p.owner.className;
  let eph = p && p.isEphemeralSubmorph && p.isEphemeralSubmorph();
  let inEphList = false;
  try {
    if (Lively && Lively.ephemeralSubmorphs) {
      let list = Lively.ephemeralSubmorphs();
      for (let i = 0; i < list.length; i++) if (list[i] === p) inEphList = true;
    }
  } catch (_l) {}
  return (
    'stamp=' +
    stamp +
    ' | removed=' +
    removed +
    ' | opened=' +
    (p && p.className) +
    ' | ephemeral=' +
    eph +
    ' | inEphList=' +
    inEphList +
    ' | owner=' +
    ownerName +
    ' | bounds=' +
    b +
    ' | null=' +
    (p == null)
  );
})()
