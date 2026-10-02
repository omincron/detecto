# Test plan — Milestone 3b: Mantine design pass (between M3 and M4)

## Scope

This pass is uncommitted on top of `a80f326`. It rebuilds the frontend in Mantine 9 and adds one new behavior. It added:
- **Mantine and the theme.** `@mantine/core` 9.6.3, `@mantine/hooks`, `@tabler/icons-react`, and IBM Plex Sans/Mono bundled through `@fontsource`. `src/theme.js` defines a neutral base and five 10-shade pastel palettes (periwinkle, mint, lavender, sky, peach). `main.jsx` wraps the app in `MantineProvider` with `forceColorScheme="light"`. `postcss.config.cjs` adds the Mantine preset. The design follows PROGRESS.md "Design direction" and the agreed mockup.
- **App shell (`App.jsx`).** A Mantine `AppShell` with:
  - a sidebar holding the wordmark `<h1>` "Detecto", the tagline "People detection", `<nav aria-label="Pages">` with NavLink buttons Detect and History (using `aria-current="page"`), and `BackendStatus` at the bottom;
  - a header that only shows below the `sm` breakpoint (48em). It has a Burger (`aria-label="Toggle navigation"`) that opens the sidebar on mobile. Choosing a page closes it.
- **`components/BackendStatus.jsx`.** A sidebar card (`data-testid="backend-status"`, `aria-live="polite"`). It calls `checkHealth()` on mount and then every 30 s, and shows one of three states:
  - "Checking backend…" / "Contacting the detection server"
  - "Backend online" / "Ready to detect"
  - "Backend offline" / "Start the API on port 8000"
- **`api/client.js` → `checkHealth()`.** GETs `<base>/health` through the shared `request()` and resolves `true` only for a successful `{"status": "ok"}`. It never throws.
- **Browser-side upload pre-check (user decision, PROGRESS.md "Browser-side upload pre-check").**
  - `src/config.js` reads `VITE_MAX_UPLOAD_MB` (`frontend/.env`, default 10) and exports `MAX_UPLOAD_MB` and `MAX_UPLOAD_BYTES`.
  - `utils/validateUpload.js` → `validateUpload(file, maxBytes)` returns a message or `null`. It rejects empty files, files over the limit, and a declared type other than JPEG/PNG. An empty type is let through.
  - `DetectionView` runs it before any upload and shows the message in the same alert. There is no fetch and no preview.
  - The dropzone hint "JPEG or PNG, up to N MB" now comes from the same setting, which closes M3 OQ-5.
- **Restyled components** (`ImageUploader`, `DetectionSummary`, `DetectionView`, `HistoryView`, `index.css`). These test-facing contracts were kept on purpose:
  - button names;
  - the `dropzone`, `file-input`, `bounding-box`, `person-count` and `backend-status` test ids;
  - the `alert` and `status` roles;
  - the "Show bounding boxes" checkbox;
  - the classes `dropzone--active`, `dropzone--disabled`, `overlay__box--highlighted` and `is-highlighted`.

  Box labels now sit inside the box's top-left corner (CSS only). New page headings: `<h2>` "Detect people" and "Detection history".
- **Test infrastructure (`src/test/setup.js`).** It polyfills `matchMedia` and `ResizeObserver`, and wraps every Testing Library `render` in the app's `MantineProvider`.

**In scope:**
- unit tests for `validateUpload`, `config.js`, `checkHealth` and `theme.js`;
- component tests for `BackendStatus`, the pre-check in `DetectionView`, its interplay with latest-request-wins, the config-driven hint, and the shell's navigation and accessibility;
- a backend CORS check on `GET /health`, and one live e2e probe;
- manual browser checks for the visual design, responsiveness, fonts, contrast and box-label placement.

**Out of scope:**
- M4 (History table, chart, filters, Clear history dialog) and M5 (10 samples, README);
- pixel-exact visual regression (no screenshot tool is installed, so comparison with the mockup is manual);
- the 5 currently failing M3 tests. They are listed under Regression for the test-healer and are not diagnosed here.

**Conventions for the generator** (in addition to those in `milestone-3.md`):
- **`mockFetch` needs a `/health` route.** `App` now calls `<base>/health` on mount. Add an option `health` (a function returning a Response or a promise of one) that defaults to `jsonResponse({status: "ok"})`. Today an unrouted `/health` throws inside the mock, and `checkHealth` quietly turns that into "offline". Route by `path.endsWith("/health")`.
- **Polling tests** use `vi.useFakeTimers()` and advance with `await act(() => vi.advanceTimersByTimeAsync(ms))`. Run `vi.useRealTimers()` in `afterEach`. Where a test controls the result directly, mock the client with `vi.mock("../api/client.js", async (orig) => ({...(await orig()), checkHealth: vi.fn()}))`.
- **Env-dependent modules** (`config.js`, `ImageUploader`, `DetectionView`, `client.js`): call `vi.stubEnv("VITE_MAX_UPLOAD_MB", …)` or `vi.stubEnv("VITE_API_BASE_URL", …)`, then `vi.resetModules()` and a dynamic `import()`. Run `vi.unstubAllEnvs()` afterwards. The test run loads `frontend/.env`, so the default value seen in tests is `"10"`.
- **Large files:** `validateUpload` only reads `file.size` and `file.type`, so unit cases may pass plain objects `{size, type}`. For view cases, use a real `File` and override its size with `Object.defineProperty(file, "size", {value: N})`. That way the test doesn't allocate 10 MiB, and the object that reaches `FormData` is still the same `File`.
- **Constants:** `MiB = 1048576`, and `LIMIT = 10 * MiB = 10485760`, the backend's `MAX_UPLOAD_BYTES`.
- **Unsupported types through the picker** need `userEvent.setup({ applyAccept: false })` or `fireEvent.change`, as in M3.
- All open questions were resolved by the user on 2026-10-02 (see "Resolved decisions" at the end). Cases tagged **[OQ-n]** encode those decisions, and some need app changes that haven't been made yet (OQ-1, OQ-2, OQ-3, OQ-4), so those tests are expected to fail until the app is fixed. Do not skip them or mark them xfail. Add a comment naming the OQ.

## Test cases

### utils/validateUpload.js (unit)

