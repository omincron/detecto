# Test plan — Milestone 4: Frontend history view

## Scope

This milestone is uncommitted on top of `8031b34` (the M3b design pass). It adds:
- **Dependencies:** `@mantine/dates` 9.6.3 (with `dayjs` 1.11) for the date-time pickers, and `recharts` 3.10.1 for the chart. `main.jsx` imports `@mantine/dates/styles.css`.
- **`api/client.js`:**
  - `getHistory(params)`: GET `<base>/history`. It drops `null`/`""` params, requires an array body, and maps each record to `{id, timestamp: Date, count, averageConfidence, inferenceTimeMs}`.
  - `clearHistory()`: `DELETE <base>/reset`, resolving to `count_removed`.
- **`utils/history.js`** (pure helpers):
  - `toApiInstant`: local picker value to UTC `…Z` instant.
  - `buildHistoryParams`, `validateRange`, `summarize`.
  - `formatTimestamp`: a module-level `Intl.DateTimeFormat`.
  - `localTimeZone`.
- **Components:**
  - `FilterBar`: From/To `DateTimePicker`s, a 0–100 step-5 `Slider` named via `thumbLabel`, Apply (submit) and Reset, and inline range validation.
  - `HistoryStats`: a KPI `dl` named "Totals".
  - `HistoryChart`: Recharts on a numeric time axis, plus a `role="img"` summary.
  - `HistoryTable`: newest first, 15 per page, and "—" for zero-person rows.
  - `ClearHistoryButton`: a modal that fetches the unfiltered count, then `DELETE /reset`.
- **`HistoryView`:** draft and applied filters, latest-request-wins, loading, error and empty states, a notice after clearing, and "Go to Detect". `App` now passes `onNavigate={setPage}` to every page.

**Sources of expected behavior:**
- instructions.md "History View": a table or graph of timestamp vs. number of people, with filters for date, time and confidence threshold. It also requires "clear error messages".
- ARCHITECTURE.md §3.3, the `/history` and `/reset` contract:
  - instants with an offset;
  - start inclusive, a datetime end exclusive;
  - `min_confidence` ≥, with zero-person records always kept;
  - records oldest first, timestamps UTC `…Z`;
  - errors are 400 with a string `detail`.
