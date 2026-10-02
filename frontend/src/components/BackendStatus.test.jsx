import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BackendStatus from "./BackendStatus.jsx";
import { checkHealth } from "../api/client.js";
import { deferred, flush, jsonResponse, mockFetch } from "../test/helpers.js";

vi.mock("../api/client.js", async (orig) => ({ ...(await orig()), checkHealth: vi.fn() }));

const card = () => screen.getByTestId("backend-status");
const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

let realCheckHealth;

beforeEach(async () => {
  realCheckHealth = (await vi.importActual("../api/client.js")).checkHealth;
  checkHealth.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BackendStatus", () => {
  it("M3b-status-01: shows the checking state before the first check answers", () => {
    checkHealth.mockReturnValue(new Promise(() => {}));
    render(<BackendStatus />);

    expect(card()).toHaveTextContent("Checking backend…");
    expect(card()).toHaveTextContent("Contacting the detection server");
    expect(card().textContent).not.toMatch(/online|offline/i);
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it("M3b-status-02: a successful check shows the online state", async () => {
    checkHealth.mockReturnValue(Promise.resolve(true));
    render(<BackendStatus />);
    await act(flush);

    expect(card()).toHaveTextContent("Backend online");
    expect(card()).toHaveTextContent("Ready to detect");
    expect(card()).not.toHaveTextContent("Checking backend");
  });

  // OQ-3 (app change agreed, not made yet): the hint names the API base URL.
  it("M3b-status-03a: a failed check shows offline with the API address [OQ-3]", async () => {
    checkHealth.mockReturnValue(Promise.resolve(false));
    render(<BackendStatus />);
    await act(flush);

    expect(card()).toHaveTextContent("Backend offline");
    expect(card()).toHaveTextContent("Can't reach http://localhost:8000");
  });

  // OQ-3 (app change agreed, not made yet): the hint names the API base URL.
  it("M3b-status-03b: an unreachable backend through real fetch shows offline [OQ-3]", async () => {
    checkHealth.mockImplementation(realCheckHealth);
    mockFetch({
      health: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    render(<BackendStatus />);
    await act(flush);

    expect(card()).toHaveTextContent("Backend offline");
    expect(card()).toHaveTextContent("Can't reach http://localhost:8000");
  });

  it("M3b-status-04: re-checks every 30 s and not before", async () => {
    vi.useFakeTimers();
    checkHealth.mockImplementation(() => Promise.resolve(true));
    render(<BackendStatus />);
    await advance(0);
    expect(checkHealth).toHaveBeenCalledTimes(1);

    await advance(29_999);
    expect(checkHealth).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(checkHealth).toHaveBeenCalledTimes(3);
    await advance(90_000);
    expect(checkHealth).toHaveBeenCalledTimes(6);
  });

  it("M3b-status-05: each poll replaces the state without passing through checking", async () => {
    vi.useFakeTimers();
    const second = deferred();
    const third = deferred();
    checkHealth
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    render(<BackendStatus />);
    await advance(0);
    expect(card()).toHaveTextContent("Backend online");

    await advance(30_000);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    expect(card()).toHaveTextContent("Backend online");
    expect(card()).not.toHaveTextContent("Checking backend…");
    await act(async () => second.resolve(false));
    expect(card()).toHaveTextContent("Backend offline");

    await advance(30_000);
    expect(checkHealth).toHaveBeenCalledTimes(3);
    expect(card()).toHaveTextContent("Backend offline");
    expect(card()).not.toHaveTextContent("Checking backend…");
    await act(async () => third.resolve(true));
    expect(card()).toHaveTextContent("Backend online");
  });

  it("M3b-status-06: unmounting stops polling", async () => {
    vi.useFakeTimers();
    checkHealth.mockImplementation(() => Promise.resolve(true));
    const { unmount } = render(<BackendStatus />);
    await advance(0);
    unmount();
    const callsAtUnmount = checkHealth.mock.calls.length;

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checkHealth).toHaveBeenCalledTimes(callsAtUnmount);
  });

  it.each([true, false])(
    "M3b-status-07: a check resolving %s after unmount settles silently",
    async (answer) => {
      const pending = deferred();
      checkHealth.mockReturnValue(pending.promise);
      const consoleError = vi.spyOn(console, "error");
      const { unmount } = render(<BackendStatus />);

      unmount();
      pending.resolve(answer);
      await flush();

      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  // OQ-2 (app change agreed, not made yet): a hung check is aborted after 5 s → offline.
  it("M3b-status-09: a hung check is aborted after 5 s and shows offline [OQ-2]", async () => {
    vi.useFakeTimers();
    checkHealth.mockImplementation(realCheckHealth);
    const signals = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn((_url, options = {}) => {
      signals.push(options.signal);
      if (signals.length === 1) return Promise.resolve(jsonResponse({ status: "ok" }));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          inFlight -= 1;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BackendStatus />);
    await advance(0);
    expect(card()).toHaveTextContent("Backend online");
    expect(signals[0]).toBeInstanceOf(AbortSignal);

    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(4_999);
    expect(card()).toHaveTextContent("Backend online");
    await advance(1);
    expect(card()).toHaveTextContent("Backend offline");
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[1].aborted).toBe(true);

    // Later polls hang too; each is aborted before the next starts.
    await advance(60_000);
    expect(maxInFlight).toBe(1);
  });
});
