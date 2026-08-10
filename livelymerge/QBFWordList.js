//  QBFWordList -- (merged into QBF.js)
// ------------------------------------
// Compact/expand/edit helpers (qbfCompactStringToArray, qbfInstallWordListText,
// qbfAddWordsToEmbeddedList, …) now live in QBF.js alongside the runtime
// install/lookup and the embedded tournament list. Evaluating QBF.js alone is
// enough; this file is kept so older "load QBFWordList.js first" instructions
// still succeed as a no-op.
//
// Typical refresh from QBFWords.txt (after QBF.js is loaded):
//   qbfInstallWordListText(storageGetItem('QBFWords.txt'))
//   qbfAddWordsToEmbeddedList([])  // or with new words; use result.source
