# Healer report — Milestone 4
Final result: frontend 230 passed, 0 failed, 0 skipped (`npm test`, 29 files).
Backend: 171 passed, 0 failed (`backend/.venv/bin/python -m pytest`).

Starting point: frontend 219 passed and 11 failed; backend 171 passed. I reproduced all 11
failures. No application code was changed, and the live backend on :8000 was not called.

## Needs human review (C)
None of the 11 failures needed human review. Three follow-ups came up along the way. None
of them blocks the gate:
- **ARCHITECTURE.md §4.1 doesn't record OQ-2 yet.** The PROGRESS.md resume checklist says
  "Update the ARCHITECTURE.md §4.1 Filters bullet" for OQ-2. The bullet still only says
  "From/To date-times … a draft until Apply", and the file never mentions the inclusive
  "To" minute or the 23:59 snap. The code and tests follow OQ-2. Recommendation: add one
  sentence there. I didn't edit the doc because it isn't a test fix.
- **Plan text is out of date.** In `test-plans/milestone-4.md`, the case bodies of
  M4-params-02, M4-range-01, M4-tz-03, M4-filter-05 and M4-view-05 still show the values
  from before OQ-2, and M4-fmt-02 still shows the exact string "Asia/Kolkata". The
  healer may not edit the plan. The tests now follow "Resolved decisions" OQ-2, which
  takes precedence. The plan owner may want to update those case bodies.
- **Optional product choice (M4-fmt-02).** On ICU builds that canonicalise zone names,
  the page names "Asia/Calcutta" for a Kolkata user. That is a valid IANA name, so it
  meets §4.1 ("which the page names"). Showing the modern name would need an alias
  map in `localTimeZone`. That isn't required; it's your call.

## Fixed — test bugs (A)

### Outdated by M4 (the plan's Regression section; OQ-1 for visibility)
All 5 opened History and expected the old placeholder "Detection history is coming in the
next milestone.", plus no `/history` call. The fix in each: wait for the page to load
(`await act(flush)`), then assert the h2 "Detection history" and "No detections yet."
Every other assertion is kept.
- **M3-app-02**: `frontend/src/App.test.jsx:43-61`.
  - The placeholder check is replaced by the heading and empty-state checks.
  - "No dropzone on History" (`toBeNull`) becomes `not.toBeVisible()`, because OQ-1
    keeps DetectionView mounted but hidden.
  - The `/history` call count goes from 0 to exactly 1.
  - Kept: `aria-current` and the unchanged URL. Back on Detect, the dropzone must now be
    *visible*, and the History content must be gone.
- **M3b-shell-02**: `frontend/src/App.shell.test.jsx:78-109`.
  - The placeholder lines are replaced the same way, and "no dropzone" becomes
    "dropzone not visible".
  - Added the plan's optional check: clicking History again adds no `/history` call
    (it stays at 1).
  - Kept: the `aria-current` uniqueness checks.
- **M3b-shell-03**: `App.shell.test.jsx:~119-123`.
  - The placeholder line is replaced by the heading and empty-state checks.
  - The final dropzone check is tightened from "in the document" to `toBeVisible()`,
    since the dropzone is always in the DOM under OQ-1.
  - Kept: the keyboard-only navigation flow.
- **M3b-shell-04**: `App.shell.test.jsx:~157-161`. Only the placeholder line is replaced.
  All OQ-4 burger assertions (`aria-controls` pointing at the sidebar, the
  `aria-expanded` toggling, and closing when a page is chosen) are unchanged.
- **M3b-shell-05**: `App.shell.test.jsx:182-184`.
  - The `/history` count goes from 0 to 2 for the visits History, Detect, History.
    This matches the plan and M4-app-02.
  - Kept: the status card is not remounted, and `/health` is called exactly once.

### Written to values from before the OQ-2 resolution
The app implements OQ-2: `toApiEnd` adds 60 s, and `snapToEndOfDay` snaps a picked "To"
day to 23:59 (`frontend/src/utils/history.js`, `FilterBar.jsx`). These 5 tests still
expected an exclusive "To", so their expected values were wrong under the user's
decision. I updated them. What each one tests is unchanged.
- **M4-params-02**: `frontend/src/utils/history.test.js:31-46`.
  - To `"2026-10-02 23:59:00"` (a picked whole day) gives `end_date`
    `2026-10-02T21:00:00.000Z`, the local midnight in Riyadh.
  - The original input `"2026-10-03 00:00:00"` now gives `2026-10-02T21:01:00.000Z`
    (+60 s).
  - The "both set" case uses To Oct 2 23:59.
  - The "never a bare date" check is kept.
- **M4-range-01**: `history.test.js:68-72`.
  - From == To is now valid (`null`), since it's a one-minute range under OQ-2.
  - Added the new boundary: From one minute after To (`09:01` vs `09:00`) gives the
    error.
  - Kept the genuinely inverted case (`10:00` vs `09:00`), the null-end cases and the
    autumn-overlap case.
- **M4-tz-03**: `history.test.js:100-106`.
  - The DST day lengths are still checked for a whole local day written the OQ-2 way
    (00:00 to 23:59): exactly 23 h (82,800,000 ms) in spring and 25 h (90,000,000 ms)
    in autumn.
  - The original midnight-to-midnight inputs are kept, and now include the To minute:
    82,860,000 and 90,060,000 ms.
  - The four per-instant DST mappings are unchanged.
- **M4-filter-05**: `frontend/src/components/FilterBar.test.jsx:157-189`.
  - The inverted case (10:00 → 09:00) is unchanged: the error shows, Apply is disabled
    and submit is blocked.
  - The "empty range" case is now From one minute after To (10:00 → 09:59), which still
    shows the error, disables Apply and blocks submit.
  - From == To now asserts no error and Apply enabled.
  - The final valid-range rerender is kept.
- **M4-view-05**: `frontend/src/pages/HistoryView.tz.test.jsx:74-77`.
  - The plan's steps are kept: pick From day 2 and To day 3 through the real pickers.
  - A picked To day now snaps to 23:59 and includes that minute, so `end_date` is
    `2026-10-03T21:00:00.000Z`, the local midnight in Riyadh at the end of Oct 3.
  - `start_date` (`2026-10-01T21:00:00.000Z`) and the "never a bare date" checks are
    unchanged.

### Environment assumption
- **M4-fmt-02**: `history.test.js:134-138`.
  - Node 24.12 / ICU 77.1 (tzdata 2025b) canonicalises Asia/Kolkata to its IANA alias
    "Asia/Calcutta". It does this even for an explicit
    `new Intl.DateTimeFormat("en", {timeZone: "Asia/Kolkata"})`. The app just reports
    what Intl gives, so it isn't an app bug.
  - The test now accepts either alias:
    `expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(h.localTimeZone())`.
  - I didn't use `Intl.DateTimeFormat().resolvedOptions().timeZone` from inside the test.
    That is the same expression as the implementation, so the test would always pass.
    The alias list still fails if the page names any other zone (for example "UTC" or
    a leaked earlier TZ pin).

## Fixed — app bugs (B)
None. No application code was changed.
