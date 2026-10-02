import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryView from "./HistoryView.jsx";
import {
  callsTo,
  deferred,
  flush,
  inOrder,
  jsonResponse,
  many,
  mockFetch,
  muteFocusTrapWarning,
  R4,
} from "../test/helpers.js";

const RANGE_ERROR = "“From” must be before “To”.";
const totals = () => screen.queryByLabelText("Totals");
const kpi = (label) => within(totals()).getByText(label).nextElementSibling;
const slider = () => screen.getByRole("slider", { name: "Minimum confidence" });
const form = () => screen.getByRole("form", { name: "Filters" });
const recordsTable = () => screen.queryByRole("region", { name: "Records" });
const historyUrls = (fetchMock) => callsTo(fetchMock, "/history").map(([url]) => String(url));
const lastHistoryUrl = (fetchMock) => new URL(historyUrls(fetchMock).at(-1));

/** Move the slider with the keyboard to `pct` (a multiple of 5). */
async function setSlider(user, pct) {
  slider().focus();
  await user.keyboard("{Home}");
  for (let v = 0; v < pct; v += 5) await user.keyboard("{ArrowRight}");
}

/** Pin the calendar's current month to Oct 2026 (only Date is faked). */
function pinToday() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
}

async function pickDay(user, label, day) {
  const input = screen.getByLabelText(label);
  await user.click(input);
  const dayButton = await waitFor(() => {
    const dropdown = document.getElementById(input.getAttribute("aria-controls"));
    const found = [...(dropdown?.querySelectorAll(".mantine-DateTimePicker-day") ?? [])].find(
      (el) => !el.hasAttribute("data-outside") && el.textContent === String(day),
    );
    expect(found).toBeDefined();
    return found;
  });
  await user.click(dayButton);
}

async function renderLoaded(props = {}) {
  const utils = render(<HistoryView {...props} />);
  await act(flush);
  return utils;
}