- **ID** M3b-valid-01
- **Behavior:** A non-empty JPEG or PNG within the limit passes, and the function returns exactly `null`.
- **Source:** PROGRESS.md "Browser-side upload pre-check"; instructions.md "Backend" (`/detect` accepts JPEG, PNG); ARCHITECTURE.md §3.3 (declared types `image/jpeg`, `image/jpg`, `image/png`)
- **Setup:** `maxBytes = LIMIT`.
- **Steps → Expected:** `{size: 1, type: "image/jpeg"}`, `{size: 1, type: "image/jpg"}`, `{size: 1, type: "image/png"}` and `{size: 5000, type: "image/png"}` each return `null`, checked with `toBeNull()`, not just falsy. A real `File([JPEG_BYTES], "a.jpg", {type: "image/jpeg"})` also returns `null`.
- **Type:** unit

- **ID** M3b-valid-02
- **Behavior:** An empty file is rejected, whatever its declared type.
- **Source:** PROGRESS.md "Browser-side upload pre-check" ("reject empty files"); instructions.md "Backend" ("Handle errors (… empty uploads …)")
- **Setup:** `maxBytes = LIMIT`.
- **Steps → Expected:** `{size: 0, type: "image/jpeg"}` → `"This file is empty."`. `{size: 0, type: ""}` and `{size: 0, type: "text/plain"}` → a non-empty string, without asserting which rule fires first.
- **Type:** unit

- **ID** M3b-valid-03
- **Behavior:** The size limit is inclusive: exactly `maxBytes` passes, and `maxBytes + 1` is rejected with a message stating the limit in MB.
- **Source:** PROGRESS.md "Browser-side upload pre-check" ("files over the size limit"); ARCHITECTURE.md §3.3 (413 only when *larger than* `MAX_UPLOAD_BYTES`)
- **Setup:** `maxBytes = LIMIT`.
- **Steps → Expected:**
  - `{size: 10485760, type: "image/jpeg"}` → `null`.
  - `{size: 10485761, type: "image/jpeg"}` → `"This file is larger than the 10 MB limit."`.
  - `{size: 10485759, type: "image/png"}` → `null`.
  - `{size: 10485761, type: ""}` → the same size message, because an empty type does not skip the size check.
- **Type:** unit

- **ID** M3b-valid-04
- **Behavior:** The limit is the `maxBytes` argument, not a constant, and the message reflects it.
- **Source:** PROGRESS.md (the limit "comes from one frontend setting")
- **Setup:** `maxBytes = 5 * MiB`. Separately, `maxBytes = 2.5 * MiB`.
- **Steps → Expected:**
  - `{size: 5*MiB, type: "image/png"}` → `null`.
  - `{size: 5*MiB + 1, …}` → `"This file is larger than the 5 MB limit."`.
  - With `2.5 * MiB`, `{size: 2.5*MiB + 1, …}` → `"This file is larger than the 2.5 MB limit."`.
  - A 6 MiB file passes with `maxBytes = LIMIT` and is rejected with `maxBytes = 5 * MiB`.
- **Type:** unit

- **ID** M3b-valid-05
- **Behavior:** The declared-type check ignores case, surrounding whitespace and MIME parameters.
- **Source:** ARCHITECTURE.md §3.3 (declared type "case-insensitive"); PROGRESS.md pre-check
- **Setup:** `size: 1`, `maxBytes = LIMIT`.
- **Steps → Expected:** These types each return `null`:
  - `"IMAGE/JPEG"`, `"Image/Png"` and `"image/JPG"`;
  - `"image/png; charset=binary"`, `"image/jpeg;q=1"` and `"image/png ; x=y"`;
  - `" image/jpeg "`.
- **Type:** unit

- **ID** M3b-valid-06
- **Behavior:** A declared type other than JPEG/PNG is rejected with a message naming the normalized type.
- **Source:** PROGRESS.md pre-check ("a declared type other than JPEG/PNG"); instructions.md "Display clear error messages for invalid or unsupported files"
- **Setup:** `size: 1`, `maxBytes = LIMIT`.
- **Steps → Expected:** `type` → message:
  - `"image/gif"` → `"Only JPEG and PNG images are supported (this file is image/gif)."`
  - `"text/plain"` → `"… (this file is text/plain)."`
  - `"image/webp"` → `"… (this file is image/webp)."`
  - `"image/heic"` → `"… (this file is image/heic)."`
  - `"image/svg+xml"` → `"… (this file is image/svg+xml)."`
  - `"IMAGE/GIF; x=1"` → `"… (this file is image/gif)."`, lowercased with the parameter removed.
  - `"image/jpegx"` and `"image/png2"` → rejected, because there is no prefix match.
- **Type:** unit

- **ID** M3b-valid-07
- **Behavior:** An empty or missing declared type passes, so the backend decides.
- **Source:** PROGRESS.md pre-check; caller's brief ("an empty type passes through to the backend")
- **Setup:** `size: 1`, `maxBytes = LIMIT`.
- **Steps → Expected:** `type: ""` → `null`. An object with no `type` property → `null`. `type: undefined` → `null`. The function never throws on these.
- **Type:** unit

- **ID** M3b-valid-08
- **Behavior:** **[OQ-1]** A declared `application/octet-stream` passes the pre-check, like an empty type, matching the backend, which lets it through to its byte check.
- **Source:** ARCHITECTURE.md §3.3 (octet-stream "let through to the byte check") against PROGRESS.md pre-check ("other than JPEG/PNG")
- **Setup:** `{size: 1, type: "application/octet-stream"}`.
- **Steps → Expected:** `null`. `"APPLICATION/OCTET-STREAM"` → `null`, and `"application/octet-stream; charset=binary"` → `null`. A size problem still wins: `{size: 0, type: "application/octet-stream"}` → the empty-file message.
- **Type:** unit

### src/config.js (unit)

- **ID** M3b-config-01
- **Behavior:** The limit is read from `frontend/.env`, which sets 10 MB, so the byte limit equals the backend default.
- **Source:** PROGRESS.md pre-check (`VITE_MAX_UPLOAD_MB`, default 10); ARCHITECTURE.md §3.5 (`MAX_UPLOAD_BYTES=10485760`)
- **Setup:** Import `config.js` with no env stubs.
- **Steps → Expected:** `MAX_UPLOAD_MB === 10` and `MAX_UPLOAD_BYTES === 10485760`.
- **Type:** unit

- **ID** M3b-config-02
- **Behavior:** A valid positive value, including a fractional one, overrides the default.
- **Source:** PROGRESS.md pre-check
- **Setup:** `vi.stubEnv("VITE_MAX_UPLOAD_MB", v)`, then `resetModules` and a dynamic import.
- **Steps → Expected:** `"5"` → `5` and `5242880`. `"2.5"` → `2.5` and `2621440`. `" 20 "` → `20` and `20971520`.
- **Type:** unit

