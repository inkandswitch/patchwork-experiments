//  QBFWordList -- compact tournament word-list helpers
// ----------------------------------------------------
// Optional companion to QBF.js. Runtime install/lookup ($qbfWordList,
// qbfSetWordList, qbfLookupWord, qbfCompactStringForEach, qbfEnsureWordList)
// already live in QBF.js so that file can be evaluated alone. This file adds
// expand/compress/edit helpers for regenerating the embedded list.
//
// Compact encoding (from the original Lively Kernel QBF): a sorted lowercase
// list is stored as the tail of each word preceded by a stop code giving how
// many leading characters it shares with the previous word. Counts are
// 'A'..'Z' (0..25), so words must be lowercase and at most 26 characters.
// QBF itself only scores words of length <= 9.
//
// Typical refresh from QBFWords.txt (in a LivelyMerge workspace):
//   qbfInstallWordListText(storageGetItem('QBFWords.txt'))  // or paste text
//   // then replace qbfEmbeddedWordList's return '...' with $qbfWordList
//
// Add a few words to the embedded list and get paste-ready method source:
//   qbfAddWordsToEmbeddedList(['vape', 'vapes', 'evite', 'evites'])

// Do not clear a list already installed by QBF.js.
if (typeof $qbfWordList === 'undefined') $qbfWordList = null;

function qbfCompactStringForEach(str, func) {
  /**
   * Walk the words of a compact word list, calling func(word) with each.
   * func may return false to stop the walk early (the list is sorted, so a
   * lookup can).
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
  /** Expand a compact word list to a sorted array of lowercase words. */
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
function qbfNormalizeWordForList(word) {
  /** Lowercase trim; null if empty or longer than nine (QBF rack limit). */
  let w = String(word != null ? word : '')
    .trim()
    .toLowerCase();
  if (!w || w.length > 9) return null;
  return w;
}
function qbfWordsFromText(text) {
  /**
   * Parse QBFWords.txt: one uppercase word per line in the source distribution.
   * Ignore words longer than nine letters; install lowercase. Empty lines ignored.
   */
  let words = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line) => {
      let word = qbfNormalizeWordForList(line);
      if (word) words.push(word);
    });
  return words;
}
function qbfInstallWordListText(text) {
  /**
   * Parse and compact the text form before installing it as per-user state.
   * Regeneration path when QBFWords.txt changes: install, then paste
   * $qbfWordList into qbfEmbeddedWordList's return string.
   */
  let words = qbfWordsFromText(text);
  qbfSetWordList(qbfCompactStringFromArray(words));
  return words.length + ' words loaded';
}
function qbfSetWordList(listOrCompactString) {
  /** Give the game a word list: either an array of words or a compact string. */
  $qbfWordList = listOrCompactString;
  $qbfWordLookup = null;
  if (!$qbfWordList) return 'word checking off';
  $qbfWordLookup = {};
  if (Array.isArray($qbfWordList)) {
    for (let i = 0; i < $qbfWordList.length; i++) {
      $qbfWordLookup[$qbfWordList[i]] = true;
    }
    return $qbfWordList.length + ' words loaded';
  }
  qbfCompactStringForEach($qbfWordList, (w) => {
    $qbfWordLookup[w] = true;
  });
  return 'compact word list loaded';
}
function qbfLookupWord(word) {
  /** Is word in the loaded list? With no list loaded, anything goes (as in the original). */
  if (!$qbfWordList) return true;
  if ($qbfWordLookup) return !!$qbfWordLookup[word];
  if (Array.isArray($qbfWordList)) return $qbfWordList.includes(word);
  let found = false;
  qbfCompactStringForEach($qbfWordList, (each) => {
    if (each === word) {
      found = true;
    }
    return !found && each <= word;
  });
  return found;
}
function qbfAddWordsToArray(words, wordsToAdd) {
  /**
   * Merge wordsToAdd into a sorted unique lowercase array (length <= 9).
   * Answers { words, added, skipped }.
   */
  let set = {};
  (words || []).forEach((w) => {
    let n = qbfNormalizeWordForList(w);
    if (n) set[n] = true;
  });
  let added = [];
  let skipped = [];
  (wordsToAdd || []).forEach((raw) => {
    let n = qbfNormalizeWordForList(raw);
    if (!n) {
      skipped.push(raw);
      return;
    }
    if (set[n]) {
      skipped.push(n);
      return;
    }
    set[n] = true;
    added.push(n);
  });
  let next = Object.keys(set);
  next.sort();
  return { words: next, added: added, skipped: skipped };
}
function qbfAddWordsToCompactString(compact, wordsToAdd) {
  /**
   * Expand compact → add words → sort → compress.
   * Answers { compact, words, added, skipped }.
   */
  let prior = compact ? qbfCompactStringToArray(compact) : [];
  let result = qbfAddWordsToArray(prior, wordsToAdd);
  result.compact = qbfCompactStringFromArray(result.words);
  return result;
}
function qbfEmbeddedWordListMethodSource(compact) {
  /** Paste-ready source for qbfEmbeddedWordList() with the given compact string. */
  let body = compact != null ? String(compact) : '';
  if (body.indexOf("'") >= 0 || body.indexOf('\\') >= 0) {
    throw new Error('compact string contains quote/backslash; refuse to embed in single quotes');
  }
  return (
    'function qbfEmbeddedWordList() {\n' +
    '  /** The tournament word list in compact form (see qbfCompactStringForEach).\n' +
    '   * A persisted def so qbfEnsureWordList can reinstall it after a page reload. */\n' +
    "  return '" +
    body +
    "';\n" +
    '}'
  );
}
function qbfAddWordsToEmbeddedList(wordsToAdd) {
  /**
   * Expand qbfEmbeddedWordList(), add words, recompress, install into $qbfWordList,
   * and answer paste-ready method source for replacing qbfEmbeddedWordList in QBF.js.
   * Requires QBF.js loaded (qbfEmbeddedWordList defined).
   *
   *   qbfAddWordsToEmbeddedList(['vape', 'vapes', 'evite', 'evites'])
   */
  if (typeof qbfEmbeddedWordList !== 'function') {
    throw new Error('qbfEmbeddedWordList is not defined — load QBF.js first');
  }
  let result = qbfAddWordsToCompactString(qbfEmbeddedWordList(), wordsToAdd);
  qbfSetWordList(result.compact);
  result.source = qbfEmbeddedWordListMethodSource(result.compact);
  result.message =
    'added ' +
    result.added.length +
    ' word(s)' +
    (result.skipped.length ? '; skipped ' + result.skipped.length : '') +
    '; list now ' +
    result.words.length +
    ' words. Replace qbfEmbeddedWordList in QBF.js with result.source.';
  console.log('QBF: ' + result.message);
  if (result.added.length) console.log('QBF: added ' + result.added.join(', '));
  return result;
}
