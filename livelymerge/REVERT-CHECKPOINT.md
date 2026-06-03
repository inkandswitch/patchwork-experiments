# Revert checkpoint — before May 14 port merge

**Date:** 2026-05-23  
**File:** `alldefs.js`  
**Backup:** `alldefs.js.pre-May14-port-20260523` (exact copy before applying `pyonpyon/PORT-since-May14-to-copy.md`)

To restore:

```bash
cp alldefs.js.pre-May14-port-20260523 alldefs.js
```

**Context:** Cursor was at ~line 3489 (`tryShowPaneMenuForSelection`). Baseline already had pane-menu stack (ScrollPane, ListMorph/MenuMorph, `keyboardFocusBelongsToScrollPane`, etc.).
