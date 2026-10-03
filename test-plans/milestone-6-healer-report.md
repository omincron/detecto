# Healer report — Milestone 6
Final result: backend 386 passed, 1 failed, 1 skipped (`test_live_health`: no server on :8000, expected). Frontend 308 passed, 0 failed. No files were changed.

## Needs human review (C)
- **M6-cors-02 `backend/tests/test_history_export.py::test_cors_unknown_origin_denied`**
  - **What fails:** the test sends `GET /history/export` with `Origin: http://evil.example`. `access-control-allow-origin` is absent, as expected. The response still has `access-control-expose-headers: Content-Disposition` and `access-control-allow-credentials: true`, and the test asserts the expose header is absent.
  - **Cause:** Starlette's `CORSMiddleware.send` puts its fixed `simple_headers` (allow-credentials, expose-headers) on every response to a request that has an `Origin` header. Only `allow-origin` depends on the allow-list. `/health` behaves the same way, and has done since M1 for allow-credentials. The config is in `backend/main.py:37-45`.
  - **What the spec says:** ARCHITECTURE.md §3.5 says only that CORS is limited to `CORS_ORIGINS`. §3.3 says CORS exposes `Content-Disposition` so the frontend can read the filename. The case also cites M1-cors-02, which checks only for a missing `access-control-allow-origin`, as does the existing `test_cors.py`. No source says other CORS headers must be missing for an unknown origin. So the parenthetical "(and no `access-control-expose-headers`)" is not backed by the case's sources.
  - **Why the extra headers don't matter for security:** under the Fetch standard, the browser's CORS check fails when `Access-Control-Allow-Origin` is missing, and it ignores the other `Access-Control-*` headers. The unknown origin can't read the response or the exposed header. The test's first assertion already checks the part that matters.
  - **Not class A:** the test asserts exactly what the plan says, and editing the plan is not allowed.
  - **Not class B:** no source requires this, and a fix would mean a custom middleware or a Starlette subclass that strips `simple_headers` for unknown origins. That changes CORS behavior on every endpoint, not just this test's.
  - **Options:**
    - (a) Amend M6-cors-02 to drop the expose-headers clause, then remove line 483 of the test. The allow-origin assertion stays.
    - (b) Write down a decision that unknown origins must get no `Access-Control-*` headers, then add a small wrapper around `CORSMiddleware` in `backend/main.py` that only adds `simple_headers` when the origin is allowed. Add a matching check to `test_cors.py`.
  - **Recommendation:** (a). The extra headers grant nothing, and (b) adds custom security code to fix a header the browser ignores.

## Fixed — test bugs (A)
None.

## Fixed — app bugs (B)
None.

## Resolution (2026-10-03)
The user chose option (a): M6-cors-02 now asserts only that `access-control-allow-origin`
is absent; the plan case has a note. No app change.