- **ID** M3b-config-03
- **Behavior:** A missing, empty, zero, negative, non-numeric or infinite value falls back to 10.
- **Source:** PROGRESS.md pre-check ("default 10")
- **Setup:** As M3b-config-02. Parametrize over `undefined` (unstubbed with the env var deleted), `""`, `"0"`, `"-1"`, `"abc"`, `"Infinity"` and `"NaN"`.
- **Steps → Expected:** Each gives `MAX_UPLOAD_MB === 10` and `MAX_UPLOAD_BYTES === 10485760`.
- **Type:** unit

- **ID** M3b-config-04
- **Behavior:** The frontend limit in `frontend/.env` matches the backend's `MAX_UPLOAD_BYTES`.
- **Source:** PROGRESS.md pre-check ("It must match the backend's `MAX_UPLOAD_BYTES`"); `frontend/.env` comment
- **Setup:** A Vitest test reads `frontend/.env` and the root `.env` with `node:fs` and parses `KEY=VALUE` lines, skipping `#` comments. If the root `.env` has no `MAX_UPLOAD_BYTES`, use the backend default `10485760` (`backend/config.py`).
- **Steps → Expected:** `Number(VITE_MAX_UPLOAD_MB) * 1048576 === Number(MAX_UPLOAD_BYTES)`. Today that is `10 * 1048576 === 10485760`.
- **Type:** unit (static config check)

### api/client.js — `checkHealth` (unit, mocked fetch)

- **ID** M3b-health-01
- **Behavior:** `checkHealth` GETs `<base>/health` and resolves `true` when the backend answers 200 `{"status": "ok"}`.
- **Source:** main.py `/health` → `{"status": "ok"}` (M1-health-01); ARCHITECTURE.md §4.3 (client.js is the only place that knows the base URL); caller's brief
- **Setup:** `fetch` → `jsonResponse({status: "ok"})`.
- **Steps → Expected:** It resolves to exactly `true`. `fetch` is called once with URL `"http://localhost:8000/health"`. The options have no `method`, or `method` is `"GET"`, and no `body`.
- **Type:** unit

- **ID** M3b-health-02
- **Behavior:** Any non-2xx answer gives `false`, even with an ok-looking body.
- **Source:** caller's brief ("checkHealth never throwing"); `checkHealth` doc ("offline is a state, not an error")
- **Setup:** Parametrize the `fetch` response: `503 {"status": "ok"}`, `500 {"detail": "x"}`, `404 {}`, and `502` with an HTML body.
- **Steps → Expected:** Each resolves to `false`, without rejecting.
- **Type:** unit

- **ID** M3b-health-03
- **Behavior:** A 200 whose body is not `{"status": "ok"}` gives `false`.
- **Source:** as M3b-health-02
- **Setup:** Parametrize the 200 body: `{"status": "degraded"}`, `{"status": "OK"}`, `{}`, `null`, `[]`, `"ok"` (a JSON string), and `not json` (text).
- **Steps → Expected:** Each resolves to `false`.
- **Type:** unit

- **ID** M3b-health-04
- **Behavior:** Network failures never reject.
- **Source:** as M3b-health-02
- **Setup:** Parametrize `fetch`:
  - it rejects with `TypeError("Failed to fetch")`;
  - it throws synchronously (`vi.fn(() => { throw new Error("boom") })`);
  - it rejects with `new DOMException("aborted", "AbortError")`.
- **Steps → Expected:** `await expect(checkHealth()).resolves.toBe(false)` in every case, with no unhandled rejection reported by Vitest.
- **Type:** unit

- **ID** M3b-health-05
- **Behavior:** The health URL follows `VITE_API_BASE_URL`, with a trailing slash removed.
- **Source:** ARCHITECTURE.md §4.3; M3-api-04
- **Setup:** `vi.stubEnv("VITE_API_BASE_URL", "http://api.test:9000/")`, then `resetModules` and a dynamic import.
- **Steps → Expected:** `fetch` is called with `"http://api.test:9000/health"`.
- **Type:** unit

### components/BackendStatus (component, fake timers)

- **ID** M3b-status-01
- **Behavior:** Before the first check answers, the card shows the checking state.
- **Source:** caller's brief ("shows checking, online or offline")
- **Setup:** `checkHealth` mocked to return a never-resolving promise.
- **Steps → Expected:** `getByTestId("backend-status")` contains `"Checking backend…"` (U+2026) and `"Contacting the detection server"`, and does not contain "online" or "offline". `checkHealth` has been called exactly once.
- **Type:** unit

- **ID** M3b-status-02
- **Behavior:** A successful check shows the online state.
- **Source:** as M3b-status-01
- **Setup:** `checkHealth` → `Promise.resolve(true)`.
- **Steps → Expected:** After flushing, the card contains `"Backend online"` and `"Ready to detect"`, and no longer contains `"Checking backend"`.
- **Type:** unit

- **ID** M3b-status-03
- **Behavior:** A failed check shows the offline state with a hint to start the API.
- **Source:** as M3b-status-01
- **Setup:** `checkHealth` → `Promise.resolve(false)`. Also run the path through real fetch routing: un-mock `checkHealth`, and have the `mockFetch` `health` route throw `TypeError("Failed to fetch")`.
- **Steps → Expected:** In both, the card contains `"Backend offline"` and `"Can't reach http://localhost:8000"`. **[OQ-3]** The address comes from the API base URL (`VITE_API_BASE_URL`, falling back to `http://localhost:8000`), never a hard-coded port.
- **Type:** unit

- **ID** M3b-status-04
- **Behavior:** The card re-checks every 30 s: once on mount, then at each 30 000 ms tick, and not before.
- **Source:** caller's brief ("polls GET /health … every 30 s")
- **Setup:** Fake timers. `checkHealth` → `Promise.resolve(true)`.
- **Steps → Expected:** After mount, 1 call. Advance 29 999 ms → still 1. Advance 1 ms → 2. Advance 30 000 ms → 3. Advance 90 000 ms → 6.
- **Type:** unit

- **ID** M3b-status-05
- **Behavior:** Each poll result replaces the shown state, and the card doesn't fall back to "checking" between polls.
- **Source:** caller's brief
- **Setup:** Fake timers. `checkHealth` resolves `true`, then `false`, then `true` (`mockResolvedValueOnce`).
- **Steps → Expected:** After mount → "Backend online". Advance 30 s → "Backend offline". Advance 30 s → "Backend online". Right after each tick and before its promise settles, the text is the previous state, never "Checking backend…".
- **Type:** unit

