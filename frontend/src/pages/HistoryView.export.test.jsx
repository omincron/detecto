import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryView from "./HistoryView.jsx";
import ClearHistoryButton from "../components/ClearHistoryButton.jsx";
import { saveBlob } from "../utils/download.js";
import {
  callsTo,
  csvResponse,
  deferred,
  flush,
  inOrder,
  jsonResponse,
  listCalls,
  mockFetch,
  muteFocusTrapWarning,
  pinTimeZone,
  R4,
} from "../test/helpers.js";

vi.mock("../utils/download.js");

const DIALOG = "Clear detection history?";
const FILE = "detecto-history-20261003-120000.csv";
const dialog = () => screen.queryByRole("dialog", { name: DIALOG });
const dialogClosed = () => waitFor(() => expect(dialog()).toBeNull());
const exportButton = (name) => screen.getByRole("button", { name });
const exportCalls = (fetchMock) => callsTo(fetchMock, "/history/export");
const slider = () => screen.getByRole("slider", { name: "Minimum confidence" });
const rows = () => within(screen.getByRole("region", { name: "Records" })).getAllByRole("row").slice(1);
const exportAlert = () => screen.queryByText("Couldn't export the history.");
const loadAlert = () => screen.queryByText("Couldn't load the history.");
const copyLink = (box) => within(box).queryByRole("button", { name: /download a copy/i });

async function setSlider(user, pct) {
  slider().focus();
  await user.keyboard("{Home}");
  for (let v = 0; v < pct; v += 5) await user.keyboard("{ArrowRight}");
}

async function applySlider(user, pct) {
  await setSlider(user, pct);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await act(flush);
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

async function renderLoaded(View = HistoryView) {
  const utils = render(<View />);
  await act(flush);
  return utils;
}

async function openDialog(user) {
  await user.click(screen.getByRole("button", { name: "Clear history" }));
  await act(flush);
  return screen.getByRole("dialog", { name: DIALOG });
}

/** /history handler: two records when min_confidence is set, else R4. */
const byConfidence = (url) =>
  new URL(url).searchParams.has("min_confidence") ? jsonResponse(R4.slice(0, 2)) : jsonResponse(R4);

beforeEach(() => {
  muteFocusTrapWarning();
  saveBlob.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HistoryView: Export CSV", () => {
  it("M6-view-01: with no filters the button reads 'Export CSV (all)' and is enabled", async () => {
    mockFetch({ history: () => jsonResponse(R4) });
    await renderLoaded();

    expect(exportButton("Export CSV (all)")).toBeEnabled();
  });

  it("M6-view-02: with filters applied the label says 'filtered'; Reset brings 'all' back", async () => {
    mockFetch({ history: byConfidence });
    const user = userEvent.setup();
    await renderLoaded();

    await applySlider(user, 70);
    expect(exportButton("Export CSV (filtered)")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Reset" }));
    await act(flush);
    expect(exportButton("Export CSV (all)")).toBeEnabled();
  });

  it("M6-view-02: a From date alone also reads 'filtered'", async () => {
    pinToday();
    mockFetch({ history: () => jsonResponse(R4) });
    const user = userEvent.setup();
    await renderLoaded();

    await pickDay(user, "From", 2);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);

    expect(exportButton("Export CSV (filtered)")).toBeInTheDocument();
  });

  it("M6-view-04: unapplied filter edits change neither the label nor the export", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse(R4), exportCsv: () => csvResponse() });
    const user = userEvent.setup();
    await renderLoaded();

    await setSlider(user, 80);
    await user.click(exportButton("Export CSV (all)"));
    await act(flush);

    const calls = exportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0][0]);
    expect([...url.searchParams.keys()]).toEqual(["tz"]);
  });

  it("M6-view-05: disabled while the history loads, including after Apply", async () => {
    const first = deferred();
    const second = deferred();
    const fetchMock = mockFetch({
      history: inOrder(first.promise, second.promise),
      exportCsv: () => csvResponse(),
    });
    const user = userEvent.setup();
    render(<HistoryView />);
    await act(flush);

    expect(exportButton("Export CSV (all)")).toBeDisabled();
    fireEvent.click(exportButton("Export CSV (all)"));
    await act(flush);
    expect(exportCalls(fetchMock)).toHaveLength(0);

    await act(async () => {
      first.resolve(jsonResponse(R4));
      await flush();
    });
    expect(exportButton("Export CSV (all)")).toBeEnabled();

    await setSlider(user, 50);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);
    expect(screen.getByRole("button", { name: /^Export CSV/ })).toBeDisabled();

    await act(async () => {
      second.resolve(jsonResponse(R4));
      await flush();
    });
    expect(exportButton("Export CSV (filtered)")).toBeEnabled();
  });

  it("M6-view-06: disabled with no records (no data)", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse([]), exportCsv: () => csvResponse() });
    await renderLoaded();

    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    expect(exportButton("Export CSV (all)")).toBeDisabled();
    fireEvent.click(exportButton("Export CSV (all)"));
    await act(flush);
    expect(exportCalls(fetchMock)).toHaveLength(0);
  });

  it("M6-view-06: disabled with no records (filters match nothing)", async () => {
    const fetchMock = mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse([])),
      exportCsv: () => csvResponse(),
    });
    const user = userEvent.setup();
    await renderLoaded();

    await applySlider(user, 95);

    expect(screen.getByText("No detections match these filters.")).toBeInTheDocument();
    expect(exportButton("Export CSV (filtered)")).toBeDisabled();
    fireEvent.click(exportButton("Export CSV (filtered)"));
    await act(flush);
    expect(exportCalls(fetchMock)).toHaveLength(0);
  });

  it("M6-view-07: disabled when the history query failed", async () => {
    mockFetch({ history: () => jsonResponse({ detail: "boom" }, 500) });
    await renderLoaded();

    expect(loadAlert()).toBeInTheDocument();
    expect(exportButton("Export CSV (all)")).toBeDisabled();
  });

  it("M6-view-08: a failed export shows a dismissible alert with the detail; the page stays", async () => {
    const fetchMock = mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => jsonResponse({ detail: "Unknown time zone: 'Etc/Unknown'" }, 400),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const listBefore = listCalls(fetchMock).length;

    await user.click(exportButton("Export CSV (all)"));
    await act(flush);

    const alert = exportAlert().closest('[role="alert"]');
    expect(alert).toHaveTextContent("Unknown time zone: 'Etc/Unknown'");
    expect(rows()).toHaveLength(4);
    expect(listCalls(fetchMock)).toHaveLength(listBefore);
    expect(loadAlert()).toBeNull();
    expect(saveBlob).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole("button"));
    expect(exportAlert()).toBeNull();
  });

  it("M6-view-09: an unreachable backend shows the can't-reach message", async () => {
    mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(exportButton("Export CSV (all)"));
    await act(flush);

    const alert = exportAlert().closest('[role="alert"]');
    expect(within(alert).getByText(/^Can't reach the detection server at/)).toBeInTheDocument();
  });

  it("M6-view-10: a later export clears the error; success shows no alert and doesn't reload", async () => {
    const fetchMock = mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: inOrder(() => jsonResponse({ detail: "Disk on fire" }, 500), () => csvResponse()),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const listBefore = listCalls(fetchMock).length;

    await user.click(exportButton("Export CSV (all)"));
    await act(flush);
    expect(exportAlert()).toBeInTheDocument();
    await user.click(exportButton("Export CSV (all)"));
    await act(flush);

    expect(exportAlert()).toBeNull();
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), FILE);
    expect(listCalls(fetchMock)).toHaveLength(listBefore);
  });

  it("M6-view-11: after Clear history the button shows 'all' and is disabled", async () => {
    mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse(R4), () => jsonResponse([])),
      reset: () => jsonResponse({ status: "cleared", count_removed: 4 }),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);
    await dialogClosed();

    expect(exportButton("Export CSV (all)")).toBeDisabled();
  });
});