beforeEach(() => {
  muteFocusTrapWarning();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HistoryView", () => {
  it("M4-view-01: one unfiltered request on mount, with a loading status until it resolves", async () => {
    const pending = deferred();
    const fetchMock = mockFetch({ history: () => pending.promise });
    render(<HistoryView />);
    await act(flush);

    expect(screen.getByRole("status")).toHaveTextContent("Loading history…");
    expect(totals()).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(historyUrls(fetchMock)).toHaveLength(1);
    expect(historyUrls(fetchMock)[0]).not.toContain("?");

    await act(async () => {
      pending.resolve(jsonResponse(R4));
      await flush();
    });

    expect(screen.queryByRole("status")).toBeNull();
    expect(totals()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "People over time" })).toBeInTheDocument();
    expect(within(recordsTable()).getByRole("table")).toBeInTheDocument();
  });

  it("M4-view-02: KPIs for the records returned, each dd right after its dt", async () => {
    mockFetch({ history: () => jsonResponse(R4) });
    await renderLoaded();

    const terms = [...totals().querySelectorAll("dt")];
    expect(terms.map((dt) => [dt.textContent, dt.nextElementSibling.tagName, dt.nextElementSibling.textContent])).toEqual([
      ["Detections", "DD", "4"],
      ["Avg people per frame", "DD", "2.0"],
      ["Peak count", "DD", "5"],
      ["Avg model time", "DD", "250 ms"],
    ]);
  });

  it("M4-view-04: filter edits are a draft; Apply sends one request with the drafted params", async () => {
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse(R4),
        () => jsonResponse([R4[2]]),
      ),
    });
    const user = userEvent.setup();
    await renderLoaded();

    slider().focus();
    await user.keyboard("{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(slider()).toHaveAttribute("aria-valuenow", "85");
    expect(historyUrls(fetchMock)).toHaveLength(1);
    expect(kpi("Detections")).toHaveTextContent("4");

    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);

    expect(historyUrls(fetchMock)).toHaveLength(2);
    const url = lastHistoryUrl(fetchMock);
    expect(url.searchParams.get("min_confidence")).toBe("0.85");
    expect(url.searchParams.has("start_date")).toBe(false);
    expect(url.searchParams.has("end_date")).toBe(false);
    expect(kpi("Detections")).toHaveTextContent("1");
  });

  it("M4-view-06: Reset clears the draft and re-queries with no params", async () => {
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse(R4),
        () => jsonResponse([R4[2]]),
        () => jsonResponse(R4),
      ),
    });
    const user = userEvent.setup();
    await renderLoaded();
    await setSlider(user, 85);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);
    expect(historyUrls(fetchMock)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await act(flush);

    expect(historyUrls(fetchMock)).toHaveLength(3);
    expect(historyUrls(fetchMock)[2]).not.toContain("?");
    expect(slider()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Any")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveTextContent("Any time");
    expect(screen.getByLabelText("To")).toHaveTextContent("Now");
    expect(kpi("Detections")).toHaveTextContent("4");
  });

  it("M4-view-07: an inverted range on the page blocks the request", async () => {
    pinToday();
    const fetchMock = mockFetch({ history: () => jsonResponse(R4) });
    const user = userEvent.setup();
    await renderLoaded();

    await pickDay(user, "From", 5);
    await pickDay(user, "To", 3);

    expect(screen.getByText(RANGE_ERROR)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.submit(form());
    await act(flush);
    expect(historyUrls(fetchMock)).toHaveLength(1);
  });

  describe("M4-view-08: latest request wins", () => {
    /** Mount with R4, then submit 50% (A) and 85% (B), both pending. */
    async function race() {
      const a = deferred();
      const b = deferred();
      const fetchMock = mockFetch({
        history: inOrder(() => jsonResponse(R4), a.promise, b.promise),
      });
      const user = userEvent.setup();
      await renderLoaded();
      await setSlider(user, 50);
      fireEvent.submit(form());
      await setSlider(user, 85);
      fireEvent.submit(form());
      await act(flush);
      expect(historyUrls(fetchMock)).toHaveLength(3);
      return { a, b };
    }

    const settle = (fn) =>
      act(async () => {
        fn();
        await flush();
      });

    it("M4-view-08 row 1: B resolves, then A → B's result stays", async () => {
      const { a, b } = await race();
      await settle(() => b.resolve(jsonResponse([R4[2]])));
      await settle(() => a.resolve(jsonResponse(many(20))));
      expect(kpi("Detections")).toHaveTextContent("1");
      await act(flush);
      expect(kpi("Detections")).toHaveTextContent("1");
    });

    it("M4-view-08 row 2: A resolves, then B → ends at B's result", async () => {
      const { a, b } = await race();
      await settle(() => a.resolve(jsonResponse(many(20))));
      await settle(() => b.resolve(jsonResponse([R4[2]])));
      expect(kpi("Detections")).toHaveTextContent("1");
    });

    it("M4-view-08 row 3: B resolves, then A fails → no error shown", async () => {
      const { a, b } = await race();
      await settle(() => b.resolve(jsonResponse([R4[2]])));
      await settle(() => a.resolve(jsonResponse({ detail: "stale" }, 400)));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(kpi("Detections")).toHaveTextContent("1");
    });

    it("M4-view-08 row 4: B returns [] after A returns data → the filtered empty state", async () => {
      const { a, b } = await race();
      await settle(() => a.resolve(jsonResponse(many(20))));
      await settle(() => b.resolve(jsonResponse([])));
      expect(screen.getByText("No detections match these filters.")).toBeInTheDocument();
    });
  });

  it("M4-view-09: a failed query shows the backend's message, hides stale figures, and recovers", async () => {
    mockFetch({
      history: inOrder(
        () => jsonResponse({ detail: "min_confidence must be between 0 and 1" }, 400),
        () => jsonResponse(R4),
      ),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the history.");
    expect(alert).toHaveTextContent("min_confidence must be between 0 and 1");
    expect(totals()).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeEnabled();

    await user.click(apply);
    await act(flush);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(kpi("Detections")).toHaveTextContent("4");
  });

  it("M4-view-09 row 2: a fetch rejection shows the can't-reach message", async () => {
    mockFetch({
      history: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderLoaded();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Can't reach the detection server at http://localhost:8000. Is the backend running?",
    );
  });

  it("M4-view-10: no records and no filters → 'No detections yet' with Go to Detect", async () => {
    mockFetch({ history: () => jsonResponse([]) });
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    await renderLoaded({ onNavigate });

    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    expect(screen.getByText("Every successful detection is recorded here.")).toBeInTheDocument();
    expect(totals()).toBeNull();
    expect(screen.queryByRole("region", { name: "People over time" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Go to Detect" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("detect");
  });

  it("M4-view-11: no records under filters → 'No detections match' with Reset filters", async () => {
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse(R4),
        () => jsonResponse([]),
        () => jsonResponse(R4),
      ),
    });
    const user = userEvent.setup();
    await renderLoaded();
    await setSlider(user, 85);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);

    expect(screen.getByText("No detections match these filters.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to Detect" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await act(flush);

    expect(historyUrls(fetchMock)).toHaveLength(3);
    expect(historyUrls(fetchMock)[2]).not.toContain("?");
    expect(slider()).toHaveAttribute("aria-valuenow", "0");
    expect(kpi("Detections")).toHaveTextContent("4");
  });

  it("M4-table-05 (page): Apply brings the table back to page 1", async () => {
    mockFetch({ history: () => jsonResponse(many(33)) });
    const user = userEvent.setup();
    await renderLoaded();
    const pageButton = (n) => within(recordsTable()).getByRole("button", { name: String(n) });

    await user.click(pageButton(3));
    expect(pageButton(3)).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);

    expect(pageButton(1)).toHaveAttribute("aria-current", "page");
  });
});