- **ID** M3b-status-06
- **Behavior:** Unmounting stops polling.
- **Source:** caller's brief ("cleanup on unmount"); React effect cleanup
- **Setup:** Fake timers. `checkHealth` → `Promise.resolve(true)`. Render, flush, then `unmount()`.
- **Steps → Expected:** `vi.getTimerCount()` is 0 after unmount. Advancing 120 000 ms adds no `checkHealth` calls; the count stays at its value at unmount.
- **Type:** unit

- **ID** M3b-status-07
- **Behavior:** A check still in flight when the card unmounts settles silently, without a state update or a warning.
- **Source:** as M3b-status-06
- **Setup:** `checkHealth` returns a `deferred()`. `vi.spyOn(console, "error")`. Render, then `unmount()`, then `resolve(true)` (and separately `resolve(false)`) and flush.
- **Steps → Expected:** `console.error` is not called, and there is no unhandled rejection.
- **Type:** unit

- **ID** M3b-status-08
- **Behavior:** The card announces changes politely, without taking the `status` or `alert` role. The page's own "Detecting people…" status stays the only `status` region.
- **Source:** WAI-ARIA live regions; M3-view-01 and M3-view-02 (exactly one `status` while loading); BackendStatus code comment
- **Setup:** Render `<App/>` with `mockFetch` (`health` → ok, `/detect` → a deferred).
- **Steps → Expected:** `getByTestId("backend-status")` has `aria-live="polite"` and no `role`. Before any upload, `queryAllByRole("status")` has length 0 and `queryAllByRole("alert")` has length 0. After uploading `zidane.jpg`, `getAllByRole("status")` has length 1, with text containing `"Detecting people…"`.
- **Type:** unit

- **ID** M3b-status-09
- **Behavior:** **[OQ-2]** A health check that gets no answer is aborted after 5 s and shown as offline, so a hung backend never leaves the card on a stale "online".
- **Source:** OQ-2 resolution
- **Setup:** Fake timers. Use the real `checkHealth`, with `fetch` mocked to return a promise that never resolves on its own but rejects with an `AbortError` when its `signal` aborts. First let one check answer `200 {"status":"ok"}` so the card shows "Backend online". Make the next one hang.
- **Steps → Expected:**
  - `fetch` is called with an `AbortSignal` (`options.signal`).
  - Advance to the 30 000 ms poll, then 4 999 ms more → still "Backend online".
  - 1 ms more (5 000 ms after the check started) → "Backend offline". The signal is aborted.
  - Only one request is ever pending at a time: the timeout is shorter than the 30 s interval.
  - `checkHealth` itself resolves to `false` after the timeout and never rejects. Also test it directly, with fake timers.
- **Type:** unit

### Size hint driven by config (component)

- **ID** M3b-hint-01
- **Behavior:** The dropzone hint states the configured limit, which is 10 MB by default.
- **Source:** PROGRESS.md pre-check ("also drives the 'up to N MB' hint (closes M3 OQ-5)")
- **Setup:** Render `ImageUploader` with no env stub.
- **Steps → Expected:** `getByText("JPEG or PNG, up to 10 MB")` is present. This is the same assertion as M3-upl-10, now sourced from config.
- **Type:** unit

- **ID** M3b-hint-02
- **Behavior:** Changing `VITE_MAX_UPLOAD_MB` changes the hint and the rejection threshold together.
- **Source:** PROGRESS.md pre-check ("one frontend setting")
- **Setup:** `vi.stubEnv("VITE_MAX_UPLOAD_MB", "5")`, then `resetModules`. Dynamically import `DetectionView` (which pulls in `ImageUploader` and `config.js`) and render it. `mockFetch` with `/detect` → D2.
- **Steps → Expected:**
  - `getByText("JPEG or PNG, up to 5 MB")` is present, and `"up to 10 MB"` is absent.
  - Picking `big.jpg` (`image/jpeg`, size `5*MiB + 1`) → the alert contains `"This file is larger than the 5 MB limit."`, and there are 0 `/detect` calls.
  - Picking `edge.jpg` (size exactly `5*MiB`) → 1 `/detect` call, with `image.name === "edge.jpg"`.
  - Separately, with `"2.5"`: the hint is `"JPEG or PNG, up to 2.5 MB"`.
- **Type:** unit

### DetectionView — upload pre-check (component, mocked fetch)

- **ID** M3b-pre-01
- **Behavior:** A file with an unsupported declared type is rejected in the browser at once. There is no `/detect` call and no preview, and the reason shows in the page's alert, which names the file.
- **Source:** PROGRESS.md pre-check ("The error shows in the same alert without any upload"); instructions.md "Display clear error messages for invalid or unsupported files"; ARCHITECTURE.md §4.1 (errors inline)
- **Setup:** `userEvent.setup({applyAccept: false})`. Stub object URLs. `mockFetch` with `/detect` → D2, so that any call would be visible. Parametrize: `notes.txt` (`text/plain`), `anim.gif` (`image/gif`), `photo.webp` (`image/webp`) and `IMG_1.HEIC` (`image/heic`), each 1+ bytes.
- **Steps → Expected:** Right after `await user.upload(...)`, with no `findBy` or waiting:
  - `getByRole("alert")` has accessible name `"Couldn't analyse <name>."`, and its text contains `"Only JPEG and PNG images are supported (this file is <type>)."`;
  - `callsTo(fetchMock, "/detect")` has length 0;
  - `URL.createObjectURL` was not called;
  - there is no `img` in the view, no `bounding-box`, no "Detection summary" region and no `status`;
  - "Choose an image" is enabled.
- **Type:** unit

- **ID** M3b-pre-02
- **Behavior:** An empty file is rejected in the browser.
- **Source:** PROGRESS.md pre-check; instructions.md "Backend" (empty uploads)
- **Setup:** As M3b-pre-01. The file is `empty.jpg`, `image/jpeg`, 0 bytes.
- **Steps → Expected:** The alert's name is `"Couldn't analyse empty.jpg."`, and its text contains `"This file is empty."`. There are 0 `/detect` calls and no preview, status or summary.
- **Type:** unit

- **ID** M3b-pre-03
- **Behavior:** At the default 10 MB limit, a file of exactly 10 MiB is uploaded, and a file one byte larger is rejected in the browser.
- **Source:** PROGRESS.md pre-check; ARCHITECTURE.md §3.3 (`MAX_UPLOAD_BYTES` default 10 MiB, 413 above it)
- **Setup:** `mockFetch` with `/detect` → D2. `exact.jpg` has `size` 10485760 and `over.jpg` has 10485761, both `image/jpeg`, with size overridden as in Conventions.
- **Steps → Expected:**
  - Pick `over.jpg` → the alert contains `"This file is larger than the 10 MB limit."`, and there are 0 `/detect` calls.
  - Then pick `exact.jpg` → 1 `/detect` call, whose form `image` is that same `File` object. Then `person-count` is `"2"` and the alert is gone.
