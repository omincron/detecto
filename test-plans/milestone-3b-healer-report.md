# Healer report — Milestone 3b
Final result: frontend 155 passed, 1 failed, 0 skipped (156); backend 170 passed, 0 failed.

The frontend total fell from 159 to 156 because the three obsolete M3-view-06 rows were removed.

## Needs human review (C)
- **M3-summary-01** (`frontend/src/components/DetectionSummary.test.jsx:14`)
  - **What fails:** `expect(valueOf("Average confidence").tagName).toBe("DD")` gets `"P"`. The labels, the values and the label-to-value adjacency are all still correct. The other assertions would pass, and M3-summary-03 and -04 use the same `valueOf` helper and pass. Only the description-list semantics are gone.
  - **Cause:** the Mantine redesign replaced `<dl>/<dt>/<dd>` with `StatCard` (`frontend/src/components/DetectionSummary.jsx:5-19`). Each card renders the label and value as two sibling `<p>` elements (`Text`). That markup has no programmatic term/definition relationship. A screen reader now reads "Average confidence" and "77%" as two unrelated paragraphs instead of a term and its definition.
  - **What the sources say:** instructions.md, ARCHITECTURE.md and PROGRESS.md say nothing about accessibility or summary markup. The M3 plan's case explicitly expects "Each `dt` is followed by its `dd`". The M3b plan's "kept contracts" list does not include `dl/dt/dd`, but nothing records that dropping the label/value semantics was intended. The brief says that if the redesign lost label/value association for assistive technology, that is an app issue to escalate rather than a test to weaken.
  - **Options:**
    1. App change (small, visual-neutral): render `StatCard`'s label/value as `Text component="dt"` / `Text component="dd"` inside a `component="dl"` grid or card. With the margins reset in CSS, the look is unchanged. The existing test then passes as written.
    2. Accept the loss and rewrite the test without depending on structure (for example, within each card, check the label is followed by its value). Record in PROGRESS.md that the summary no longer exposes term/definition semantics.
    3. Another association, such as `role="group"` with `aria-labelledby` per card. This needs the plan's expectation updated to match.
  - **Recommendation:** option 1. It restores what the user would care about (labels programmatically paired with values) at no visual cost. Nothing was changed.

## Fixed — outdated by decision (Browser-side upload pre-check, PROGRESS.md 2026-10-02; ARCHITECTURE.md §4.1; milestone-3b.md Regression)
- **M3-view-06, `notes.txt` / `anim.gif` / `empty.jpg` rows:** obsolete. The pre-check now rejects them in the browser with 0 `/detect` calls, and the plan says to delete these rows. First confirmed that the replacements M3b-pre-01 (4 types) and M3b-pre-02 exist in `frontend/src/pages/DetectionView.precheck.test.jsx` and pass (23/23 in that file).
  - Removed the three rows and added a comment pointing to M3b-pre-01/02.
  - Kept the `huge.jpg` and `ok.jpg` rows unchanged.
  - Narrowed the test title to "passes the pre-check, is sent unchanged …", as the plan asks.
  - The `empty.jpg` special case in the file constructor is now dead and was removed. All assertions on the remaining rows are unchanged. (`frontend/src/pages/DetectionView.test.jsx`, around lines 149-162)
- **M3-view-08:** changed. `notes.txt` is now rejected in the browser, so the `inOrder` mock gave its 415 to `zidane.jpg`, and `person-count` never appeared.
  - Updated the test to the agreed behaviour: a single D2 `/detect` answer. Every original assertion is kept (the alert appears, then `person-count` is "2", there is no alert, and there are 2 boxes).
  - Added an assertion of exactly 1 `/detect` call.
  - Added a comment pointing to M3b-pre-08a/08b. M3b-pre-08a/b exist and pass. (`frontend/src/pages/DetectionView.test.jsx`, around lines 199-216)

## Fixed — test bugs (A)
None.

## Fixed — app bugs (B)
None. No application code was changed.
