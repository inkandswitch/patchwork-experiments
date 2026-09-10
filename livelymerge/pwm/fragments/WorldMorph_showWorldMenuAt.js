showWorldMenuAt(pos, optsIfAny) {
  /**
   * World menu with label+action items (editable live via findItem / addItem* / removeItem).
   * Answers the menu morph — e.g. wm = Lively.showWorldMenuAt(pt(130, 40))
   *   wm.removeItem(wm.findItem('todo'))
   *   wm.addItemBefore('transcript', 'Quick Brown Fox', () => openQBF())
   */
  let opts = optsIfAny || {};
  let items = [
    menuItem('ToDo list', () => browseGlobalMethod('todoList')),
    menuItem('System browser', function () {
      this.world().addEphemeralMorph(new BrowserPanel());
    }),
    menuItem('Recent changes', () => browseRecentChanges()),
    menuItem('Morphic help', function () {
      this.world().showMorphicHelp();
    }),
    menuItem('Halo help', function () {
      this.world().showHaloHelp();
    }),
    menuItem('Text help', function () {
      this.world().showTextHelp();
    }),
    menuItem('Open transcript', () => {
      Transcript = openTranscript();
    }),
    menuItem('Open session log', () => {
      let p = openSessionLog();
      if (!p && typeof console !== 'undefined' && console.warn) {
        console.warn('Open session log: openSessionLog() returned null');
      }
    }),
    menuItem('Open console', () => {
      let p = openTranscript();
      p.setPanelTitle('Console');
      p.transcriptPane.setConsoleMirror(true);
      Console = p;
      log('Console ready — use log(msg) or console.log(msg); errors also appear.');
    }),
    menuItem('Clear console', () => {
      let con = Console;
      if (con && con.clear) con.clear();
    }),
    menuItem(menuToggleLabel(longClickForHalosLabel, $longClickForHalos), function () {
      $longClickForHalos = !$longClickForHalos;
      refreshWorldMenuItems(this);
      this.shape.selectLineAt(0);
    }),
    menuItem(menuToggleLabel(onScreenKeyboardLabel, $useOnScreenKbd), function () {
      $useOnScreenKbd = !$useOnScreenKbd;
      syncOnScreenKeyboardWithFocus(this.world());
      refreshWorldMenuItems(this);
      this.shape.selectLineAt(0);
    }),
    menuItem('Checkpoint to Downloads', function () {
      let world = this.world();
      let name = checkpointDownloadFileName();
      let when = new Date().toLocaleString();
      let bytes = checkpointToRepo(name);
      showCheckpointSavedNotice(world, { name: name, when: when, bytes: bytes });
    }),
  ];
  let menu = new MenuMorph(pos.extent(pt(220, 24 + items.length * 20)), items);
  // Deselect after non-toggle actions (toggles refresh the list themselves).
  let priorSelect = menu.actionFn;
  menu.setSelectFn(function (item, shiftKey) {
    priorSelect.call(this, item, shiftKey);
    let cap = menuItemCaption(item);
    if (
      cap === longClickForHalosLabel ||
      cap.endsWith(longClickForHalosLabel) ||
      cap === onScreenKeyboardLabel ||
      cap.endsWith(onScreenKeyboardLabel)
    )
      return;
    this.shape.selectLineAt(0);
  });
  menu.isFleetingMenu = !!opts.fleeting;
  if (opts.fleeting) Lively.addEphemeralMorph(menu);
  else Lively.addMorph(menu);
  return menu;
}