- **Type:** unit

- **ID** M3b-pre-04
- **Behavior:** The pre-check applies to every selection path: picker, drag-and-drop and demo samples.
- **Source:** PROGRESS.md pre-check (applies before uploading); ARCHITECTURE.md §4.1 (upload or select a sample)
- **Setup:** `mockFetch`:
  - manifest `[{"file": "anim.gif", "label": "GIF sample"}, {"file": "blank.jpg", "label": "Blank"}]`;
  - `/samples/anim.gif` → 200, `Blob([GIF89a bytes], {type: "image/gif"})`;
  - `/samples/blank.jpg` → 200, `Blob([], {type: "image/jpeg"})`;
  - `/detect` → D2.
- **Steps → Expected:**
  - (a) `fireEvent.drop(dropzone, {dataTransfer: {files: [gifFile]}})` → the alert has the type message, and there are 0 `/detect` calls.
  - (b) Click "GIF sample" → the alert's name is `"Couldn't analyse anim.gif."`, with `"(this file is image/gif)"`. 0 `/detect` calls.
  - (c) Click "Blank" → `"This file is empty."`. 0 `/detect` calls.
  - In all three, the uploader's own `Couldn't load the sample …` text is absent, because these are pre-check rejections and not failed sample loads.
- **Type:** unit

- **ID** M3b-pre-05
- **Behavior:** A file with an empty declared type passes the pre-check, and the backend's verdict is shown.
- **Source:** PROGRESS.md pre-check ("The backend remains the real validator"); caller's brief (empty type passes)
- **Setup:** `new File(["x"], "camera-dump", {type: ""})` (no extension). Parametrize `/detect`:
  - (a) → `415 {"detail": "Unsupported image format: unrecognized. Only JPEG and PNG are accepted"}`;
  - (b) → D2.
- **Steps → Expected:** In both, there is exactly 1 `/detect` call with `image.name === "camera-dump"`, and the loading `status` appears first. (a) → the alert contains `"Couldn't analyse camera-dump."` and the exact detail. (b) → `person-count` is `"2"`.
- **Type:** unit

- **ID** M3b-pre-06
- **Behavior:** Files that pass the pre-check but that the backend rejects still show the backend's message verbatim. This is what remains of M3-view-06.
- **Source:** ARCHITECTURE.md §3.3 (magic bytes are the real format check; errors are displayable `detail`s), §4.3; PROGRESS.md pre-check ("The backend remains the real validator")
- **Setup:** Parametrize the file → `/detect` response:
  - `fake.jpg` (`image/jpeg`, GIF bytes) → `415 "Unsupported image format: GIF. Only JPEG and PNG are accepted"`;
  - `corrupt.png` (`image/png`, 10 random bytes) → `400 "Could not decode image — unsupported or corrupt file"`;
  - `huge.jpg` (`image/jpeg`, 1 byte, simulating a limit mismatch) → `413 "File too large (max 10 MB)"`;
  - `ok.jpg` → `500 "Inference failed: boom"`.
- **Steps → Expected:**
  - There is 1 `/detect` call whose `image` has the same name, size and type as the picked file.
  - `findByRole("alert")` contains `"Couldn't analyse <name>."` and the exact detail.
  - There is no `img`, `bounding-box`, summary or `status`.
- **Type:** unit

- **ID** M3b-pre-07
- **Behavior:** A rejection after a successful result removes the previous image, boxes, summary and hover state, and releases the old preview URL.
- **Source:** ARCHITECTURE.md §4.2 (boxes must belong to the displayed frame); M3-view-09 and M3-view-14 (preview URLs released when replaced)
- **Setup:** Stub `createObjectURL` → `blob:mock/1`, and spy on `revokeObjectURL`. `/detect` → D2. Upload `a.jpg`, wait for `person-count`, and hover list item 1.
- **Steps → Expected:** Pick `notes.txt` (`text/plain`):
  - the alert shows the type message;
  - there are 0 `bounding-box` elements and no `img` in the view;
  - there is no "Detection summary" region and no `person-count`;
  - `revokeObjectURL` was called with `"blob:mock/1"`;
  - `createObjectURL` was called once in total;
  - `/detect` calls total 1.
- **Type:** unit

- **ID** M3b-pre-08
- **Behavior:** After any rejection, a valid image clears the alert and shows its result. This replaces M3-view-08.
- **Source:** ARCHITECTURE.md §4.1; PROGRESS.md pre-check
- **Setup:** Two variants. (a) A pre-check rejection: `notes.txt` (`text/plain`), with `/detect` → D2 for the only call. (b) A backend rejection: `fake.jpg` (`image/jpeg`) → 415, then `zidane.jpg` → D2. Use `inOrder`.
- **Steps → Expected:** After picking `zidane.jpg`, `findByTestId("person-count")` is `"2"`, there are 2 boxes, and `queryByRole("alert")` is null. Total `/detect` calls: (a) 1, (b) 2.
- **Type:** unit

- **ID** M3b-pre-09
- **Behavior:** Consecutive rejections each replace the alert's content, and re-picking the same rejected file rejects it again.
- **Source:** PROGRESS.md pre-check; M3-upl-03 (the same file can be picked again)
- **Setup:** As M3b-pre-01.
- **Steps → Expected:**
  - Pick `anim.gif` → the alert names `anim.gif`.
  - Pick `empty.jpg` (0 bytes) → exactly one `alert`, with name `"Couldn't analyse empty.jpg."`, text `"This file is empty."`, and no mention of `anim.gif` or `image/gif`.
  - Pick `empty.jpg` again → still exactly one alert with the same content.
  - `/detect` calls total 0.
- **Type:** unit

### DetectionView — pre-check and latest-request-wins (component, deferred `/detect`)

- **ID** M3b-race-01
- **Behavior:** Picking a rejected file while a detection is in flight supersedes it. The rejection is shown at once, and the older response is ignored when it arrives.
- **Source:** ARCHITECTURE.md §4.3 ("only the latest response is shown"); PROGRESS.md M3 "Stale responses" and OQ-1 (the uploader stays enabled while loading)
- **Setup:** The first `/detect` (for `a.jpg`) is a `deferred()`. The real `ImageUploader` is used, with `applyAccept: false`.
- **Steps → Expected:**
  - Pick `a.jpg` → a `status` is shown.
  - Pick `notes.txt` → the alert names `notes.txt`, there is no `status`, and there is no `img`.
  - Resolve A with D2 and flush with `await act(...)` → the alert still names `notes.txt`, with no `person-count`, `bounding-box` or `img`.
  - `/detect` calls total 1.
- **Type:** unit

- **ID** M3b-race-02
- **Behavior:** A late error from the superseded request does not replace the pre-check message.
- **Source:** as M3b-race-01; M3-view-11
- **Setup:** As M3b-race-01.
- **Steps → Expected:** Pick `a.jpg`, then `empty.jpg` (0 bytes). Reject A with `500 {"detail": "Inference failed: boom"}`, then flush. Exactly one alert remains, with name `"Couldn't analyse empty.jpg."` and text `"This file is empty."`, and `"Inference failed"` does not appear anywhere.
- **Type:** unit

- **ID** M3b-race-03
- **Behavior:** In the sequence valid → rejected → valid, only the last valid file's result is shown, whatever order the responses arrive in.
- **Source:** as M3b-race-01
- **Setup:**
  - `/detect` for A and for C are separate deferreds.
  - A's result has `count 1`, and C's has `count 3` with 3 detections.
  - `createObjectURL` returns `blob:mock/1` and then `blob:mock/2`.
- **Steps → Expected:**
  - Pick A, then `notes.txt`, then C. Right after C, the alert is gone, a `status` is shown, and the only `img` has `src` `"blob:mock/2"`.
  - Resolve A → no change. Resolve C → `person-count` is `"3"`, with 3 boxes.
  - `createObjectURL` was called twice, with A and C, and never with `notes.txt`. `revokeObjectURL` was called with `"blob:mock/1"`.
  - Reverse order on a fresh render: resolve C, then A → still `"3"`.
- **Type:** unit

### App shell — navigation and accessibility (component)

- **ID** M3b-shell-01
- **Behavior:** The shell exposes one `h1` wordmark, a banner, a labelled page navigation and a main region holding the current page's `h2`.
- **Source:** instructions.md "Frontend" ("Build two main pages"); PROGRESS.md "Design direction" ("the product name is a text wordmark"); M3-app-01
- **Setup:** Render `<App/>` with `mockFetch()` (health ok).
- **Steps → Expected:**
  - `getAllByRole("heading", {level: 1})` has length 1, named `"Detecto"`.
  - `getByRole("banner")` contains the text `"Detecto"` and a button named `"Toggle navigation"`.
  - `getByRole("navigation", {name: "Pages"})` contains exactly 2 buttons, `"Detect"` and `"History"`, both with `type="button"`.
  - `getByRole("main")` contains `getByRole("heading", {level: 2, name: "Detect people"})` and the dropzone.
  - `getByTestId("backend-status")` is outside `main`.
  - **[OQ-4]** `getAllByRole("navigation")` has length 1, and that one is named `"Pages"`. The sidebar container is not a second, unlabelled navigation landmark.
- **Type:** unit

- **ID** M3b-shell-02
- **Behavior:** Exactly one nav item carries `aria-current="page"`, and it follows the selected page.
- **Source:** ARCHITECTURE.md §4.3 (state navigation); M3-app-01 and M3-app-02
- **Setup:** As M3b-shell-01.
- **Steps → Expected:**
  - Initially, Detect has `aria-current="page"` and History has no `aria-current`. `container.querySelectorAll('[aria-current="page"]')` has length 1.
  - Click History → the reverse. The main region's `h2` is `"Detection history"`, the text `"Detection history is coming in the next milestone."` is shown, and there is no dropzone.
  - Click History again → nothing changes, and there is still exactly one `aria-current`.
- **Type:** unit

- **ID** M3b-shell-03
- **Behavior:** Navigation works from the keyboard alone.
- **Source:** WCAG 2.1.1 Keyboard; ARCHITECTURE.md §4.3
- **Setup:** As M3b-shell-01, with `userEvent.setup()`.
- **Steps → Expected:**
  - `user.tab()` repeatedly (at most 10 times) until `document.activeElement` is the History button. That proves it's reachable.
  - `user.keyboard("{Enter}")` → the History page shows and History has `aria-current="page"`.
  - Tab or Shift-Tab to Detect, then `user.keyboard(" ")` → the Detect page shows.
- **Type:** unit

- **ID** M3b-shell-04
- **Behavior:** The mobile burger toggles the sidebar, and choosing a page closes it.
- **Source:** caller's brief ("mobile header with a burger below the sm breakpoint"); App.jsx `closeNav` on navigation
- **Setup:** As M3b-shell-01. **[OQ-4]** Read the open state from the "Toggle navigation" button's `aria-expanded` (`"false"`/`"true"`). Its `aria-controls` names the `id` of an element in the document that contains the "Pages" navigation.
- **Steps → Expected:**
  - Initially closed.
  - Click "Toggle navigation" → open. Click it again → closed. Click it → open.
  - Click History → closed, and the History page shows.
- **Type:** unit

- **ID** M3b-shell-05
- **Behavior:** The status card lives in the shell, so switching pages neither remounts it nor triggers extra health checks.
- **Source:** caller's brief (polls every 30 s); App.jsx (BackendStatus outside the page component)
- **Setup:** `mockFetch()` with `health` → ok.
- **Steps → Expected:**
  - After mount and flush, `callsTo(fetchMock, "/health")` has length 1, and the card says "Backend online".
  - Click History, then Detect, then History. There is still 1 `/health` call, and the card still says "Backend online" without passing through "Checking backend…".
  - No `fetch` URL contains `/history`.
- **Type:** unit

- **ID** M3b-shell-06
- **Behavior:** The app is light mode only, even when the OS prefers dark.
- **Source:** PROGRESS.md "Design direction" ("light mode only")
- **Setup:**
  - Stub `window.matchMedia` so `(prefers-color-scheme: dark)` matches `true`.
  - Add `<div id="root">` to `document.body`.
  - `mockFetch()`, then `vi.resetModules()` and `await import("../main.jsx")` (adjust the path), then flush.
  - Remove the root afterwards.
- **Steps → Expected:** `document.documentElement.getAttribute("data-mantine-color-scheme") === "light"`, and the `#root` contains the `"Detecto"` heading.
- **Type:** unit