- ARCHITECTURE.md §4.1 HistoryView (updated for M4).
- PROGRESS.md: "Milestone 4", and the open decisions "M4 requirement (from M2 OQ-3)", "Clear history" and "Design direction".
- The mockup is layout context only, not a spec. I could not open it (it's a claude.ai artifact and no tool for it was available), so manual check 2 compares against §4.1 only, and against the mockup if the human has it open.

**In scope:**
- Unit tests for `utils/history.js`, time-zone pinned.
- Unit tests for `getHistory`/`clearHistory`.
- Component tests for `FilterBar`, `HistoryStats`, `HistoryChart`, `HistoryTable`, `ClearHistoryButton` and `HistoryView`.
- App-level navigation tests.
- One backend unit test confirming the exact instant format the frontend sends.
- Manual real-browser checks for the pickers, the modal, the chart and the time-zone display.

**Out of scope:**
- `/history` and `/reset` server logic, already covered by M2 (170 backend tests).
- The Detect page, except for regression.
- M5 (samples, README).
- Pixel-exact visuals.
- Confirming Clear history against the live backend. Its records (34 at planning time; PROGRESS.md says 33) are the user's test data, so **never call `DELETE /reset` on :8000**. Manual check 8 uses a sandbox backend.

**Conventions for the generator** (in addition to those in `milestone-3.md` and `milestone-3b.md`):
- **`mockFetch` needs `/history` and `/reset` routes.**
  - Add `history` (a function `(url, options) → Response | Promise`, default `() => jsonResponse([])`) and `reset` (no default; an unrouted `/reset` throws "no /reset route in this test").
  - Route with `path.includes("/history")` and `path.includes("/reset")`.
  - Today an unrouted `/history` throws inside the mock and `getHistory` turns that into "Can't reach the detection server…". That is why the 5 shell tests now show the error state (see Regression).
  - `callsTo(fetchMock, "/history")` already works for counting.
- **Record fixtures** (raw backend shape, oldest first):
  - `raw(id, timestamp, count, avg, ms)` returns `{id, timestamp, count, average_confidence: avg, inference_time_ms: ms}`.
  - **R4** is:
    - `raw(1,"2026-10-02T09:00:00.000000Z",2,0.80,100)`
    - `raw(2,"2026-10-02T09:01:00.000000Z",0,0.0,200)`
    - `raw(3,"2026-10-02T09:10:00.000000Z",5,0.90,300)`
    - `raw(4,"2026-10-02T11:05:09.563816Z",1,0.62,400)`
  - **`many(n)`** returns ids 1..n, with timestamp `2026-10-02T08:00:00Z + (id-1) minutes`, `count = id % 4`, `avg = count ? 0.8 : 0`, and `ms = 100 + id`.
  - For component tests that take mapped records, map these the way `getHistory` does, or call `getHistory` against a mocked fetch.
- **Pinning the time zone (verified during planning, Node 24):**
  - `Date` and `dayjs` follow a runtime change to `process.env.TZ`. But **an `Intl.DateTimeFormat` created before the change keeps its old zone**, and `formatTimestamp` and the chart's `tickFormat` are created at module load.
  - So per test file:
    1. In `beforeAll`, set `process.env.TZ = "<zone>"`.
    2. Call `vi.resetModules()`.
    3. Then `await import(...)` the module under test, plus everything that imports it (components, `HistoryView`).
  - Restore the original `TZ` and call `vi.resetModules()` in `afterAll`. Verified: the change leaks into later tests in the same worker otherwise.
  - One zone per `describe` (or per file) keeps this simple.
  - **Zones:**
    - `Asia/Riyadh` (UTC+3, no DST);
    - `America/New_York` (−4 in October, −5 in winter);
    - `Europe/Athens` (DST: 2026-03-29 03:00→04:00 and 2026-10-25 04:00→03:00);
    - `Asia/Kolkata` (+5:30);
    - `UTC` as a control.
- **Locale:** the test process's ICU default here is `en-US` (12-hour clock). The user's browser shows "Oct 2, 14:05:09". Don't hard-code formatted strings. Compare against a reference `new Intl.DateTimeFormat(undefined, {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", timeZone: ZONE}).format(d)`. Where the point is "local, not UTC", also assert that it differs from the same formatter with `timeZone: "UTC"`.
- **The chart in jsdom (verified):**
  - Even with `initialDimension`, Recharts renders **no SVG** in jsdom: 0 `svg.recharts-surface`, because the `ResizeObserver` polyfill never reports a size.
  - Tests that only read the `role="img"` summary need nothing extra.
  - Tests that inspect the SVG must `vi.mock("recharts", …)`, keeping the actual module and replacing `ResponsiveContainer` with `({children}) => <div>{cloneElement(children, {width: 800, height: 240})}</div>`.
  - With that mock, 3 records rendered 1 `svg.recharts-surface`, 3 `.recharts-line-dots circle`, 1 `.recharts-line-curve` and X-axis ticks.
- **`DateTimePicker` in jsdom (verified):**
  - Its input is a `<button aria-haspopup="dialog">` labelled "From"/"To" (`getByLabelText("From")`).
  - Clicking it opens the dropdown. The day buttons have class `mantine-DateTimePicker-day`; skip those with `data-outside`. The time fields are `role="spinbutton"`.
  - **Clicking a day calls `onChange` at once** with `"YYYY-MM-DD 00:00:00"`.
  - The calendar opens on the current month. Pin it with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(new Date("2026-10-02T12:00:00Z"))`. Only `Date` is faked, so `userEvent` still works.
  - Prefer controlled `value` props for `FilterBar` cases. Use the real picker only where the case says so.
  - The Popover printed a large fiber dump to the console in one probe. If it appears in the suite, filter it; it's not an app error.
- **Racing two Applies:** a Mantine `Button` with `loading` is disabled, so a second click on Apply while one is pending is impossible from the UI. Drive the race with `fireEvent.submit(screen.getByRole("form", {name: "Filters"}))` and use `deferred()` responses.
- **Mocking the client** (`vi.mock("../api/client.js", async (orig) => ({...(await orig()), getHistory: vi.fn(), clearHistory: vi.fn()}))`) is fine for `ClearHistoryButton` unit cases. Use `mockFetch` for `HistoryView` and App cases, so URLs are checked end to end.
- **Decisions:** all open questions were resolved by the user on 2026-10-02 (see "Resolved decisions" at the end). Cases tagged **[OQ-n]** encode them, with a comment naming the OQ. OQ-1, 2, 3, 4, 5, 7 and 10 are app changes that haven't been made yet, so those tests are expected to fail until the app is fixed. Do not skip them or mark them xfail. Write the new cases listed under "Cases added by the resolutions" too.

## Test cases

### utils/history.js — `toApiInstant` (unit, TZ pinned)

- **ID** M4-tz-01
- **Behavior:** At UTC+3, a local picker value becomes the UTC instant 3 hours earlier, and local midnight falls on the previous UTC day.
- **Source:** ARCHITECTURE.md §4.1 "Time zones"; PROGRESS.md "M4 requirement (from M2 OQ-3)"
- **Setup:** `TZ=Asia/Riyadh`.
- **Steps → Expected:**
  - `"2026-10-02 08:00:00"` → `"2026-10-02T05:00:00.000Z"`.
  - `"2026-10-02 00:00:00"` → `"2026-10-01T21:00:00.000Z"`.
  - `"2026-10-02 02:59:00"` → `"2026-10-01T23:59:00.000Z"`.
- **Type:** unit

- **ID** M4-tz-02
- **Behavior:** At a negative offset, the instant is later than the wall-clock time, can cross to the next UTC day, and follows the summer/winter offset of that date.
- **Source:** ARCHITECTURE.md §4.1 "Time zones"
- **Setup:** `TZ=America/New_York`.
- **Steps → Expected:**
  - `"2026-10-02 00:00:00"` → `"2026-10-02T04:00:00.000Z"` (EDT, −4).
  - `"2026-12-15 20:30:00"` → `"2026-12-16T01:30:00.000Z"` (EST, −5, next UTC day).
  - `"2026-03-08 01:59:00"` → `"2026-03-08T06:59:00.000Z"`, and `"2026-03-08 03:00:00"` → `"2026-03-08T07:00:00.000Z"`. These are either side of the spring-forward, one minute of real time apart.
- **Type:** unit

- **ID** M4-tz-03
- **Behavior:** Across a DST change, each unambiguous local time maps with the offset in force at that moment, so a local "whole day" spans 23 or 25 hours.
- **Source:** ARCHITECTURE.md §4.1 "Time zones" ("absolute UTC instant")
- **Setup:** `TZ=Europe/Athens`.
- **Steps → Expected:**
  - **Spring:** `"2026-03-29 02:30:00"` → `"2026-03-29T00:30:00.000Z"`, and `"2026-03-29 04:30:00"` → `"2026-03-29T01:30:00.000Z"`.
  - **Autumn:** `"2026-10-25 02:30:00"` → `"2026-10-24T23:30:00.000Z"`, and `"2026-10-25 04:30:00"` → `"2026-10-25T02:30:00.000Z"`.
  - `buildHistoryParams({from: "2026-03-29 00:00:00", to: "2026-03-30 00:00:00", minConfidencePct: 0})` gives `end − start = 23 h` (`Date.parse` difference `82_800_000`).
  - The same for `2026-10-25` → `2026-10-26` gives `25 h` (`90_000_000`).
- **Type:** unit

- **ID** M4-tz-04
- **Behavior:** Local times that don't exist (spring gap) or happen twice (autumn overlap) resolve to one defined instant. **[OQ-8]**
- **Source:** Spec silent (OQ-8). The recommended answer is to accept the JavaScript `Date` resolution.
- **Setup:** `TZ=Europe/Athens`, then `TZ=America/New_York`.
- **Steps → Expected:**
  - **Athens:**
    - gap `"2026-03-29 03:30:00"` → `"2026-03-29T01:30:00.000Z"` (read as 04:30 EEST);
    - overlap `"2026-10-25 03:30:00"` → `"2026-10-25T00:30:00.000Z"` (the earlier, EEST, occurrence).
  - **New York:**
    - gap `"2026-03-08 02:30:00"` → `"2026-03-08T07:30:00.000Z"`;
    - overlap `"2026-11-01 01:30:00"` → `"2026-11-01T05:30:00.000Z"` (EDT, the earlier).
- **Type:** unit

- **ID** M4-tz-05
- **Behavior:** Half-hour offsets work, and with `TZ=UTC` the value passes through unchanged (control).
- **Source:** ARCHITECTURE.md §4.1 "Time zones"
- **Setup:** `TZ=Asia/Kolkata`, then `TZ=UTC`.
- **Steps → Expected:**
  - Kolkata: `"2026-10-02 08:00:00"` → `"2026-10-02T02:30:00.000Z"`.
  - UTC: `"2026-10-02 08:00:00"` → `"2026-10-02T08:00:00.000Z"`.
- **Type:** unit

- **ID** M4-tz-06
- **Behavior:** The output is always a full UTC instant with `Z`, never a bare or naive value, and empty or unparseable input gives `null`.
- **Source:** ARCHITECTURE.md §3.3 (a value without a timezone is read as UTC), §4.1
- **Setup:** any pinned TZ (Riyadh).
- **Steps → Expected:**
  - For the values in M4-tz-01, each result matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`.
  - `null`, `undefined`, `""` and `"garbage"` each return exactly `null` (`toBeNull()`).
- **Type:** unit

### utils/history.js — `buildHistoryParams` and `validateRange` (unit)

- **ID** M4-params-01
- **Behavior:** Empty filters produce no query params at all.
- **Source:** ARCHITECTURE.md §3.3 (all params optional), §4.1
- **Setup:** none.
- **Steps → Expected:** `buildHistoryParams({from: null, to: null, minConfidencePct: 0})` deep-equals `{}`.
- **Type:** unit

- **ID** M4-params-02
- **Behavior:** From and To map to `start_date` and `end_date` as UTC instants built from the user's local wall-clock time. A picked day sends local midnight, not a bare date (M2 OQ-3).
- **Source:** PROGRESS.md "M4 requirement (from M2 OQ-3)"; ARCHITECTURE.md §4.1
- **Setup:** `TZ=Asia/Riyadh`.
- **Steps → Expected:**
  - `{from: "2026-10-02 00:00:00", to: null, minConfidencePct: 0}` → exactly `{start_date: "2026-10-01T21:00:00.000Z"}`.
  - `{from: null, to: "2026-10-03 00:00:00", minConfidencePct: 0}` → exactly `{end_date: "2026-10-02T21:00:00.000Z"}`.
  - Both set → both keys.
  - No value is ever a bare `YYYY-MM-DD` (`not.toMatch(/^\d{4}-\d{2}-\d{2}$/)`).
- **Type:** unit

- **ID** M4-params-03
- **Behavior:** The slider maps to `min_confidence` as a 0–1 fraction. 0 means no param.
- **Source:** ARCHITECTURE.md §4.1 "Confidence" (0 = no filter, steps of 5), §3.3 (`min_confidence` 0–1)
- **Setup:** none.
- **Steps → Expected:**
  - `minConfidencePct: 0` → no `min_confidence` key (`not.toHaveProperty`).
  - `5` → `"0.05"`, `85` → `"0.85"`, `100` → `"1"`.
  - For every `n` in 5, 10, …, 100: the value equals `String(n/100)` and matches `/^(0\.\d{1,2}|1)$/`, so there are no float artefacts like `0.35000000000000003`.
- **Type:** unit

- **ID** M4-range-01
- **Behavior:** A range is rejected only when both ends are set and From is not strictly before To. The comparison uses the converted instants.
- **Source:** ARCHITECTURE.md §3.3 (`start_date ≥ end_date` → 400), §4.1 ("inline range validation" per PROGRESS.md M4)
- **Setup:** `TZ=America/New_York`.
- **Steps → Expected:**
  - `("2026-10-02 09:00:00", "2026-10-02 10:00:00")` → `null`.
  - The same value twice → `"“From” must be before “To”."`.
  - `("2026-10-02 10:00:00", "2026-10-02 09:00:00")` → the same message.
  - `(x, null)`, `(null, x)` and `(null, null)` → `null`.
  - Across the autumn overlap: `("2026-11-01 01:30:00", "2026-11-01 01:45:00")` → `null`.
- **Type:** unit

### utils/history.js — `summarize`, `formatTimestamp`, `localTimeZone` (unit)

- **ID** M4-sum-01
- **Behavior:** The KPIs are computed over the records given (detections, mean people including empty frames, peak, mean model time). An empty list gives `null` figures.
- **Source:** ARCHITECTURE.md §4.1 (`HistoryStats` KPI `dl`); instructions.md Bonus "statistics panel" (context)
- **Setup:** R4, mapped.
- **Steps → Expected:**
  - `summarize(R4)` deep-equals `{detections: 4, avgPeople: 2, peak: 5, avgModelMs: 250}`.
  - `summarize([])` deep-equals `{detections: 0, avgPeople: null, peak: null, avgModelMs: null}`.
  - A single record with `count 0` → `{detections: 1, avgPeople: 0, peak: 0, …}`.
- **Type:** unit

- **ID** M4-fmt-01
- **Behavior:** Timestamps are displayed in the user's local time zone, including the local calendar day.
- **Source:** ARCHITECTURE.md §4.1 ("Times are displayed in the user's local time zone")
- **Setup:** pinned TZ before import (see Conventions), first `Asia/Riyadh`, then `America/New_York`.
- **Steps → Expected:** `d = new Date("2026-10-02T11:05:09Z")`.
  - `formatTimestamp(d)` equals the reference formatter with `timeZone` set to the pinned zone, and does **not** equal the same with `timeZone: "UTC"`.
  - Riyadh: `formatTimestamp(new Date("2026-10-02T22:30:00Z"))` contains `"Oct 3"`.
  - New York: `formatTimestamp(new Date("2026-10-02T02:30:00Z"))` contains `"Oct 1"`.
- **Type:** unit

- **ID** M4-fmt-02
- **Behavior:** The page can name the user's IANA time zone.
- **Source:** ARCHITECTURE.md §4.1 ("which the page names")
- **Setup:** `TZ=Asia/Kolkata`.
- **Steps → Expected:** `localTimeZone()` → `"Asia/Kolkata"`.
- **Type:** unit

### api/client.js — `getHistory` and `clearHistory` (unit, mocked fetch)

- **ID** M4-api-01
- **Behavior:** With no filters, `getHistory` GETs exactly `<base>/history` with no query string.
- **Source:** ARCHITECTURE.md §3.3, §4.3 (`client.js` is the only module that knows the URL)
- **Setup:** `mockFetch({history: () => jsonResponse([])})`.
- **Steps → Expected:**
  - `getHistory()` and `getHistory({})` each make one call to exactly `"http://localhost:8000/history"`, with no `?`.
  - The method is GET: `options` is undefined or has no `method` other than `"GET"`.
- **Type:** unit

- **ID** M4-api-02
- **Behavior:** Params are URL-encoded, and null or empty ones are dropped.
- **Source:** ARCHITECTURE.md §3.3
- **Setup:** as above.
- **Steps → Expected:**
  - Call `getHistory({start_date: "2026-10-01T21:00:00.000Z", end_date: null, min_confidence: "0.85", x: ""})`.
  - Parse the URL with `new URL(url)`: `searchParams.get("start_date") === "2026-10-01T21:00:00.000Z"` and `searchParams.get("min_confidence") === "0.85"`.
  - `has("end_date")` and `has("x")` are `false`.
- **Type:** unit

- **ID** M4-api-03
- **Behavior:** Records are mapped to camelCase with `timestamp` as a `Date` of the same UTC instant, and the order is preserved.
- **Source:** ARCHITECTURE.md §4.3 (snake_case → camelCase), §3.3 (record fields, oldest first)
- **Setup:** `history` returns R4.
- **Steps → Expected:**
  - The result has 4 items in id order 1, 2, 3, 4.
  - Item 4 deep-equals `{id: 4, timestamp: expect.any(Date), count: 1, averageConfidence: 0.62, inferenceTimeMs: 400}`.
  - Its `timestamp.getTime() === Date.UTC(2026, 9, 2, 11, 5, 9, 563)` (microseconds truncated, not rounded or `NaN`).
- **Type:** unit

- **ID** M4-api-04
- **Behavior:** Every `/history` failure becomes an `ApiError` with a message the page can show.
- **Source:** ARCHITECTURE.md §3.3 (400 `{"detail"}`), §4.3; instructions.md "clear error messages"
- **Setup:** one `history` response per row.
- **Steps → Expected:**
  - `400 {"detail": "start_date must be before end_date"}` → rejects with `ApiError`, `message` equal to that detail, `status` 400.
  - The fetch rejects (`TypeError`) → message starts with `"Can't reach the detection server at http://localhost:8000"`, `status` null.
  - `200 {"items": []}` (not an array) → `"The server sent an unreadable response"`.
  - `500` with a `text/html` body → `"Request failed (HTTP 500)"`.
- **Type:** unit

- **ID** M4-api-05
- **Behavior:** `clearHistory` sends one `DELETE <base>/reset` and resolves to the server's `count_removed`. Errors become `ApiError`.
- **Source:** ARCHITECTURE.md §3.3 `DELETE /reset`
- **Setup:** `reset` returns `{"status": "cleared", "count_removed": 34}`; then a `500 {"detail": "database is locked"}`.
- **Steps → Expected:**
  - The first resolves to `34`, with exactly one call to `"http://localhost:8000/reset"` and `options.method === "DELETE"`.
  - The second rejects with `ApiError("database is locked")`, `status` 500.
- **Type:** unit

### FilterBar (component)

- **ID** M4-filter-01
- **Behavior:** The bar exposes labelled From and To pickers, a named confidence slider, the always-kept hint, and Apply and Reset buttons inside a form named "Filters".
- **Source:** instructions.md "History View" (date, time, confidence threshold); ARCHITECTURE.md §4.1 "Filters", "Confidence"
- **Setup:** `value = EMPTY_FILTERS`, spy callbacks.
- **Steps → Expected:**
  - `getByRole("form", {name: "Filters"})` exists.
  - `getByLabelText("From")` and `getByLabelText("To")` exist; they show the placeholders "Any time" and "Now".
  - `getByRole("slider", {name: "Minimum confidence"})` has `aria-valuemin="0"`, `aria-valuemax="100"` and `aria-valuenow="0"`.
  - The readout shows "Any".
  - The text "Frames with nobody present are always shown." is present.
  - The buttons "Apply" (`type="submit"`) and "Reset" exist.
  - With `minConfidencePct: 85`, `aria-valuenow="85"` and the readout shows "85%".
- **Type:** component

- **ID** M4-a11y-01 (regression for the bug found live)
- **Behavior:** The slider's focusable thumb, the element with `role="slider"`, carries the accessible name "Minimum confidence", not just its wrapper.
- **Source:** PROGRESS.md M4 "Bug found and fixed while checking"; WCAG 4.1.2 (name, role, value)
- **Setup:** as M4-filter-01.
- **Steps → Expected:**
  - `const thumb = getByRole("slider", {name: "Minimum confidence"})`.
  - `thumb` has `tabindex="0"` (it is the focusable element).
  - `thumb` has the accessible name "Minimum confidence".
  - No other element with `role="slider"` exists (`getAllByRole("slider")` has length 1).
- **Type:** component

- **ID** M4-filter-02
- **Behavior:** Moving the slider changes only the draft (`onChange`) in steps of 5. It never applies by itself.
- **Source:** ARCHITECTURE.md §4.1 ("a draft until Apply", "steps of 5")
- **Setup:** controlled, with a wrapper that feeds `onChange` back into `value`.
- **Steps → Expected:**
  - Focus the thumb. `ArrowRight` → `onChange` last called with `{from: null, to: null, minConfidencePct: 5}`.
  - `End` → `100`. `Home` → `0`.
  - `onApply` is never called.
- **Type:** component

- **ID** M4-filter-03
- **Behavior:** Picking a day in the real From picker sets the draft to that local day at 00:00, and leaves To unchanged.
- **Source:** ARCHITECTURE.md §4.1 ("pickers yield local wall-clock time")
- **Setup:** fake `Date` only, system time `2026-10-02T12:00:00Z` (see Conventions); controlled `value = EMPTY_FILTERS`.
- **Steps → Expected:**
  - Click `getByLabelText("From")`, then the non-outside day button with text "15".
  - `onChange` is called with `{from: "2026-10-15 00:00:00", to: null, minConfidencePct: 0}`.
  - `onApply` is not called.
- **Type:** component

- **ID** M4-filter-04
- **Behavior:** Apply (click or form submit) calls `onApply` once when the range is valid, and Reset calls `onReset`.
- **Source:** ARCHITECTURE.md §4.1 "Filters"
- **Setup:** `value = {from: "2026-10-02 09:00:00", to: "2026-10-02 10:00:00", minConfidencePct: 50}`.
- **Steps → Expected:**
  - Click "Apply" → `onApply` called 1 time.
  - `fireEvent.submit(form)` → 2 times.
  - Click "Reset" → `onReset` called 1 time, and `onApply` is still at 2.
- **Type:** component

- **ID** M4-filter-05
- **Behavior:** An inverted or empty range shows an inline error, disables Apply and blocks submission.
- **Source:** ARCHITECTURE.md §3.3 (`start_date ≥ end_date` is a 400), §4.1; PROGRESS.md M4 ("inline range validation")
- **Setup:** `value = {from: "2026-10-02 10:00:00", to: "2026-10-02 09:00:00", minConfidencePct: 0}`.
- **Steps → Expected:**
  - The text `“From” must be before “To”.` is visible.
  - "Apply" is disabled.
  - `fireEvent.submit(form)` → `onApply` is not called.
  - The same with `from === to`.
  - Rerender with a valid range → the message is gone and Apply is enabled.
- **Type:** component

- **ID** M4-filter-06
- **Behavior:** While a query is in flight, Apply shows its loading state and is disabled, and Reset is disabled.
- **Source:** ARCHITECTURE.md §4.1 ("loading" state)
- **Setup:** `loading={true}`.
- **Steps → Expected:**
  - "Apply" has `data-loading="true"` and is disabled.
  - "Reset" is disabled.
- **Type:** component

### HistoryView — loading, data, filters (component, `mockFetch`)

- **ID** M4-view-01
- **Behavior:** On mount, the page makes exactly one unfiltered `/history` request and shows a loading status until it resolves.
- **Source:** ARCHITECTURE.md §4.1 ("on mount, call `/history`", "States: loading")
- **Setup:** `history` returns `deferred()`.
- **Steps → Expected:**
  - Before resolving: `getByRole("status")` has the text "Loading history…"; there is no "Totals" `dl` and no table.
  - `callsTo(fetchMock, "/history")` has length 1, and its URL has no `?`.
  - Resolve with R4 → the status is gone; the "Totals" `dl`, the "People over time" section and the "Records" table are present.
- **Type:** component

- **ID** M4-view-02
- **Behavior:** The KPIs show the figures for the records returned, in a `dl` that pairs each label with its value.
- **Source:** ARCHITECTURE.md §4.1 (`HistoryStats` KPI `dl`)
- **Setup:** `history` returns R4.
- **Steps → Expected:** In the `dl` named "Totals", the `dt`/`dd` pairs are, in order:
  - "Detections" → "4"
  - "Avg people per frame" → "2.0"
  - "Peak count" → "5"
  - "Avg model time" → "250 ms"

  Each `dd` immediately follows its `dt`.
- **Type:** component

- **ID** M4-view-03
- **Behavior:** The page names the time zone the times are shown in, and the table shows those local times.
- **Source:** ARCHITECTURE.md §4.1 "Time zones"
- **Setup:** `TZ=Asia/Riyadh` pinned before importing `HistoryView`; `history` returns R4.
- **Steps → Expected:**
  - The text contains "Times are shown in your local time zone (Asia/Riyadh)".
  - The first table row's `<time>` text equals the reference formatter (Riyadh) for `2026-10-02T11:05:09.563Z`.
- **Type:** component

- **ID** M4-view-04
- **Behavior:** Filter edits are a draft: no request is made until Apply, which sends exactly one request with the drafted params.
- **Source:** ARCHITECTURE.md §4.1 ("a draft until Apply")
- **Setup:** `history` returns R4 on the first call and `[R4[2]]` on the second.
- **Steps → Expected:**
  - After the mount load, move the slider to 85 with the keyboard (`End`, then `ArrowLeft` × 3).
  - Still 1 `/history` call, and the KPI "Detections" is still "4".
  - Click "Apply" → 2 calls. The second URL has `min_confidence=0.85` and neither `start_date` nor `end_date`.
  - "Detections" becomes "1".
- **Type:** component

- **ID** M4-view-05
- **Behavior:** Dates picked in the page's pickers reach the API as UTC instants for the user's local midnight. This is the end-to-end form of M2 OQ-3.
- **Source:** PROGRESS.md "M4 requirement (from M2 OQ-3)"; ARCHITECTURE.md §4.1
- **Setup:**
  - `TZ=Asia/Riyadh` pinned before import.
  - Fake `Date` at `2026-10-02T12:00:00Z`.
  - `history` returns `[]` after mount.
- **Steps → Expected:**
  - Pick day "2" in From and day "3" in To, then Apply.
  - The last `/history` URL has `start_date=2026-10-01T21:00:00.000Z` and `end_date=2026-10-02T21:00:00.000Z`.
  - Neither param equals a bare date.
- **Type:** component

- **ID** M4-view-06
- **Behavior:** Reset clears the draft and immediately re-queries with no params.
- **Source:** ARCHITECTURE.md §4.1 ("Reset clears them and re-queries")
- **Setup:** after M4-view-04's Apply (slider 85 applied).
- **Steps → Expected:**
  - Click "Reset" → exactly one more `/history` call, with no `?`.
  - The slider has `aria-valuenow="0"` and the readout shows "Any".
  - From and To show their placeholders.
  - "Detections" is "4".
- **Type:** component

- **ID** M4-view-07
- **Behavior:** An inverted range on the page blocks the request.
- **Source:** ARCHITECTURE.md §3.3, §4.1
- **Setup:** fake `Date` as M4-view-05. Pick From day "5" and To day "3".
- **Steps → Expected:**
  - The range message is shown and "Apply" is disabled.
  - Submitting the form leaves `/history` calls at 1 (mount only).
- **Type:** component

- **ID** M4-view-08
- **Behavior:** Latest request wins: when two queries overlap, only the most recent one's result (or error) is shown, whichever order they resolve in.
- **Source:** ARCHITECTURE.md §4.1 ("Latest-request-wins applies to queries")
- **Setup:**
  - The mount call resolves with R4.
  - Then two deferred `/history` responses, A and B.
  - Set the slider to 50 and `fireEvent.submit(form)` (A). Set it to 85 and submit again (B). Apply is disabled while loading, so use `submit`.
- **Steps → Expected:**
  - **Row 1:** resolve B with `[R4[2]]`, then A with `many(20)` → "Detections" is "1", and it stays "1" after a `flush`.
  - **Row 2:** resolve A first with `many(20)`, then B with `[R4[2]]` → it ends at "1".
  - **Row 3:** resolve B with `[R4[2]]`, then reject A with `400 {"detail":"stale"}` → no error alert, and "Detections" is "1".
  - **Row 4:** B returns `[]` after A returns data → "No detections match these filters." is shown, because the applied filters are B's (85).
- **Type:** component

- **ID** M4-view-09
- **Behavior:** A failed query shows an alert with the backend's message, hides the stale figures, and the page recovers on the next successful query.
- **Source:** ARCHITECTURE.md §4.1 ("error (the backend's `detail`)"); instructions.md "clear error messages"
- **Setup:** `history` gives `400 {"detail": "min_confidence must be between 0 and 1"}` on mount; then R4.
- **Steps → Expected:**
  - An alert titled "Couldn't load the history." contains "min_confidence must be between 0 and 1".
  - There is no "Totals" `dl` and no table.
  - "Apply" is enabled. Click it → the alert is gone and "Detections" is "4".
  - A second row, with a fetch rejection, shows "Can't reach the detection server at http://localhost:8000. Is the backend running?".
- **Type:** component

- **ID** M4-view-10
- **Behavior:** With no records and no filters, the page says "No detections yet" and offers "Go to Detect", which navigates to the Detect page.
- **Source:** ARCHITECTURE.md §4.1 ("No detections yet" with *Go to Detect*)
- **Setup:** `history` returns `[]`; `onNavigate = vi.fn()`.
- **Steps → Expected:**
  - The texts "No detections yet." and "Every successful detection is recorded here." are shown.
  - There are no KPIs, chart or table.
  - Click "Go to Detect" → `onNavigate` called exactly once with `"detect"`.
- **Type:** component

- **ID** M4-view-11
- **Behavior:** With no records under applied filters, the page says so and offers "Reset filters", which re-queries unfiltered.
- **Source:** ARCHITECTURE.md §4.1 ("No detections match these filters" with *Reset filters*)
- **Setup:** mount returns R4; after slider 85 + Apply, return `[]`; then R4.
- **Steps → Expected:**
  - "No detections match these filters." is shown, and "Go to Detect" is absent.
  - Click "Reset filters" → one more `/history` call with no `?`, the slider is back at 0, and "Detections" is "4".
- **Type:** component

### HistoryChart (component)

- **ID** M4-chart-01
- **Behavior:** The chart carries a text summary for screen readers: the count, the local first and last times, and the peak.
- **Source:** ARCHITECTURE.md §4.1 "Chart" (`role="img"` + `aria-label`)
- **Setup:** `TZ=America/New_York` pinned before import; R4 mapped. No Recharts mock is needed.
- **Steps → Expected:**
  - The section named "People over time" contains `getByRole("img")` with `aria-label` exactly `` `People over time: 4 detections from ${F(R4[0])} to ${F(R4[3])}, peak 5.` ``, where `F` is the reference formatter for New York.
  - With `records=[]` → `"No detections to chart."`.
- **Type:** component

- **ID** M4-chart-02
- **Behavior:** Each record is plotted as one point on a real time axis, so the horizontal gaps are proportional to the time between detections, not evenly spaced.
- **Source:** ARCHITECTURE.md §4.1 "Chart" (numeric time axis, `scale="time"`); instructions.md ("timestamp vs. number of people")
- **Setup:** Recharts `ResponsiveContainer` mocked (Conventions); R4 mapped.
- **Steps → Expected:**
  - Exactly 1 `svg.recharts-surface` and 4 plotted point markers (one per record). **[OQ-10]** There are no connecting lines between points: no `.recharts-line-curve` path, or one with no visible stroke (`stroke="none"` / `strokeWidth` 0).
  - Read the `cx` values: they increase strictly.
  - `(cx[1] − cx[0]) / (cx[2] − cx[1])` is 1/9 within ±0.02 (1 min vs. 9 min).
- **Type:** component

- **ID** M4-chart-03
- **Behavior:** The vertical position encodes the person count: more people is higher, and a zero-person frame is plotted at the bottom.
- **Source:** instructions.md ("number of people"); ARCHITECTURE.md §3.3 (zero-person records kept "so the chart doesn't lose its 'nobody present' points")
- **Setup:** as M4-chart-02.
- **Steps → Expected:**
  - The dot for record 2 (count 0) has the largest `cy`, and record 3 (count 5) the smallest.
  - The Y-axis tick labels are all integers (`/^\d+$/`).
- **Type:** component

- **ID** M4-chart-04
- **Behavior:** A single record renders without error (one point).
- **Source:** ARCHITECTURE.md §4.1 (the chart is shown whenever there are records)
- **Setup:** Recharts mocked; `[R4[0]]`.
- **Steps → Expected:**
  - No throw, and no `console.error` (spy).
  - 1 `.recharts-line-dots circle`.
  - The summary mentions "peak 2".
- **Type:** component

### HistoryTable (component)

- **ID** M4-table-01
- **Behavior:** Rows are newest first, with columns Time, People, Avg confidence and Model time. The time is in local time with a machine-readable UTC `datetime`.
- **Source:** ARCHITECTURE.md §4.1 ("`HistoryTable` (newest first, 15 per page)", local display)
- **Setup:** `TZ=Asia/Riyadh` pinned; R4 mapped (oldest first, as the API returns it).
- **Steps → Expected:**
  - Column headers in order: "Time", "People", "Avg confidence", "Model time".
  - The body rows' "People" cells read 1, 5, 0, 2 (ids 4, 3, 2, 1).
  - The first row's `<time>` has `datetime="2026-10-02T11:05:09.563Z"`, and its text equals the Riyadh reference formatter.
- **Type:** component

- **ID** M4-table-02
- **Behavior:** Confidence is shown as a rounded percentage and model time with `formatMs` units.
- **Source:** ARCHITECTURE.md §4.1; M3 `formatMs` decision (rounds before choosing the unit)
- **Setup:** records `count 2, avg 0.80, ms 142.3` and `count 1, avg 0.62, ms 1234`.
- **Steps → Expected:**
  - Row cells read "80%" / "142 ms" and "62%" / "1.23 s".
- **Type:** component

- **ID** M4-table-03
- **Behavior:** A frame with nobody in it shows "0" people and "—" for confidence (not "0%").
- **Source:** PROGRESS.md M4 / code intent; ARCHITECTURE.md §3.3 (zero-person frames always kept). Spec-wise, there is no confidence for an empty frame.
- **Setup:** R4 record 2 (count 0, avg 0.0).
- **Steps → Expected:** that row's People cell is "0" and its Avg confidence cell is exactly "—".
- **Type:** component

- **ID** M4-table-04
- **Behavior:** The table shows 15 rows per page, with pagination only when needed and a correct footer count.
- **Source:** ARCHITECTURE.md §4.1 ("15 per page")
- **Setup:** `many(33)`, `many(16)`, `many(15)`, `many(1)`.
- **Steps → Expected:**
  - **33:** 15 body rows; page buttons "1", "2", "3"; "1" has `aria-current="page"`; the footer reads "33 records, newest first". Click "3" → 3 rows, and the last row's `datetime` is `2026-10-02T08:00:00.000Z` (id 1).
  - **16:** two pages, and page 2 has 1 row.
  - **15:** 15 rows and no pagination buttons.
  - **1:** the footer reads "1 record, newest first".
- **Type:** component

- **ID** M4-table-05
- **Behavior:** A new result set starts again at page 1.
- **Source:** PROGRESS.md M4 ("reset to page 1 on new results"); ARCHITECTURE.md §4.1
- **Setup:** `many(33)`; go to page 3.
- **Steps → Expected:**
  - `rerender` with a new array `many(40)` → page "1" has `aria-current="page"`, and the first row is id 40.
  - Also through HistoryView: go to page 3, Apply → page 1 after the new results arrive.
- **Type:** component

- **ID** M4-table-06
- **Behavior:** Every pagination control has an accessible name. **[OQ-4]**
- **Source:** WCAG 4.1.2; the same bug class as the slider (M4-a11y-01). The spec is silent, so this is OQ-4.
- **Setup:** `many(33)`.
- **Steps → Expected:**
  - Every `button` in the "Records" section has a non-empty accessible name (`toHaveAccessibleName()`).
  - Measured during planning: the previous and next controls have an **empty** name today; the page buttons are "1", "2", "3".
  - Recommended names: "Previous page" and "Next page".
- **Type:** component

### Clear history (component; `ClearHistoryButton` alone and inside HistoryView)

- **ID** M4-clear-01
- **Behavior:** Opening the dialog fetches the **unfiltered** total, even when filters are applied, and shows a counting state with Delete disabled until the count arrives.
- **Source:** ARCHITECTURE.md §4.1 "Clear history"; PROGRESS.md "Clear history" decision
- **Setup:**
  - In HistoryView, the mount returns R4.
  - Apply slider 85, which returns `[R4[2]]`.
  - The next `/history` (the count) is deferred.
- **Steps → Expected:**
  - Click "Clear history" → a dialog titled "Clear detection history?" shows "Counting records…".
  - Its delete button is disabled.
  - The latest `/history` URL has **no** query string.
- **Type:** component

- **ID** M4-clear-02
- **Behavior:** The dialog states the scope: all N records, that it ignores the filters, and that it can't be undone. The button reads "Delete all N records".
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md "Clear history" decision
- **Setup:** continue M4-clear-01; resolve the count with `many(34)` (the page itself shows 1 filtered record).
- **Steps → Expected:**
  - The dialog contains "This deletes all 34 records in the history.", "It ignores the filters currently applied." and "It can't be undone."
  - The button "Delete all 34 records" is enabled.
  - No `DELETE` has been sent.
- **Type:** component

- **ID** M4-clear-03
- **Behavior:** Confirming sends one `DELETE /reset`, closes the dialog, shows a notice with the number the **server** reports as removed, and reloads the history.
- **Source:** ARCHITECTURE.md §4.1 ("Then `DELETE /reset`, a success notice, and a reload"), §3.3 (`count_removed`)
- **Setup:** HistoryView, no filters, mount R4; the count returns `many(34)`; `reset` returns `{"status":"cleared","count_removed":35}` (it differs on purpose); the reload returns `[]`.
- **Steps → Expected:**
  - Click "Delete all 34 records" → exactly 1 `/reset` call, with method `DELETE`.
  - The dialog is closed.
  - The notice reads "Deleted 35 records."
  - Exactly one more `/history` call follows the DELETE (the reload).
  - "No detections yet." is shown.
  - With `count_removed: 1`, the notice reads "Deleted 1 record."
- **Type:** component

- **ID** M4-clear-04
- **Behavior:** Cancelling, pressing Escape or using the close control deletes nothing and leaves the data as it was.
- **Source:** ARCHITECTURE.md §4.1 (confirmation dialog)
- **Setup:** HistoryView with R4; the count returns R4.
- **Steps → Expected:**
  - Open → Cancel → the dialog is gone, there are 0 `/reset` calls and "Detections" is "4".
  - Repeat with `Escape`, and with the modal's close button. Same results.
- **Type:** component

- **ID** M4-clear-05
- **Behavior:** With 0 records, the dialog says there's nothing to delete and offers no way to delete.
- **Source:** ARCHITECTURE.md §4.1 (the count shown); spec intent: don't delete without showing what goes
- **Setup:** the count returns `[]`.
- **Steps → Expected:**
  - The text "History is already empty. There is nothing to delete." is shown.
  - The confirm button (name "Delete") is disabled.
  - Clicking it sends 0 `/reset` calls.
- **Type:** component

- **ID** M4-clear-06
- **Behavior:** If the count can't be fetched, the dialog shows the error and doesn't allow a blind delete. Reopening retries the count. **[OQ-6]**
- **Source:** ARCHITECTURE.md §4.1 (the dialog states the count); instructions.md "clear error messages"; OQ-6
- **Setup:** the count gives `500 {"detail":"database is locked"}` first, then R4.
- **Steps → Expected:**
  - The dialog shows an alert "database is locked".
  - The text "Delete all" is absent, and the confirm button is disabled.
  - 0 `/reset` calls.
  - Cancel → reopen → a new `/history` call; "Delete all 4 records" is shown and the alert is gone.
- **Type:** component

- **ID** M4-clear-07
- **Behavior:** A failed delete keeps the dialog open with the server's message, adds no notice and no reload, and allows a retry.
- **Source:** ARCHITECTURE.md §3.3, §4.1; instructions.md "clear error messages"
- **Setup:** HistoryView, R4; the count returns R4; `reset` gives `500 {"detail":"database is locked"}` first, then `{"count_removed": 4}`.
- **Steps → Expected:**
  - After clicking "Delete all 4 records":
    - the dialog is still open, with an alert "database is locked";
    - there is no success notice;
    - the `/history` call count is unchanged (no reload);
    - "Delete all 4 records" is enabled again.
  - Click again → 2 `/reset` calls in total; the dialog closes and the notice reads "Deleted 4 records."
- **Type:** component

- **ID** M4-clear-08
- **Behavior:** While the delete is in flight, the dialog can't be dismissed and the delete can't be sent twice.
- **Source:** ARCHITECTURE.md §4.1 (spec intent: one deletion per confirmation)
- **Setup:** `reset` deferred.
- **Steps → Expected:**
  - The confirm button has `data-loading="true"`, and "Cancel" is disabled.
  - `Escape` leaves the dialog open.
  - Clicking confirm again → still 1 `/reset` call.
  - Resolve → the dialog closes.
- **Type:** component

- **ID** M4-clear-09
- **Behavior:** The notice after clearing is dismissible, and is cleared by the next Apply or Reset.
- **Source:** ARCHITECTURE.md §4.1 ("a success notice")
- **Setup:** after M4-clear-03.
- **Steps → Expected:**
  - The notice has a close button; clicking it removes the notice.
  - Clear again → the notice is back. Click "Reset" → the notice is gone.
- **Type:** component

- **ID** M4-clear-10
- **Behavior:** With exactly one record, the wording is grammatical. **[OQ-5]**
- **Source:** ARCHITECTURE.md §4.1 ("Delete all N records"); OQ-5
- **Setup:** the count returns `[R4[0]]`.
- **Steps → Expected:**
  - Recommended expectation: the button is "Delete 1 record" and the text is "This deletes the only record in the history." (or the wording the human picks).
  - Today it renders "Delete all 1 record" and "This deletes all 1 record in the history."
- **Type:** component

### App — navigation (component)

- **ID** M4-app-01
- **Behavior:** Opening History loads the history (one `/history` call per visit) under the "Detection history" heading, and "Go to Detect" switches the app back to the Detect page.
- **Source:** ARCHITECTURE.md §4.1, §4.3 (navigation is plain state); PROGRESS.md M4 (`App` passes `onNavigate`)
- **Setup:** `mockFetch()` with the default `history` (`[]`).
- **Steps → Expected:**
  - Click nav "History" → the `h2` is "Detection history", and there is exactly 1 `/history` call, without `?`.
  - "No detections yet." is shown.
  - Click "Go to Detect" → the dropzone is visible (`toBeVisible()`); nav "Detect" has `aria-current="page"` and "History" doesn't; `window.location.href` is unchanged.
- **Type:** component

- **ID** M4-app-02
- **Behavior:** Returning to History shows fresh data, for example detections made on the Detect page in between.
- **Source:** ARCHITECTURE.md §4.1 ("on mount, call `/history`"); instructions.md (the history reflects saved detections)
- **Setup:** `history` returns `[R4[0]]` on the first call and R4 on the second.
- **Steps → Expected:**
  - History → "Detections" is "1".
  - Detect → History → 2 `/history` calls in total, and "Detections" is "4".
  - Clicking "History" while already on History adds no call.
- **Type:** component

### Backend contract with the frontend's exact format (unit, TestClient)

- **ID** M4-be-01
- **Behavior:** `/history` accepts the millisecond `…Z` instants that `Date.toISOString()` produces, with an inclusive start and an exclusive end, at sub-second precision.
- **Source:** ARCHITECTURE.md §3.3 (start inclusive; datetime end exclusive; offsets accepted)
- **Setup:** the `storage` fixture with records at `2026-10-01T20:59:59.999Z`, `2026-10-01T21:00:00.000Z`, `2026-10-02T20:59:59.999Z` and `2026-10-02T21:00:00.000Z` (the `utc()` helper, temp DB).
- **Steps → Expected:**
  - `GET /history?start_date=2026-10-01T21:00:00.000Z&end_date=2026-10-02T21:00:00.000Z` → 200, and exactly the middle two records, oldest first.
  - `start_date=end_date=2026-10-02T05:00:00.000Z` → 400 with a string `detail`.
  - Read-only check during planning: the live server accepts `.000Z` (200) and returns 400 "start_date must be before end_date" for equal values.
- **Type:** unit

**Total: 59 automated cases** (19 unit, including M4-be-01 on the backend; 40 component), plus 13 manual checks and a cross-browser timestamp check.

## Regression

**Baselines measured during planning:**
- Frontend `npm test`: **156 tests, 151 pass, 5 fail.**
- Backend `backend/.venv/bin/python -m pytest`: **170 pass** in about 14 s.
- M4 doesn't touch the backend (`git diff` has no backend files), so all 170 must still pass.

**The 5 failing shell tests, classified for the healer.** All 5 are **outdated by M4: test bugs, not app bugs.** M4 deliberately replaced the placeholder and added a `/history` fetch.
- **Cause:** each test opens History and asserts the old text "Detection history is coming in the next milestone.". Because `mockFetch` has no `/history` route, the page also lands in the error state ("Can't reach the detection server").
- **The fix in every case:**
  - Add the `/history` route to `mockFetch` (default `[]`).
  - Replace the placeholder assertion with the `h2` "Detection history" plus "No detections yet." (or any M4 state).
  - Keep every other assertion.
- **Per test:**
  - **M3-app-02:** both the placeholder assertion and `/history` called 0 times are outdated. The `/history` count becomes exactly 1 after one visit. "No dropzone on History", `aria-current` and the unchanged URL stay valid.
  - **M3b-shell-02:** only the two placeholder lines are outdated. The `aria-current` uniqueness and "clicking History again keeps the page" logic stays. It can also assert that the second click adds no `/history` call.
  - **M3b-shell-03:** only the placeholder line is outdated. The keyboard-navigation intent is unchanged.
  - **M3b-shell-04:** only the placeholder line is outdated. The OQ-4 burger assertions (`aria-expanded`/`aria-controls`) stay valid.
  - **M3b-shell-05:** its core (the status card is not remounted, and `/health` is called exactly once across switches) stays valid. The final `callsTo(fetchMock, "/history")).toHaveLength(0)` is outdated. With visits History, Detect, History it becomes **2**, consistent with M4-app-02.
  - If OQ-1 is decided as "keep pages mounted", re-check M3-app-02's "no dropzone" (it would become "not visible").

**Re-check unchanged:**
- **M3/M3b DetectionView, uploader, overlay, pre-check, BackendStatus and theme tests** (the other 151). `App` now passes `onNavigate` to `DetectionView`, which ignores it. They must stay green.
- **M3-api-01..09 and M3b `checkHealth` cases:** `client.js` gained `getHistory`/`clearHistory` on the shared `request()`. The error mapping must be unchanged.
- **`main.colorscheme.test.jsx`:** `main.jsx` now also imports `@mantine/dates/styles.css`, so it must still import cleanly under Vitest.
- **Build:** `npm run build` succeeds with `recharts` and `@mantine/dates`. Note the bundle size warning, if any, in PROGRESS.md; it's not a failure.
- **Backend M2 `/history` and `/reset` suites:** these are the contract the UI relies on: zero-person records kept under `min_confidence`, oldest-first order, and 400 with a string `detail`.
- **M3b manual checks 4 (responsive shell), 9 (keyboard), 13 (clean console) and 14 (fits the viewport):** re-run them with the History page, which is now real and much taller. See the manual checks below.

## Manual checks (real browser)

**Precondition:** the Chrome window used by the browser tool must be **visible**. It was hidden (`document.visibilityState === "hidden"`), which throttles timers, skips animation frames, makes screenshots time out and stops Mantine transitions, so the Modal never opens. Check `document.visibilityState === "visible"` before starting, and repeat the check if a step stalls.

**Data safety:** the live backend (:8000, 34 records) is the user's data. Checks 1–7 and 9–12 are read-only there. For anything that deletes data or stops a backend (checks 8 and 13), use a **sandbox**:
- **Backend:** `DB_PATH=<scratch>/sandbox.db CORS_ORIGINS=http://localhost:5174 backend/.venv/bin/uvicorn backend.main:app --port 8001`, seeded by a few `/detect` calls on 8001.
- **Frontend:** a second Vite instance with `VITE_API_BASE_URL=http://localhost:8001 npx vite --port 5174`.
- Don't stop the user's :8000 or :5173.

1. **Data and time zone (live, read-only).**
   - The KPIs match a `curl :8000/history` computed by hand (count, mean, max, mean ms).
   - The subtitle names the OS zone (Europe/Athens).
   - The newest table row's time equals its UTC `datetime` + 3 h (EEST).
   - In DevTools → Sensors → Location, override the time zone with `America/New_York` and reload. The subtitle names New York, and the same row shows UTC − 4 h.
2. **Layout (≥ 1200 px wide), against §4.1 and the mockup if available.**
   - The order is: heading and subtitle with "Clear history" on the right; the filter card with 4 columns at `lg`; 4 KPI cards in one row; the chart card; the table card.
   - Nothing overlaps.
   - At 700 px and 360 px: the columns stack, and `document.scrollingElement.scrollWidth <= innerWidth` (the table scrolls inside its own container).
3. **Date pickers.**
   - Open From: the dropdown fits in the viewport (`getBoundingClientRect` inside `innerWidth`/`innerHeight`) at 1200 px and 360 px.
   - Pick Oct 2, set 08:00 and confirm. The field reads "Oct 2, 2026 08:00".
   - Apply. In the Network tab, `start_date=2026-10-02T05:00:00.000Z` (Athens).
   - The clear (×) control empties the field.
   - Escape closes the dropdown without changing the value.
   - Make To earlier than From: the red error appears under To and Apply is disabled.
   - The time spinbuttons work from the keyboard.
4. **The date-only trap (OQ-2).**
   - Pick only a day in To (Oct 2) and Apply. Record whether records from Oct 2 are included (today they're excluded, because the end is exclusive at local 00:00).
   - Note the result in the healer report.
5. **Slider.**
   - Drag and use the arrow keys: the readout steps by 5 and shows "Any" at 0. No request is made until Apply.
   - In the Accessibility tree, the thumb (`role=slider`) is named "Minimum confidence".
   - At 85% → `?min_confidence=0.85` and 1 record.
6. **Chart rendering.**
   - About 34 dots are drawn.
   - Spacing follows real time: a 30-minute gap is visibly wider than a 1-minute gap.
   - The X-axis ticks are local times with no overlapping labels.
   - The Y-axis shows integers only.
   - Hovering a dot shows a tooltip with the local time and "N people" / "1 person".
   - With the slider at 85% (1 record), a single dot renders and the console shows no errors.
   - Resize from 1200 to 360 px: the chart redraws to its width.
7. **Clear dialog, without confirming (live).**
   - With 85% applied, open Clear history. The modal animates in, is centered, and traps focus (Tab cycles inside it).
   - It reads "Delete all 34 records", the unfiltered total, with both bullet points.
   - Escape, an overlay click and Cancel each close it. The Network tab shows a GET `/history` with no params and **no DELETE**.
8. **Clear dialog, confirming (sandbox only).**
   - Confirm: one DELETE `/reset`, the dialog closes, the notice "Deleted N records." appears, and "No detections yet." (or the OQ-3 outcome) is shown.
   - Reopen with an empty DB: "History is already empty", and the button is disabled.
   - Stop the sandbox backend, then open the dialog: the error appears inside it and Delete is disabled.
9. **Pagination.**
   - Page through 3 pages (15/15/4); the last row is the oldest.
   - Apply a filter → back to page 1.
   - The previous/next controls are reachable by keyboard. Record their accessible names (OQ-4).
10. **Keyboard and focus.** Tab through: Clear history → From → To → the slider thumb → Reset → Apply → the table pagination. Every control shows a visible focus ring.
11. **Contrast (AA 4.5:1).** The subtitle, the "Frames with nobody present…" hint, the KPI labels, the "—" cells, the gray/mint/peach badges, the axis tick text `#5b6676` on white, and the footer text.
12. **Clean console and request count.**
    - A session of load, Apply, Reset, opening/cancelling the dialog, paging, Detect, then History again logs no React, Mantine or Recharts warnings.
    - In dev, StrictMode may send 2 `/history` GETs on mount. Check `npm run build && npx vite preview` (sandbox or read-only live) for exactly 1.
13. **Error state (sandbox).** Stop the sandbox backend and Apply. The alert "Couldn't load the history." shows "Can't reach the detection server at http://localhost:8001…". Restart it and Apply: the page recovers.

Also, with the microsecond timestamps (OQ-7): open the live History page in **Firefox** (and Safari if available). The table shows valid times, not "Invalid Date", and the console has no `RangeError`.

> **Note (after healing, 2026-10-02):** the case bodies of M4-params-02, M4-range-01, M4-tz-03, M4-filter-05, M4-view-05 and M4-fmt-02 still show values from before OQ-2 (and the ICU alias issue). The tests follow the resolutions below. See `milestone-4-healer-report.md` for the updated expectations.

## Resolved decisions (user, 2026-10-02)

"App change" means the code must change, and the tests encode the new behavior.

- **OQ-1 — Keep the Detect result across page switches:** **app change.** `App` keeps `DetectionView` mounted while History is shown (hidden, e.g. the `hidden` attribute or `display:none`, so it's out of the accessibility tree and not visible). An in-flight detection keeps running. `HistoryView` still mounts on each visit, so it refreshes. Regression: assertions like "no dropzone on History" become "dropzone not visible" (`not.toBeVisible()` or absent from `getByRole` queries).
- **OQ-2 — "To" is inclusive of the chosen minute:** **app change.**
  - When a day is picked in "To" and the resulting value's time is 00:00 (a new day picked, not a time edit), the "To" value becomes that day at **23:59**.
  - `buildHistoryParams` and `validateRange` treat "To" as inclusive of its minute: `end_date` = `toApiInstant(to)` + 60 s.
  - So "From Oct 2 00:00, To Oct 2 23:59" is valid and covers the whole local day (end = Oct 3 00:00 local, in UTC).
  - A "To" whose time the user explicitly set keeps that time, still inclusive of the minute.
- **OQ-3 — After a successful clear:** **app change.** The filters reset (draft and applied), the page reloads unfiltered and shows "No detections yet." plus the "Deleted N records." notice.
- **OQ-4 — Pagination names:** **app change.** The previous and next controls are named "Previous page" and "Next page", and the page buttons keep their numbers. M4-table-06.
- **OQ-5 — Singular wording:** **app change.** With 1 record, the dialog says "This deletes the only record in the history." and the button says "Delete 1 record". The chart summary says "1 detection". The notice for removed = 1 says "Deleted 1 record."
- **OQ-6 — Count fetch fails:** accepted as is. Delete stays disabled, and reopening retries.
- **OQ-7 — Microsecond timestamps:** **app change.** `getHistory` trims the fractional seconds to 3 digits before `new Date(...)`, so parsing never depends on engine leniency. Covered by M4-api; keep the Firefox/Safari manual check.
- **OQ-8 — DST gaps and overlaps:** accepted as is: JavaScript `Date` resolution, pinned in M4-tz-04.
- **OQ-9 — Docs:** ARCHITECTURE.md §2's file tree and PROGRESS.md's "charting library not chosen" are updated as part of the M4 fixes. No test.
- **OQ-10 — Chart style (raised in the user's visual check):** **app change.** Detections are isolated snapshots, so the chart plots one dot per detection on the time axis, with **no connecting lines**. A line would suggest the count changed steadily between snapshots. M4-chart-02.

### Cases added by the resolutions

- **M4-params-04 [OQ-2]:** `buildHistoryParams({to: "2026-10-02 23:59:00"})` under `TZ=Europe/Athens` → `end_date` = `"2026-10-02T21:00:00.000Z"` (Oct 3 00:00 local). `{to: "2026-10-02 14:30:00"}` → `"2026-10-02T11:31:00.000Z"`. `validateRange("2026-10-02 00:00:00", "2026-10-02 23:59:00")` → `null`. `validateRange("2026-10-02 10:00:00", "2026-10-02 09:58:00")` → an error.
- **M4-filter-07 [OQ-2]:** In FilterBar, picking a day in the "To" calendar results in an `onChange` draft whose `to` is that day at `23:59:00`. Editing only the time of an existing "To" doesn't snap it to 23:59.
- **M4-clear-11 [OQ-3]:** With filters applied (both draft and applied), a successful clear leads to a reload with **no** query params. The filter bar is back to empty (From/To placeholders, slider "Any"), and "No detections yet." is shown with the notice (not "No detections match these filters").
- **M4-app-03 [OQ-1]:** Run a detection on Detect (mocked `/detect`) so that the count shows "2". Go to History, then back to Detect: the result, the boxes and the count are still shown, with no new `/detect` call. Also: start a detection with a deferred `/detect`, switch to History, resolve it, switch back → its result is shown.
- **M4-api-06 [OQ-7]:** `getHistory` maps `"2026-10-02T12:00:00.123456Z"` to a `Date` whose `toISOString()` is `"2026-10-02T12:00:00.123Z"`. A timestamp without a fraction (`"…T12:00:00Z"`) also parses.

