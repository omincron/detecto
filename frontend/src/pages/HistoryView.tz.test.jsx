import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callsTo,
  flush,
  inOrder,
  jsonResponse,
  mockFetch,
  muteFocusTrapWarning,
  pinTimeZone,
  R4,
  refFormat,
} from "../test/helpers.js";

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

beforeEach(() => {
  muteFocusTrapWarning();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HistoryView at Asia/Riyadh", () => {
  const m = pinTimeZone("Asia/Riyadh", async () => ({
    HistoryView: (await import("./HistoryView.jsx")).default,
  }));

  it("M4-view-03: names the local time zone, and the table shows local times", async () => {
    const { HistoryView } = m;
    mockFetch({ history: () => jsonResponse(R4) });
    render(<HistoryView />);
    await act(flush);

    expect(document.body).toHaveTextContent("Times are shown in your local time zone (Asia/Riyadh)");
    const firstRow = within(screen.getByRole("region", { name: "Records" })).getAllByRole("row")[1];
    expect(firstRow.querySelector("time").textContent).toBe(
      refFormat(new Date("2026-10-02T11:05:09.563Z"), "Asia/Riyadh"),
    );
  });

  it("M4-view-05: picked dates reach the API as UTC instants of local midnight", async () => {
    const { HistoryView } = m;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const fetchMock = mockFetch({ history: inOrder(() => jsonResponse(R4), () => jsonResponse([])) });
    const user = userEvent.setup();
    render(<HistoryView />);
    await act(flush);

    await pickDay(user, "From", 2);
    await pickDay(user, "To", 3);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await act(flush);

    const calls = callsTo(fetchMock, "/history");
    const url = new URL(calls.at(-1)[0]);
    expect(url.searchParams.get("start_date")).toBe("2026-10-01T21:00:00.000Z");
    // OQ-2: a picked "To" day snaps to 23:59 and is inclusive of that minute, so To Oct 3
    // ends at local midnight starting Oct 4 (Riyadh, UTC+3).
    expect(url.searchParams.get("end_date")).toBe("2026-10-03T21:00:00.000Z");
    for (const key of ["start_date", "end_date"]) {
      expect(url.searchParams.get(key)).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