- **ID** M3b-shell-07
- **Behavior:** The theme defines the agreed fonts and five valid pastel palettes.
- **Source:** PROGRESS.md "Design direction" (neutral base, pastel accents, IBM Plex Sans/Mono)
- **Setup:** Import `theme` from `src/theme.js`.
- **Steps → Expected:**
  - `theme.fontFamily` starts with `"'IBM Plex Sans'"`, and `theme.fontFamilyMonospace` starts with `"'IBM Plex Mono'"`.
  - `theme.colors` has `periwinkle`, `mint`, `lavender`, `sky` and `peach`, each an array of exactly 10 strings matching `/^#[0-9a-f]{6}$/i`. Mantine requires 10 shades.
  - `theme.primaryColor` is a key of `theme.colors`.
  - `package.json` dependencies include `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (fonts are bundled, not loaded from a CDN), and `index.html` contains no `fonts.googleapis.com` or `fonts.gstatic.com` reference.
- **Type:** unit (static)

### Backend and live probes

- **ID** M3b-cors-01
- **Behavior:** A cross-origin `GET /health` from the dev frontend is allowed, so the browser can read the answer.
- **Source:** ARCHITECTURE.md §3.5 (`CORS_ORIGINS=http://localhost:5173`); BackendStatus depends on reading `/health` from :5173
- **Setup:** `backend/tests/test_cors.py`, with the `client` fixture.
- **Steps → Expected:**
  - `client.get("/health", headers={"Origin": "http://localhost:5173"})` → 200, `{"status": "ok"}`, and `access-control-allow-origin == "http://localhost:5173"`.
  - With `Origin: http://evil.test`, it's 200 but with no `access-control-allow-origin` header, so the browser would treat the backend as offline from that origin.