describe("Clear dialog: Download a copy first (CSV)", () => {
  it("M6-clear-01: with records to delete, the dialog offers an enabled download link", async () => {
    mockFetch({ history: () => jsonResponse(R4) });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);

    expect(within(box).getByRole("button", { name: "Download a copy first (CSV)" })).toBeEnabled();
  });

  it("M6-clear-03: downloading deletes nothing and keeps the dialog open", async () => {
    const reset = vi.fn(() => jsonResponse({ status: "cleared", count_removed: 4 }));
    const fetchMock = mockFetch({ history: () => jsonResponse(R4), exportCsv: () => csvResponse(), reset });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);
    expect(dialog()).not.toBeNull();
    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeEnabled();
    expect(screen.queryByText(/^Deleted /)).toBeNull();
  });

  it("M6-clear-04: a failed download shows its error in the dialog, and delete stays possible", async () => {
    const fetchMock = mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => jsonResponse({ detail: "Disk on fire" }, 500),
      reset: () => jsonResponse({ status: "cleared", count_removed: 4 }),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    expect(within(box).getByText("Disk on fire")).toBeInTheDocument();
    // OQ-10: the dialog's own export alert.
    expect(within(box).getByText("Couldn't download the copy.")).toBeInTheDocument();
    expect(exportAlert()).toBeNull();
    expect(dialog()).not.toBeNull();
    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeEnabled();
    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);
  });

  it("M6-clear-05: while a delete is in progress the download link is disabled", async () => {
    const pending = deferred();
    const fetchMock = mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => csvResponse(),
      reset: () => pending.promise,
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);

    const link = within(box).getByRole("button", { name: "Download a copy first (CSV)" });
    expect(link).toBeDisabled();
    fireEvent.click(link);
    await act(flush);
    expect(exportCalls(fetchMock)).toHaveLength(0);

    await act(async () => {
      pending.resolve(jsonResponse({ status: "cleared", count_removed: 4 }));
      await flush();
    });
  });

  it.each([
    ["counting", () => deferred().promise],
    ["the count failed", () => jsonResponse({ detail: "database is locked" }, 500)],
    ["history is empty", () => jsonResponse([])],
  ])("M6-clear-06: no download link while %s", async (_label, count) => {
    mockFetch({ history: count });
    const user = userEvent.setup();
    render(<ClearHistoryButton onCleared={vi.fn()} />);

    const box = await openDialog(user);

    expect(copyLink(box)).toBeNull();
  });

  it("M6-clear-07: after a download, confirming the delete works normally", async () => {
    const fetchMock = mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse(R4), () => jsonResponse([])),
      exportCsv: () => csvResponse(),
      reset: () => jsonResponse({ status: "cleared", count_removed: 4 }),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);
    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);

    const resets = callsTo(fetchMock, "/reset");
    expect(resets).toHaveLength(1);
    expect(resets[0][1].method).toBe("DELETE");
    await dialogClosed();
    expect(screen.getByText("Deleted 4 records.")).toBeInTheDocument();
    expect(String(listCalls(fetchMock).at(-1)[0])).not.toContain("?");
  });

  it("M6-clear (OQ-6): while the copy downloads, Delete and Cancel are disabled and the dialog stays open", async () => {
    const pending = deferred();
    mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => pending.promise,
      reset: () => jsonResponse({ status: "cleared", count_removed: 4 }),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeDisabled();
    expect(within(box).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await act(flush);
    expect(dialog()).not.toBeNull();
    fireEvent.click(document.querySelector(".mantine-Modal-close"));
    await act(flush);
    expect(dialog()).not.toBeNull();

    await act(async () => {
      pending.resolve(csvResponse());
      await flush();
    });
    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeEnabled();
    expect(within(box).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("M6-clear (OQ-6): Delete and Cancel re-enable after a failed download", async () => {
    mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => jsonResponse({ detail: "Disk on fire" }, 500),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeEnabled();
    expect(within(box).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("M6-clear (OQ-10): starting a download doesn't clear a delete error", async () => {
    mockFetch({
      history: () => jsonResponse(R4),
      exportCsv: () => csvResponse(),
      reset: () => jsonResponse({ detail: "database is locked" }, 500),
    });
    const user = userEvent.setup();
    await renderLoaded();

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);
    expect(within(box).getByText("database is locked")).toBeInTheDocument();

    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(within(box).getByText("database is locked")).toBeInTheDocument();
  });
});

describe("Export at Asia/Riyadh", () => {
  const m = pinTimeZone("Asia/Riyadh", async () => ({
    HistoryView: (await import("./HistoryView.jsx")).default,
    saveBlob: (await import("../utils/download.js")).saveBlob,
    API_BASE_URL: (await import("../api/client.js")).API_BASE_URL,
  }));

  async function applyFromAndConfidence(user) {
    await pickDay(user, "From", 2);
    await setSlider(user, 50);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);
  }

  it("M6-view-03: Export sends the applied filters with the browser zone as tz", async () => {
    pinToday();
    m.saveBlob.mockReset();
    const fetchMock = mockFetch({ history: () => jsonResponse(R4), exportCsv: () => csvResponse() });
    const user = userEvent.setup();
    await renderLoaded(m.HistoryView);
    await applyFromAndConfidence(user);

    await user.click(exportButton("Export CSV (filtered)"));
    await act(flush);

    const calls = exportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0][0]);
    expect(url.searchParams.get("start_date")).toBe("2026-10-01T21:00:00.000Z");
    expect(url.searchParams.get("min_confidence")).toBe("0.5");
    expect(url.searchParams.get("tz")).toBe("Asia/Riyadh");
    const list = new URL(listCalls(fetchMock).at(-1)[0]);
    expect(url.searchParams.get("start_date")).toBe(list.searchParams.get("start_date"));
    expect(url.searchParams.get("min_confidence")).toBe(list.searchParams.get("min_confidence"));
    expect(m.saveBlob).toHaveBeenCalledWith(expect.any(Blob), FILE);
  });

  it("M6-clear-02: the dialog link exports all records, unfiltered, with the browser zone", async () => {
    pinToday();
    m.saveBlob.mockReset();
    const fetchMock = mockFetch({ history: () => jsonResponse(R4), exportCsv: () => csvResponse() });
    const user = userEvent.setup();
    await renderLoaded(m.HistoryView);
    await applyFromAndConfidence(user);

    const box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Download a copy first (CSV)" }));
    await act(flush);

    const calls = exportCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${m.API_BASE_URL}/history/export?tz=Asia%2FRiyadh`);
    expect(m.saveBlob).toHaveBeenCalledWith(expect.any(Blob), FILE);
  });
});
