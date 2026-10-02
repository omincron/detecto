import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHealth } from "./client.js";
import { jsonResponse } from "../test/helpers.js";

function stubFetch(impl) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("checkHealth", () => {
  it("M3b-health-01: GETs <base>/health and resolves true on 200 {status: ok}", async () => {
    const fetchMock = stubFetch(async () => jsonResponse({ status: "ok" }));

    await expect(checkHealth()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options = {}] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/health");
    expect([undefined, "GET"]).toContain(options.method);
    expect(options.body).toBeUndefined();
  });

  it.each([
    ["503 with an ok body", () => jsonResponse({ status: "ok" }, 503)],
    ["500 with a detail", () => jsonResponse({ detail: "x" }, 500)],
    ["404 {}", () => jsonResponse({}, 404)],
    ["502 HTML", () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } })],
  ])("M3b-health-02: %s resolves false", async (_label, response) => {
    stubFetch(async () => response());
    await expect(checkHealth()).resolves.toBe(false);
  });

  it.each([
    ["degraded", () => jsonResponse({ status: "degraded" })],
    ["OK uppercase", () => jsonResponse({ status: "OK" })],
    ["{}", () => jsonResponse({})],
    ["null", () => jsonResponse(null)],
    ["[]", () => jsonResponse([])],
    ["a JSON string", () => jsonResponse("ok")],
    ["not json", () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })],
  ])("M3b-health-03: 200 with body %s resolves false", async (_label, response) => {
    stubFetch(async () => response());
    await expect(checkHealth()).resolves.toBe(false);
  });

  it.each([
    ["rejects with TypeError", () => Promise.reject(new TypeError("Failed to fetch"))],
    [
      "throws synchronously",
      () => {
        throw new Error("boom");
      },
    ],
    ["rejects with AbortError", () => Promise.reject(new DOMException("aborted", "AbortError"))],
  ])("M3b-health-04: fetch that %s resolves false", async (_label, impl) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    await expect(checkHealth()).resolves.toBe(false);
  });

  it("M3b-health-05: the URL follows VITE_API_BASE_URL without a trailing slash", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test:9000/");
    vi.resetModules();
    const client = await import("./client.js");
    const fetchMock = stubFetch(async () => jsonResponse({ status: "ok" }));

    await client.checkHealth();

    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test:9000/health");
  });

  // OQ-2 (app change agreed, not made yet): checkHealth aborts after 5 s and resolves false.
  it("M3b-status-09 (direct): checkHealth resolves false after a 5 s timeout [OQ-2]", async () => {
    vi.useFakeTimers();
    let signal;
    stubFetch(
      (_url, options = {}) =>
        new Promise((_resolve, reject) => {
          signal = options.signal;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    let settled = null;
    checkHealth().then(
      (value) => (settled = { value }),
      (error) => (settled = { error }),
    );

    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual({ value: false });
    expect(signal.aborted).toBe(true);
  });
});