- **Type:** unit

- **ID** M3b-e2e-01
- **Behavior:** The running backend answers the frontend's health probe cross-origin.
- **Source:** as M3b-cors-01
- **Setup:** Backend on :8000 (already running). Mark this case so it's skipped when :8000 is not listening, e.g. `@pytest.mark.integration` plus a skip if the connection is refused.
- **Steps → Expected:** `GET http://localhost:8000/health` with `Origin: http://localhost:5173` → 200, body `{"status":"ok"}`, and the header `access-control-allow-origin: http://localhost:5173`. This was verified live while planning.
- **Type:** e2e

## Regression

**Frontend baseline:** `npm test` gives **73 passed, 5 failed of 78** (M3-summary-01, M3-view-06 ×3, M3-view-08). After this plan's tests are added, every M3 case not listed below as obsolete must pass.

**M3 cases made obsolete or changed by the pre-check decision:**
- **M3-view-06, `notes.txt`, `anim.gif` and `empty.jpg` rows: obsolete.** M3-view-06 asserted that unsupported files go to the backend unchanged, with "no client-side rejection". The user reversed that for empty files, oversized files and non-JPEG/PNG declared types. These rows are replaced by M3b-pre-01 and M3b-pre-02, which expect 0 `/detect` calls and the pre-check messages. Delete the rows; don't adapt them.
- **M3-view-06, `huge.jpg` and `ok.jpg` rows: still valid but narrowed.** Both files are 1 byte and declared `image/jpeg`, so they pass the pre-check and still reach the mocked backend. The case's behavior text ("sent to the backend unchanged … no client-side rejection") must be narrowed to "files that pass the pre-check". The `huge.jpg` row now only simulates a frontend/backend limit mismatch, because a real oversized file never reaches the backend. M3b-pre-06 supersedes both rows; keep either one.
- **M3-view-08: changed.** Its first pick, `notes.txt`, is now rejected in the browser, so only one `/detect` call happens. The `inOrder` mock then hands the 415 to `zidane.jpg`. M3b-pre-08 replaces it, with both a pre-check variant and a backend variant.
- **M3-upl-10: still valid.** The text is unchanged at the default of 10, but the hint now comes from config. M3b-hint-01 restates it, and M3b-hint-02 covers the override. M3 OQ-5 is closed.
- **M3 manual check 9 (error messages): changed.** The GIF, `.txt`, 0-byte and >10 MB cases are now rejected without any POST. Manual check M7 below replaces it. "Backend stopped" stays as it was.
- **PROGRESS.md M3 decision "Format and size are validated by the backend only": superseded** by the 2026-10-02 pre-check decision. See OQ-5 on updating the docs.

**Failing but unrelated to the pre-check, for the test-healer:**
- **M3-summary-01.** Not diagnosed here. The healer should check it against the "kept contracts" list in Scope.

**Re-check unchanged (M3 cases that the restyle could break):**
- M3-view-01 to M3-view-05, M3-view-07, and M3-view-09 to M3-view-16: roles, test ids, highlight classes, the "Show bounding boxes" checkbox, object-URL release, and latest-request-wins. All now render inside `MantineProvider` via `setup.js`.
- M3-upl-01 to M3-upl-09: `dropzone--active` and `dropzone--disabled`, the sample row, and late sample downloads.
- M3-overlay-01 to M3-overlay-07: the label text `#n · NN%` is unchanged. Only its CSS position moved.
- M3-app-01 and M3-app-02: still valid. The heading "Detecto" is now in the sidebar, and the header's "Detecto" is plain text, not a heading. Note that App now fetches `/health` on mount, so `mockFetch` needs the `health` route (see Conventions). Without it, the test silently runs in the "offline" state.
- M3-api-01 to M3-api-09: `request()` is now shared with `checkHealth`, so the error mapping must be unchanged.
- **Backend baseline: 168 passed** (`backend/.venv/bin/python -m pytest`, about 15 s with integration tests, run during planning). The backend is untouched by this pass, so the 168 must still pass.
- **Build:** `npm run build` succeeds with the new `postcss.config.cjs` (`package.json` has `"type": "module"`, so it must stay `.cjs`), and `dist/` contains the bundled IBM Plex `woff2` files.
- **M3 manual checks 1–8, 10, 11 and 12:** re-run them in the new layout. The overlay now sits inside a padded `Paper` and a `Box pos="relative"`, so alignment (1–6), the 75vh cap (11) and replacing a pending request (12) must be confirmed again. Check 7 changes; see M5 below.

## Manual checks (real browser; jsdom cannot verify layout, fonts or color)

Run them with the backend on :8000 and `npm run dev` on :5173. Compare against the agreed mockup (PROGRESS.md "Design direction", Detect and History pages). Each check has a pass/fail criterion.

1. **Layout against the mockup (≥ 1200 px wide).**
   - A fixed left sidebar about 248 px wide, with, top to bottom: the icon and wordmark "Detecto" with "People detection", the Detect and History nav items with icons, and the backend status card pinned to the bottom.
   - The main area has a light grey ground (`#f6f7f9`) with white bordered cards. The Detect page shows the "Detect people" heading, the dropzone card, and then the image card and summary side by side.
   - No mobile header is visible.
   - **Pass:** every element is present in that order, and the active nav item has the pastel periwinkle fill.
