// Organized export catalog for w.exportEntireSystem() (v2, IIFE — nothing pollutes w).
(function () {
  function exportMethodShouldOmit(name) {
    if (w.exportMethodShouldOmit) return w.exportMethodShouldOmit(name);
    return false;
  }

function systemCategoryBanner (title, blurb) {
  let t = String(title || '').trim();
  let inner = '  ' + t + '  ';
  let wdt = inner.length;
  let bar = '+' + '-'.repeat(wdt) + '+';
  let mid = '|' + inner + '|';
  let lines = ['', '', '', '', '// ' + bar, '// ' + mid, '// ' + bar];
  if (blurb) lines.push('// ' + String(blurb).trim());
  return lines.join('\n');
};

function systemClassBanner (className, blurb) {
  let name = String(className || '').trim();
  let lines = ['//  ' + name, '// ' + '-'.repeat(name.length + 2)];
  if (blurb) lines.push('// ' + String(blurb).trim());
  return lines.join('\n');
};

function systemFileHeader () {
  let stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return (
    '// Generated organized export — ' +
    stamp +
    '\n//\n// Livelymerge morphic definitions — load as alldefs replacement, then w.init().'
  );
};

function systemBootstrapSource () {
  return `// for compatibility between Livelymerge and Pyonpyon

if (!window.impl) {
  window.impl = {
    change(fn) {
      fn();
    },
  };
}

w.classProto = newObj();
w.objProto = w.getPrototypeOf(w);
w.Obj = w.newClass('Obj');
w.Obj.proto = w.objProto;`;
};

function systemClassBlurbs () {
  return {
    Obj: 'Root of the prototype chain; instanceOf and delegatesTo.',
    Color: 'RGBA paint with fillStyle for canvas; named swatches on w.Color.*.',
    Point: '2D point: addPt, subPt, scaleBy, dist, gridBy, boundsWithRadius.',
    Rectangle: 'Axis-aligned rect: union, intersection, includesPt.',
    SimpleTransform: 'Translation, rotation, scale — local ↔ owner coords.',
    StepSpec: 'One entry in a morph stepping schedule.',
    Pen: 'Turtle pen: vertices → PolyLine shapes and demo spirals.',
    TextCharSpec: 'Caret/selection anchor: string index + line geometry.',
    TextLineSpec: 'One composed line of text (array of TextCharSpec).',
    Morph: 'Scene-graph node: submorphs, transform, hit-testing, drag/drop.',
    Shape: 'Rectangle-backed drawable with border and fill.',
    Ellipse: 'Ellipse shape; used for line handles and round hit targets.',
    PolyLine: 'Vertex list, optional curve/close/fill; line hit tolerance.',
    ImageShape: 'Bitmap/canvas shape with alpha tight bounds.',
    TextBox: 'Multi-line editable text layout, selection, keyboard shortcuts.',
    ImageMorph: 'Morph wrapping ImageShape; collision from opaque pixels.',
    EmojiMorph: 'Named emoji or short literal rendered to a tight canvas.',
    LineMorph: 'Interactive polyline: hover handles, vertex drag/merge.',
    LineVertexHandle: 'White disk on a vertex; drag to move or merge.',
    LineMidpointHandle: 'Green disk on a segment; click inserts a vertex.',
    SliderMorph: '0..1 value slider; used in scroll panes and style panel.',
    TextMorph: 'Morph whose shape is a TextBox; pane keyboard focus target.',
    SimpleButtonMorph: 'TextMorph styled as a labeled button.',
    KbdKeyMorph: 'On-screen keyboard key cap.',
    ListMorph: 'Vertical list of strings; line selection.',
    MenuMorph: 'Fleeting or persistent menu built on ListMorph.',
    HaloHandle: 'One halo affordance (move, rotate, copy, …).',
    HaloMorph: 'Meta-click halo ring around a morph.',
    HandMorph: 'Alt-drag hand for picking up submorph trees.',
    PanelTitleBar: 'Collapse/close/title chrome shared by panels.',
    PanelMorph: 'Titled panel: collapse, dirty prompts, pane layout.',
    MethodPanel: 'Single TextPane for method source or help.',
    BrowserPanel: 'Class + method browser with list panes.',
    StylePanel: 'Live style editor (fill, stroke, width) for a morph.',
    StylePane: 'Inner lavender pane hosting style controls.',
    HuePickerMorph: '2D hue/brightness picker grid.',
    InspectorPanel: 'Variable list + print-it pane for one object.',
    MethodListPanel: 'Search hits or recent changes as a method list.',
    ScrollPane: 'Clipped content + vertical scrollbar.',
    ListPane: 'Scrollable list with optional pane menu.',
    TextPane: 'Scrollable TextMorph editor with dirty snapshot.',
    TranscriptTextPane: 'Append-only transcript; mirrors console quietly.',
    TranscriptPanelMorph: 'Panel hosting a TranscriptTextPane.',
    OnScreenKeyboardMorph: 'Soft keyboard for TextPane entry on touch devices.',
    WorldMorph: 'Root morph: pointer routing, halos, hands, world menu.',
  };
};

function systemCatalog () {
  let B = systemClassBlurbs();
  return [
    {
      title: 'Classes and Objects',
      blurb: 'Prototype inheritance, newClass/subClass, Obj, and array helpers.',
      protoObjects: [
        { obj: w.classProto, prefix: 'w.classProto.' },
        { obj: w.objProto, prefix: 'w.objProto.' },
      ],
      wMethods: [
        'getPrototypeOf',
        'getLmId',
        'clearArray',
        'deleteFromArray',
        'deleteFromArrayPred',
        'debugReparentCheck',
        'setInterval',
        'setTimeout',
        'newClass',
        'findSuperclassOf',
        'subclassDepth',
        'superclass',
        'allClassNames',
        'allClassNamesInSuperclassOrder',
        'allClassNamesWithStatics',
        'classNamesList',
        'preambleForClass',
        'dropNewline',
      ],
      classes: [{ name: 'Obj', blurb: B.Obj }],
    },
    {
      title: 'Canvas and Events',
      blurb: 'Canvas viewport, initUI, pointer/keyboard entry, demo world bootstrap.',
      wMethods: [
        'render',
        'canvas',
        'primaryCanvasElement',
        'viewportBounds',
        'getBounds',
        'truncateString',
        'init',
        'initUI',
        'initLively',
        'readPatches',
        'populateLively',
        'onKeyDown',
        'onKeyPress',
        'onKeyUp',
        'onPointerDown',
        'onPointerDownNow',
        'onPointerMove',
        'onPointerUp',
        'pointerEventCanvasLocalPt',
        'setShiftKeyPressed',
        'setLockKeyPressed',
        'setMetaKeyPressed',
        'toggleMetaKeyPressed',
        'consumeSoftMetaKey',
        'consumeSoftShiftKey',
        'isShiftKeyPressed',
        'isLockKeyPressed',
        'isMetaKeyPressed',
        'effectiveMetaKey',
        'effectiveShiftKey',
        '_refreshPadModifierStyles',
        'pointerOnOskKeyUI',
        'testTransforms',
      ],
    },
    {
      title: 'Geometry',
      blurb: 'Points, rectangles, transforms, and pen/turtle geometry.',
      wMethods: ['pt', 'ptPolar', 'rect', 'unionPts'],
      classes: [
        { name: 'Point', blurb: B.Point },
        { name: 'Rectangle', blurb: B.Rectangle },
        { name: 'SimpleTransform', blurb: B.SimpleTransform },
        { name: 'StepSpec', blurb: B.StepSpec },
        { name: 'Pen', blurb: B.Pen },
      ],
    },
    {
      title: 'Colors and Style',
      blurb: 'Color model, HSV, style snapshots, and StylePanel paint helpers.',
      wMethods: [
        'styleColorNames',
        'colorByStyleName',
        'baseColorFromPaint',
        'colorAlphaFromPaint',
        'paintWithAlpha',
        'hsvToColor',
        'styleNameForColor',
        'styleSnapshotFromMorph',
        'morphLineStyleIsBorder',
        'morphDefaultLineWidth',
        'roundLineWidth',
        'lineWidthCaptionText',
        'copyStyleSnapshot',
        'colorsEqual',
        'styleSnapshotsEqual',
        'applyStyleSnapshotToMorph',
      ],
      classes: [{ name: 'Color', blurb: B.Color, exportData: true }],
    },
    {
      title: 'Text Composition',
      blurb: 'Low-level specs used by TextBox layout and selection.',
      classes: [
        { name: 'TextCharSpec', blurb: B.TextCharSpec },
        { name: 'TextLineSpec', blurb: B.TextLineSpec },
      ],
    },
    {
      title: 'Shapes',
      blurb: 'Drawable shapes: rects, ellipses, polylines, images, text layout.',
      classes: [
        { name: 'Shape', blurb: B.Shape },
        { name: 'Ellipse', blurb: B.Ellipse },
        { name: 'PolyLine', blurb: B.PolyLine },
        { name: 'ImageShape', blurb: B.ImageShape },
        { name: 'TextBox', blurb: B.TextBox },
      ],
    },
    {
      title: 'Morph',
      blurb: 'Base morph: tree, transforms, drag/drop, focus, stepping.',
      wMethods: [
        'paneMenuIsFrontmostForPanel',
        'keyboardFocusBelongsToScrollPane',
        'textPaneWithKeyboardFocus',
        'shouldShowOnScreenKeyboardForWorld',
        'morphIsUnderOnScreenKeyboard',
        'clearKeyboardFocusUnlessTypingOrOsk',
      ],
      classes: [{ name: 'Morph', blurb: B.Morph }],
    },
    {
      title: 'Images and Lines',
      blurb: 'Bitmap/emoji morphs and editable polylines with handles.',
      classes: [
        { name: 'ImageMorph', blurb: B.ImageMorph },
        { name: 'EmojiMorph', blurb: B.EmojiMorph },
        { name: 'LineMorph', blurb: B.LineMorph },
        { name: 'LineVertexHandle', blurb: B.LineVertexHandle },
        { name: 'LineMidpointHandle', blurb: B.LineMidpointHandle },
      ],
    },
    {
      title: 'Text UI Morphs',
      blurb: 'TextMorph editors, buttons, and keyboard key caps.',
      wMethods: ['latestPasteBufferItem', 'addPasteBufferItem', 'showPasteHistoryMenu'],
      classes: [
        { name: 'TextMorph', blurb: B.TextMorph },
        { name: 'SimpleButtonMorph', blurb: B.SimpleButtonMorph },
        { name: 'KbdKeyMorph', blurb: B.KbdKeyMorph },
      ],
    },
    {
      title: 'Menus and Lists',
      blurb: 'ListMorph, MenuMorph, and pane/world menu helpers.',
      wMethods: [
        'isMenuSeparator',
        'menuSeparatorDisplay',
        'methodSelectorPaneMenuSpec',
        'classSelectorPaneMenuSpec',
        'menuToggleLabel',
        'menuItemCaption',
        'refreshWorldMenuItems',
      ],
      classes: [
        { name: 'ListMorph', blurb: B.ListMorph },
        { name: 'MenuMorph', blurb: B.MenuMorph },
      ],
    },
    {
      title: 'Panes',
      blurb: 'Scroll panes, text editors, transcripts, sliders, hue picker.',
      wMethods: [
        'hitScrollPaneMenuButtonAt',
        'fleetingPaneMenuForScrollPane',
        'removeFleetingPaneMenuFor',
        'worldPtHitsMorphOrSubmorphs',
      ],
      classes: [
        { name: 'ScrollPane', blurb: B.ScrollPane },
        { name: 'ListPane', blurb: B.ListPane },
        { name: 'TextPane', blurb: B.TextPane },
        { name: 'TranscriptTextPane', blurb: B.TranscriptTextPane },
        { name: 'SliderMorph', blurb: B.SliderMorph },
        { name: 'HuePickerMorph', blurb: B.HuePickerMorph },
        { name: 'StylePane', blurb: B.StylePane },
      ],
    },
    {
      title: 'Panels',
      blurb: 'Titled windows: browser, inspector, style, method list, transcript.',
      wMethods: ['promptConfirmMenu', 'promptOkToCancelEditsMenu'],
      classes: [
        { name: 'PanelTitleBar', blurb: B.PanelTitleBar },
        { name: 'PanelMorph', blurb: B.PanelMorph },
        { name: 'MethodPanel', blurb: B.MethodPanel },
        { name: 'BrowserPanel', blurb: B.BrowserPanel },
        { name: 'StylePanel', blurb: B.StylePanel },
        { name: 'InspectorPanel', blurb: B.InspectorPanel },
        { name: 'MethodListPanel', blurb: B.MethodListPanel },
        { name: 'TranscriptPanelMorph', blurb: B.TranscriptPanelMorph },
      ],
    },
    {
      title: 'Halos',
      blurb: 'Meta-click halo ring and its affordance handles.',
      classes: [
        { name: 'HaloHandle', blurb: B.HaloHandle },
        { name: 'HaloMorph', blurb: B.HaloMorph },
      ],
    },
    {
      title: 'Hands',
      blurb: 'Alt-drag hand morph for submorph pickup.',
      classes: [{ name: 'HandMorph', blurb: B.HandMorph }],
    },
    {
      title: 'On-Screen Keyboard',
      blurb: 'Soft keyboard morph and focus sync helpers.',
      wMethods: [
        'getKbdShiftTable',
        'defaultOnScreenKeyboardBounds',
        'syncOnScreenKeyboardWithFocus',
        'toggleOnScreenKeyboard',
        'saveOnScreenKeyboardChrome',
        'onScreenKeyboardBoundsForWorld',
        'padModifierHighlightOn',
        'pressPadShiftKey',
        'pressPadMetaKey',
        'clearOskPadModifierState',
      ],
      classes: [{ name: 'OnScreenKeyboardMorph', blurb: B.OnScreenKeyboardMorph }],
    },
    {
      title: 'WorldMorph',
      blurb: 'Root morph: event dispatch, halos, hands, stepping, world menu.',
      wMethods: [
        '_transcriptFmtConsoleArg',
        '_routeConsoleToTranscripts',
        'hasTranscriptConsoleTargets',
        '_ensureConsoleMirrorInstalled',
        'openTranscript',
      ],
      classes: [{ name: 'WorldMorph', blurb: B.WorldMorph }],
    },
    {
      title: 'Source Code Manipulation',
      blurb: 'Browse, export, delete, and persist method definitions.',
      wMethods: [
        'exportPartsForSelection',
        'exportStringForSelection',
        'exportSelectionsForEntireSystem',
        'methodFromSpec',
        'methodSpecKey',
        'deleteExprForMethodSpec',
        'deleteMethodWithSpec',
        'deleteClassNamed',
        'methodsContaining',
        'showFindNoMatchesMenu',
        'noteMethodChanges',
        'browseRecentChanges',
        'browseSavedChanges',
        'stats',
        'allMethodSpecs',
      ],
    },
    {
      title: 'Sundry Global — Storage and History',
      blurb: 'localStorage wrappers, recent-changes journal, timing helpers.',
      wMethods: [
        'storageGetItem',
        'storageKeys',
        'storageSetItem',
        'storageEditItem',
        'saveRecentChanges',
        'recentChangesSince',
        'recentDateStr',
        'timeSheet',
        'msToRun',
      ],
    },
    {
      title: 'Sundry Global — Inspection',
      blurb: 'Quick object inspection in an InspectorPanel.',
      wMethods: ['inspect', 'inspectString'],
    },
  ];
};

function exportMethodLinesOn(obj, prefix, namesIfAny) {
  if (!obj) return [];
  let names = namesIfAny
    ? namesIfAny.filter(function (n) {
        return typeof obj[n] === 'function' && !exportMethodShouldOmit(n);
      })
    : Object.getOwnPropertyNames(obj).filter(function (n) {
        return typeof obj[n] === 'function' && !exportMethodShouldOmit(n);
      });
  names = names.slice().sort();
  return names.map(function (n) {
    return prefix + n + ' = ' + obj[n].toString();
  });
};

function exportColorDataLines () {
  if (!w.Color) return [];
  let lines = [];
  Object.getOwnPropertyNames(w.Color).forEach(function (n) {
    if (n === 'proto' || n === 'name') return;
    let v = w.Color[n];
    if (v && v.r != null && v.g != null && v.b != null && typeof v.copy === 'function')
      lines.push('w.Color.' + n + ' = w.Color.new(' + v.r + ', ' + v.g + ', ' + v.b + ');');
  });
  return lines;
};

function exportProtoDataLines (cls, className) {
  if (!cls || !cls.proto) return [];
  let lines = [];
  Object.getOwnPropertyNames(cls.proto).forEach(function (n) {
    if (typeof cls.proto[n] === 'function') return;
    let v = cls.proto[n];
    if (typeof v === 'number' || typeof v === 'string')
      lines.push('w.' + className + '.proto.' + n + ' = ' + JSON.stringify(v) + ';');
    else if (v && typeof v === 'object' && !v.r && !v.className) {
      try {
        lines.push('w.' + className + '.proto.' + n + ' = ' + JSON.stringify(v) + ';');
      } catch (e) {
        /* skip non-JSON proto data */
      }
    }
  });
  return lines;
};

function exportClassChunk (entry) {
  let className = entry.name;
  let cls = w[className];
  if (!cls || !cls.proto) return '';
  let head = [systemClassBanner(className, entry.blurb), w.preambleForClass(cls)].join('\n');
  let bodyParts = [];
  let dataLines = exportProtoDataLines(cls, className);
  if (dataLines.length) bodyParts.push(dataLines.join('\n'));
  let protoLines = exportMethodLinesOn(cls.proto, 'w.' + className + '.proto.');
  if (protoLines.length) bodyParts.push(protoLines.join(';\n'));
  let staticLines = exportMethodLinesOn(cls, 'w.' + className + '.', null).filter(function (line) {
    return !line.startsWith('w.' + className + '.proto.');
  });
  if (staticLines.length) bodyParts.push(staticLines.join(';\n'));
  if (entry.exportData && className === 'Color') {
    let data = exportColorDataLines();
    if (data.length) bodyParts.push(data.join('\n'));
  }
  if (!bodyParts.length) return head;
  return head + '\n\n' + bodyParts.join('\n\n');
};

function exportCatalogSection (section) {
  let chunks = [systemCategoryBanner(section.title, section.blurb)];
  if (section.protoObjects) {
    section.protoObjects.forEach(function (po) {
      let lines = exportMethodLinesOn(po.obj, po.prefix, po.names);
      if (lines.length) chunks.push(lines.join(';\n'));
    });
  }
  if (section.wMethods && section.wMethods.length) {
    let lines = exportMethodLinesOn(w, 'w.', section.wMethods);
    if (lines.length) chunks.push(lines.join(';\n'));
  }
  if (section.classes) {
    section.classes.forEach(function (entry) {
      let chunk = exportClassChunk(entry);
      if (chunk) chunks.push(chunk);
    });
  }
  return chunks.filter(Boolean).join('\n\n');
};

function exportOrganizedSystemString () {
  let parts = [systemFileHeader(), systemBootstrapSource()];
  systemCatalog().forEach(function (section) {
    parts.push(exportCatalogSection(section));
  });
  parts.push('\n// ----- end of export -----\n// w.init() after loading this file.');
  return parts.join('\n\n');
};

function downloadTextFile (filename, text) {
  if (typeof document === 'undefined') return false;
  let blob = new Blob([text], { type: 'text/javascript;charset=utf-8' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = filename || 'alldefs-export.js';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
};

function _finishSystemExport (text) {
  let stamp = new Date().toISOString();
  w.storageSetItem('system.export', text);
  w.storageSetItem('system.export.timestamp', stamp);
  w.storageSetItem('system.methods', text);
  downloadTextFile('alldefs-export.js', text);
  return { chars: text.length, lines: text.split('\n').length, timestamp: stamp };
};
  var staleCatalogNames = [
    'exportOmitMethodNames', 'systemCategoryBanner', 'systemClassBanner', 'systemFileHeader',
    'systemBootstrapSource', 'systemClassBlurbs', 'systemCatalog', 'exportMethodLinesOn',
    'exportColorDataLines', 'exportProtoDataLines', 'exportClassChunk', 'exportCatalogSection',
    'exportOrganizedSystemString', 'downloadTextFile', '_finishSystemExport',
  ];
  staleCatalogNames.forEach(function (n) { delete w[n]; });

  w._exportCatalogApi = {
    version: 2,
    organizedString: exportOrganizedSystemString,
    finish: _finishSystemExport,
  };
})();
