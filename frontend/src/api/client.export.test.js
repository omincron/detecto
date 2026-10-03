import { afterEach, describe, expect, it, vi } from "vitest";
import {
  API_BASE_URL,
  ApiError,
  checkHealth,
  clearHistory,
  detectPeople,
  exportHistory,
  getHistory,
} from "./client.js";
import { csvResponse, jpegFile, jsonResponse, pinTimeZone } from "../test/helpers.js";

/** Stub fetch with `impl` (called fresh for every request, so bodies aren't reused). */
function stubFetch(impl) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const CALLS = [
  ["detectPeople", () => detectPeople(jpegFile())],
  ["getHistory", () => getHistory()],
  ["clearHistory", () => clearHistory()],
  ["exportHistory", () => exportHistory()],
];

const CANT_REACH = `Can't reach the detection server at ${API_BASE_URL}. Is the backend running?`;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("client.js refactor regressions", () => {
  it.each(CALLS)("M6-api-reg-01: %s turns an unreachable backend into the can't-reach ApiError", async (_name, call) => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    const error = await call().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(CANT_REACH);
    expect(error.status).toBeNull();
  });

  it.each(CALLS)("M6-api-reg-02: %s rejects with a string detail and the status", async (_name, call) => {
    stubFetch(async () => jsonResponse({ detail: "Invalid start_date: 'x'" }, 400));

    const error = await call().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Invalid start_date: 'x'");
    expect(error.status).toBe(400);
  });

  it.each(CALLS)("M6-api-reg-03: %s falls back to 'Request failed (HTTP n)'", async (_name, call) => {
    stubFetch(async () => new Response("<html>Bad gateway</html>", { status: 502 }));
    let error = await call().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Request failed (HTTP 502)");
    expect(error.status).toBe(502);

    stubFetch(async () => jsonResponse({ detail: [{ msg: "x" }] }, 400));
    error = await call().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Request failed (HTTP 400)");
    expect(error.status).toBe(400);
  });

  it.each(CALLS.slice(0, 3))("M6-api-reg-04: %s rejects an OK non-JSON body as unreadable", async (_name, call) => {
    stubFetch(async () => new Response("not json", { status: 200 }));

    const error = await call().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("The server sent an unreadable response");
    expect(error.status).toBe(200);
  });

  it("M6-api-reg-04: getHistory rejects a JSON body that isn't an array", async () => {
    stubFetch(async () => jsonResponse({}));

    const error = await getHistory().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("The server sent an unreadable response");
  });

  it("M6-api-reg-05: getHistory builds the same URLs, without tz", async () => {
    const fetchMock = stubFetch(async () => jsonResponse([]));

    await getHistory();
    await getHistory({ start_date: "2026-10-02T06:00:00.000Z", end_date: "", min_confidence: null });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      `${API_BASE_URL}/history`,
      `${API_BASE_URL}/history?start_date=2026-10-02T06%3A00%3A00.000Z`,
    ]);
    for (const url of urls) expect(url).not.toContain("tz");
  });

  it("M6-api-reg-06: checkHealth times out a hung backend at 5 s and leaves no timer", async () => {
    vi.useFakeTimers();
    let signal;
    stubFetch(
      (_url, options = {}) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    let settled = null;
    checkHealth().then((value) => (settled = { value }));

    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual({ value: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["a rejected fetch", () => Promise.reject(new TypeError("Failed to fetch")), false],
    ["500 JSON", async () => jsonResponse({ detail: "x" }, 500), false],
    ["200 not json", async () => new Response("not json", { status: 200 }), false],
    ["{status: ok}", async () => jsonResponse({ status: "ok" }), true],
    ["{status: down}", async () => jsonResponse({ status: "down" }), false],
  ])("M6-api-reg-06: checkHealth with %s resolves %s", async (_label, impl, expected) => {
    stubFetch(impl);
    await expect(checkHealth()).resolves.toBe(expected);
  });
});

describe("exportHistory", () => {
  it("M6-api-exp-02: filter params pass through; null and empty ones are dropped", async () => {
    const fetchMock = stubFetch(async () => csvResponse());

    await exportHistory(
      { start_date: "2026-10-02T06:00:00.000Z", end_date: "", min_confidence: "0.5" },
      { timeZone: "Europe/Athens" },
    );

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/history/export");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      start_date: "2026-10-02T06:00:00.000Z",
      min_confidence: "0.5",
      tz: "Europe/Athens",
    });
    expect(url.searchParams.has("end_date")).toBe(false);
  });

  it("M6-api-exp-04: resolves to the exact CSV bytes and the server's filename", async () => {
    const body = "id,timestamp_utc\r\n1,2026-10-02T09:00:00.000Z\r\n";
    stubFetch(async () => csvResponse(body, "detecto-history-20261003-120000.csv"));

    const { blob, filename } = await exportHistory({}, { timeZone: "UTC" });

    expect(filename).toBe("detecto-history-20261003-120000.csv");
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe(body);
  });

  it.each([
    ["no header", {}],
    ["attachment", { "content-disposition": "attachment" }],
    ['filename=""', { "content-disposition": 'attachment; filename=""' }],
  ])("M6-api-exp-05: with %s the filename falls back to detecto-history.csv", async (_label, headers) => {
    stubFetch(async () => new Response("id\r\n", { status: 200, headers: { "content-type": "text/csv", ...headers } }));

    const { blob, filename } = await exportHistory({}, { timeZone: "UTC" });

    expect(filename).toBe("detecto-history.csv");
    expect(blob).toBeInstanceOf(Blob);
  });

  it("M6-api-exp-06: errors reject with an ApiError and no blob", async () => {
    const detail = "Unknown time zone: 'Mars/Base' (expected e.g. Europe/Athens)";
    stubFetch(async () => jsonResponse({ detail }, 400));
    let error = await exportHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(detail);
    expect(error.status).toBe(400);

    stubFetch(async () => new Response("oops", { status: 500 }));
    error = await exportHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Request failed (HTTP 500)");
    expect(error.status).toBe(500);

    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    error = await exportHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe(CANT_REACH);
    expect(error.status).toBeNull();
  });
});

describe("exportHistory at Asia/Riyadh", () => {
  const m = pinTimeZone("Asia/Riyadh", async () => await import("./client.js"));

  it("M6-api-exp-01: one GET to /history/export with the browser zone as tz", async () => {
    const fetchMock = stubFetch(async () => csvResponse());

    await m.exportHistory();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`${m.API_BASE_URL}/history/export?tz=Asia%2FRiyadh`);
    expect(options?.method ?? "GET").toBe("GET");
  });

  it("M6-api-exp-03: an explicit timeZone wins; empty or null leaves tz out; params can't override", async () => {
    const fetchMock = stubFetch(async () => csvResponse());

    await m.exportHistory({}, { timeZone: "UTC" });
    await m.exportHistory({}, { timeZone: "" });
    await m.exportHistory({}, { timeZone: null });
    await m.exportHistory({ tz: "Mars/Base" });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(new URL(urls[0]).searchParams.get("tz")).toBe("UTC");
    expect(urls[1]).toBe(`${m.API_BASE_URL}/history/export`);
    expect(urls[2]).toBe(`${m.API_BASE_URL}/history/export`);
    expect(urls[3]).toBe(`${m.API_BASE_URL}/history/export?tz=Asia%2FRiyadh`);
  });
});