2. **Fonts are bundled.**
   - In the console, `document.fonts.check('600 16px "IBM Plex Sans"')` and `document.fonts.check('500 14px "IBM Plex Mono"')` are both `true`.
   - The computed `font-family` of body text starts with "IBM Plex Sans", and the per-person confidence values use IBM Plex Mono.
   - The Network tab shows `woff2` files served from `localhost:5173` and no requests to `fonts.googleapis.com` or `fonts.gstatic.com`.
3. **Light mode only.** In DevTools, emulate `prefers-color-scheme: dark` and reload. The page stays light, and `<html data-mantine-color-scheme="light">`.
4. **Responsive shell.**
   - At 1000 px: the sidebar is visible and the summary sits beside the image.
   - At 900 px (below `md`, 62em): the summary stacks under the image.
   - At 700 px (below `sm`, 48em): the sidebar is hidden, and a header shows the burger and "Detecto". The burger opens the sidebar. Choosing History switches the page and closes the sidebar.
   - At 360 px: `document.scrollingElement.scrollWidth <= window.innerWidth`, so there's no horizontal scroll.
5. **Box labels inside the top-left corner.**
   - On `zidane.jpg` and `bus.jpg`, every `#n · NN%` label lies inside its box's top-left corner. For each label, its `getBoundingClientRect()` left and top are within 3 px of the box's.
   - A person touching the top edge has a fully visible label.
   - A box touching the right edge of the image doesn't push its label outside the image.
   - In a crowd image with small far-away people, the labels stay legible (12 px) and don't hide the whole person.
   - A highlighted box's label turns peach.
6. **Box alignment in the new layout.** Repeat M3 manual checks 1–6 and 11 (native size, resizing from 1100 to 400 px, a downscaled 4000×3000 image, portrait and panorama, EXIF-rotated, a small 200×150 image, and the 75vh cap). Box edges stay within about 2 px of each person at every width.
7. **Pre-check, live.** Keep the Network tab open, filtered to `detect`. Choose "All files" in the dialog where needed.
   - A `.gif`, a `.txt`, a `.webp`, a 0-byte `.jpg` and an 11 MB `.jpg` each show the peach alert immediately, naming the file and the reason, with **0** POSTs to `/detect`.
   - A JPEG of exactly 10 485 760 bytes and a file named `PHOTO.JPG` each make exactly 1 POST.
   - A JPEG with no extension (empty type) makes 1 POST, and the backend's answer is shown.
   - After each rejection, the next valid image shows its result and the alert is gone.
8. **Backend status, live.**
   - On load, the card turns "Backend online" within about 1 s, and the Network tab shows `GET /health` repeating every 30 s (±1 s).
   - Stop the backend (only for this check, then restart it) → "Backend offline" within 30 s.
   - Restart it → "Backend online" within 30 s.
   - **[OQ-2]** With the backend frozen (`kill -STOP <pid>`), the card shows "Backend offline" within about 35 s (the next poll plus the 5 s timeout). After `kill -CONT` it returns to "Backend online" within 30 s.
   - **[OQ-3]** The offline hint names the configured backend address.
9. **Keyboard and focus.**
   - Tab from the top of the page. The focus order is Detect → History → status (not focusable, skipped) → main content ("Choose an image", the sample buttons, then the "Show bounding boxes" checkbox once a result exists).
   - Every focused control shows a visible focus ring.
   - At 700 px, the burger is reachable and operable with Enter and Space.
10. **Contrast (WCAG AA, 4.5:1 for normal text).** Measure with the DevTools contrast picker:
    - the dropzone hint;
    - "People detection";
    - the status card's hint;
    - the alert title and body (peach light variant);
    - the box label text `#2f3a99` on `#eceefd`;
    - the highlighted label (peach-9 on peach-1);
    - the "Processed at …" caption.

    Every value is at least 4.5.
11. **Touch targets.** At 700 px, the nav items and the burger are at least 44 px tall (measured with `getBoundingClientRect`).
12. **Hover linking and toggle in a crowd** (M3 check 8, restyled). Hovering a list entry highlights its box (peach border) and vice versa within about one frame. The `is-highlighted` entry has a visible periwinkle background. The checkbox hides and shows all boxes.
13. **Clean console.** A full session (load, detect a sample, a rejected file, a backend error, then switching History, Detect, History) logs no React or Mantine warnings or errors in the console.

14. **Result fits the viewport (added after a user-requested height check).** At a desktop window (e.g. 1872×871), with no scrolling:
    - the sidebar starts at y = 0, and `main` has no reserved header space (the burger header exists only below `sm`);
    - for `bus.jpg` (portrait) and `zidane.jpg` (landscape), the image card's bottom is ≤ `innerHeight`, the document doesn't scroll, the aspect ratio is kept, and the overlay hugs the image.
    - In a very short window (inner height about 380px) the image stays at its 320px floor and the page scrolls.
    - At 500px wide, the 56px header is shown and the page title sits below it.

## Resolved decisions (user, 2026-10-02)

"App change" means the code must change, and the tests encode the new behavior.

- **OQ-1 — `application/octet-stream`:** **app change.** The pre-check lets it through, like an empty type, matching the backend's lenient declared-type list. Only declared types that are clearly something else are rejected in the browser. M3b-valid-08.
- **OQ-2 — Health check timeout:** **app change.** `checkHealth` aborts after 5 s (via `AbortController`) and resolves `false`, so the card shows "Backend offline". The 5 s timeout is shorter than the 30 s poll, so checks never overlap and a late answer can't overwrite a newer one. New case M3b-status-09, and manual check 8.
- **OQ-3 — Offline hint:** **app change.** The hint reads "Can't reach <API base URL>", built from the configured base URL, not a hard-coded port. M3b-status-03.
- **OQ-4 — Shell accessibility:** **app change.**
  - The burger button gets `aria-expanded` and `aria-controls`, pointing at the sidebar's `id`.
  - The sidebar container is not a second navigation landmark: render it as `aside`, so "Pages" is the only `navigation`.
  - M3b-shell-01 and M3b-shell-04.
- **OQ-5 — Docs:** **docs change, made before generation.**
  - ARCHITECTURE.md §3.3 documents `GET /health`.
  - §4.1 and §4.3 cover the pre-check, `VITE_MAX_UPLOAD_MB` (must equal `MAX_UPLOAD_BYTES`) and the backend status card.
  - The M3 decision "validated by the backend only" is marked as superseded in PROGRESS.md.
