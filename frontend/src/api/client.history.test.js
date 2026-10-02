import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, clearHistory, getHistory } from "./client.js";
import { callsTo, jsonResponse, mockFetch, raw, R4 } from "../test/helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHistory", () => {
  it("M4-api-01: with no filters, GETs exactly <base>/history", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse([]) });

    await getHistory();
    await getHistory({});

    const calls = callsTo(fetchMock, "/history");
    expect(calls).toHaveLength(2);
    for (const [url, options] of calls) {
      expect(url).toBe("http://localhost:8000/history");
      expect(options?.method ?? "GET").toBe("GET");
    }
  });

  it("M4-api-02: params are URL-encoded; null and empty ones are dropped", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse([]) });

    await getHistory({
      start_date: "2026-10-01T21:00:00.000Z",
      end_date: null,
      min_confidence: "0.85",
      x: "",
    });

    const url = new URL(callsTo(fetchMock, "/history")[0][0]);
    expect(url.searchParams.get("start_date")).toBe("2026-10-01T21:00:00.000Z");
    expect(url.searchParams.get("min_confidence")).toBe("0.85");
    expect(url.searchParams.has("end_date")).toBe(false);
    expect(url.searchParams.has("x")).toBe(false);
  });

  it("M4-api-03: maps records to camelCase with a Date timestamp, order preserved", async () => {
    mockFetch({ history: () => jsonResponse(R4) });

    const records = await getHistory();

    expect(records.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(records[3]).toEqual({
      id: 4,
      timestamp: expect.any(Date),
      count: 1,
      averageConfidence: 0.62,
      inferenceTimeMs: 400,
    });
    expect(records[3].timestamp.getTime()).toBe(Date.UTC(2026, 9, 2, 11, 5, 9, 563));
  });

  it("M4-api-04: every failure becomes an ApiError with a message the page can show", async () => {
    mockFetch({ history: () => jsonResponse({ detail: "start_date must be before end_date" }, 400) });
    let error = await getHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("start_date must be before end_date");
    expect(error.status).toBe(400);

    mockFetch({
      history: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    error = await getHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message.startsWith("Can't reach the detection server at http://localhost:8000")).toBe(true);
    expect(error.status).toBeNull();

    mockFetch({ history: () => jsonResponse({ items: [] }) });
    error = await getHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("The server sent an unreadable response");

    mockFetch({
      history: () =>
        new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } }),
    });
    error = await getHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("Request failed (HTTP 500)");
  });

  it("M4-api-06: microsecond timestamps are trimmed to milliseconds [OQ-7]", async () => {
    // OQ-7 (app change agreed, not made yet): getHistory trims the fraction to 3 digits.
    mockFetch({
      history: () =>
        jsonResponse([
          raw(1, "2026-10-02T12:00:00.123456Z", 1, 0.5, 10),
          raw(2, "2026-10-02T12:00:00Z", 1, 0.5, 10),
        ]),
    });

    const [withFraction, withoutFraction] = await getHistory();

    expect(withFraction.timestamp.toISOString()).toBe("2026-10-02T12:00:00.123Z");
    expect(withoutFraction.timestamp.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });
});

describe("clearHistory", () => {
  it("M4-api-05: one DELETE <base>/reset resolving to count_removed; errors are ApiError", async () => {
    let fetchMock = mockFetch({ reset: () => jsonResponse({ status: "cleared", count_removed: 34 }) });

    expect(await clearHistory()).toBe(34);
    const calls = callsTo(fetchMock, "/reset");
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("http://localhost:8000/reset");
    expect(calls[0][1].method).toBe("DELETE");

    fetchMock = mockFetch({ reset: () => jsonResponse({ detail: "database is locked" }, 500) });
    const error = await clearHistory().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("database is locked");
    expect(error.status).toBe(500);
  });
});
