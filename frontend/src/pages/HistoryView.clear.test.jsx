import { act, render, screen, waitFor, within } from "@testing-library/react";
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

const DIALOG = "Clear detection history?";
const dialog = () => screen.queryByRole("dialog", { name: DIALOG });
const totals = () => screen.queryByLabelText("Totals");
const kpi = (label) => within(totals()).getByText(label).nextElementSibling;
const slider = () => screen.getByRole("slider", { name: "Minimum confidence" });
const historyUrls = (fetchMock) => callsTo(fetchMock, "/history").map(([url]) => String(url));
const dialogClosed = () => waitFor(() => expect(dialog()).toBeNull());

async function setSlider(user, pct) {
  slider().focus();
  await user.keyboard("{Home}");
  for (let v = 0; v < pct; v += 5) await user.keyboard("{ArrowRight}");
}

async function renderLoaded() {
  const utils = render(<HistoryView />);
  await act(flush);
  return utils;
}

async function openDialog(user) {
  await user.click(screen.getByRole("button", { name: "Clear history" }));
  await act(flush);
  return screen.getByRole("dialog", { name: DIALOG });
}

async function applySlider(user, pct) {
  await setSlider(user, pct);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await act(flush);
}

beforeEach(() => {
  muteFocusTrapWarning();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Clear history in HistoryView", () => {
  /** Mount R4, apply 85% ([R4[2]]), then open the dialog with the count pending. */
  async function openWhileFiltered() {
    const count = deferred();
    const fetchMock = mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse([R4[2]]), count.promise),
    });
    const user = userEvent.setup();
    await renderLoaded();
    await applySlider(user, 85);
    const box = await openDialog(user);
    return { count, fetchMock, box };
  }

  it("M4-clear-01: opening fetches the unfiltered total, counting with Delete disabled", async () => {
    const { fetchMock, box } = await openWhileFiltered();

    expect(within(box).getByText("Counting records…")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(historyUrls(fetchMock)).toHaveLength(3);
    expect(historyUrls(fetchMock).at(-1)).not.toContain("?");
  });

  it("M4-clear-02: the dialog states the scope and the unfiltered total", async () => {
    const { count, fetchMock, box } = await openWhileFiltered();
    await act(async () => {
      count.resolve(jsonResponse(many(34)));
      await flush();
    });

    expect(within(box).getByText(/This deletes/)).toHaveTextContent("This deletes all 34 records in the history.");
    expect(within(box).getByText("It ignores the filters currently applied.")).toBeInTheDocument();
    expect(within(box).getByText("It can't be undone.")).toBeInTheDocument();
    expect(within(box).getByRole("button", { name: "Delete all 34 records" })).toBeEnabled();
    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);
  });

  it("M4-clear-03: confirming sends one DELETE, closes, shows the server's count and reloads", async () => {
    const fetchMock = mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse(many(34)), () => jsonResponse([])),
      reset: () => jsonResponse({ status: "cleared", count_removed: 35 }),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const box = await openDialog(user);
    expect(historyUrls(fetchMock)).toHaveLength(2);

    await user.click(within(box).getByRole("button", { name: "Delete all 34 records" }));
    await act(flush);

    const resets = callsTo(fetchMock, "/reset");
    expect(resets).toHaveLength(1);
    expect(resets[0][1].method).toBe("DELETE");
    await dialogClosed();
    expect(screen.getByText("Deleted 35 records.")).toBeInTheDocument();
    expect(historyUrls(fetchMock)).toHaveLength(3);
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
  });

  it("M4-clear-03 (singular): count_removed 1 reads 'Deleted 1 record.'", async () => {
    mockFetch({
      history: inOrder(() => jsonResponse(R4), () => jsonResponse(R4), () => jsonResponse([])),
      reset: () => jsonResponse({ status: "cleared", count_removed: 1 }),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const box = await openDialog(user);

    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);

    expect(screen.getByText("Deleted 1 record.")).toBeInTheDocument();
  });

  it("M4-clear-04: Cancel, Escape and the close control delete nothing", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse(R4) });
    const user = userEvent.setup();
    await renderLoaded();

    let box = await openDialog(user);
    await user.click(within(box).getByRole("button", { name: "Cancel" }));
    await dialogClosed();

    box = await openDialog(user);
    await user.keyboard("{Escape}");
    await dialogClosed();

    box = await openDialog(user);
    await user.click(document.querySelector(".mantine-Modal-close"));
    await dialogClosed();

    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);
    expect(kpi("Detections")).toHaveTextContent("4");
  });

  it("M4-clear-07: a failed delete keeps the dialog open with the message, no notice, no reload", async () => {
    const fetchMock = mockFetch({
      history: () => jsonResponse(R4),
      reset: inOrder(
        () => jsonResponse({ detail: "database is locked" }, 500),
        () => jsonResponse({ count_removed: 4 }),
      ),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const box = await openDialog(user);
    const historyCalls = historyUrls(fetchMock).length;

    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);

    expect(dialog()).toBeInTheDocument();
    expect(within(box).getByRole("alert")).toHaveTextContent("database is locked");
    expect(screen.queryByText(/^Deleted /)).toBeNull();
    expect(historyUrls(fetchMock)).toHaveLength(historyCalls);
    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeEnabled();

    await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
    await act(flush);

    expect(callsTo(fetchMock, "/reset")).toHaveLength(2);
    await dialogClosed();
    expect(screen.getByText("Deleted 4 records.")).toBeInTheDocument();
  });

  it("M4-clear-09: the notice is dismissible and cleared by the next Reset", async () => {
    mockFetch({
      history: () => jsonResponse(R4),
      reset: () => jsonResponse({ status: "cleared", count_removed: 4 }),
    });
    const user = userEvent.setup();
    await renderLoaded();
    const clear = async () => {
      const box = await openDialog(user);
      await user.click(within(box).getByRole("button", { name: "Delete all 4 records" }));
      await act(flush);
      await dialogClosed();
    };

    await clear();
    const notice = screen.getByText("Deleted 4 records.").closest('[role="alert"]');
    await user.click(within(notice).getByRole("button"));
    expect(screen.queryByText("Deleted 4 records.")).toBeNull();

    await clear();
    expect(screen.getByText("Deleted 4 records.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset" }));
    await act(flush);
    expect(screen.queryByText("Deleted 4 records.")).toBeNull();
  });

  it("M4-clear-11: after a clear with filters applied, filters reset and the reload is unfiltered [OQ-3]", async () => {
    // OQ-3 (app change agreed, not made yet): a successful clear resets draft and applied filters.
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse(R4),
        () => jsonResponse([R4[2]]),
        () => jsonResponse(many(34)),
        () => jsonResponse([]),
      ),
      reset: () => jsonResponse({ status: "cleared", count_removed: 34 }),
    });
    const user = userEvent.setup();
    await renderLoaded();
    await applySlider(user, 85);
    const box = await openDialog(user);

    await user.click(within(box).getByRole("button", { name: "Delete all 34 records" }));
    await act(flush);
    await dialogClosed();

    expect(historyUrls(fetchMock).at(-1)).not.toContain("?");
    expect(slider()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Any")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveTextContent("Any time");
    expect(screen.getByLabelText("To")).toHaveTextContent("Now");
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    expect(screen.queryByText("No detections match these filters.")).toBeNull();
    expect(screen.getByText("Deleted 34 records.")).toBeInTheDocument();
  });
});
