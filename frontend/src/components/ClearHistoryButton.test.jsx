import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClearHistoryButton from "./ClearHistoryButton.jsx";
import {
  callsTo,
  deferred,
  flush,
  inOrder,
  jsonResponse,
  mockFetch,
  muteFocusTrapWarning,
  R4,
} from "../test/helpers.js";

const DIALOG = "Clear detection history?";
const dialog = () => screen.queryByRole("dialog", { name: DIALOG });
const dialogClosed = () => waitFor(() => expect(dialog()).toBeNull());

async function openDialog(user) {
  await user.click(screen.getByRole("button", { name: "Clear history" }));
  await act(flush);
  return screen.getByRole("dialog", { name: DIALOG });
}

beforeEach(() => {
  muteFocusTrapWarning();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClearHistoryButton", () => {
  it("M4-clear-05: with 0 records there is nothing to delete and no way to delete", async () => {
    const fetchMock = mockFetch({ history: () => jsonResponse([]) });
    const user = userEvent.setup();
    render(<ClearHistoryButton onCleared={vi.fn()} />);

    const box = await openDialog(user);

    expect(within(box).getByText("History is already empty. There is nothing to delete.")).toBeInTheDocument();
    const confirm = within(box).getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    await act(flush);
    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);
  });

  it("M4-clear-06: a failed count shows the error, blocks delete, and reopening retries [OQ-6]", async () => {
    // OQ-6: accepted as is (Delete stays disabled, reopening retries).
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse({ detail: "database is locked" }, 500),
        () => jsonResponse(R4),
      ),
    });
    const user = userEvent.setup();
    render(<ClearHistoryButton onCleared={vi.fn()} />);

    let box = await openDialog(user);
    expect(within(box).getByRole("alert")).toHaveTextContent("database is locked");
    expect(within(box).queryByText(/Delete all/)).toBeNull();
    expect(within(box).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(callsTo(fetchMock, "/reset")).toHaveLength(0);

    await user.click(within(box).getByRole("button", { name: "Cancel" }));
    await dialogClosed();
    box = await openDialog(user);

    expect(callsTo(fetchMock, "/history")).toHaveLength(2);
    expect(within(box).getByRole("button", { name: "Delete all 4 records" })).toBeInTheDocument();
    expect(within(box).queryByRole("alert")).toBeNull();
  });

  it("M4-clear-08: while deleting, the dialog can't be dismissed or sent twice", async () => {
    const pending = deferred();
    const fetchMock = mockFetch({ history: () => jsonResponse(R4), reset: () => pending.promise });
    const onCleared = vi.fn();
    const user = userEvent.setup();
    render(<ClearHistoryButton onCleared={onCleared} />);
    const box = await openDialog(user);
    const confirm = within(box).getByRole("button", { name: "Delete all 4 records" });

    await user.click(confirm);

    expect(confirm).toHaveAttribute("data-loading", "true");
    expect(within(box).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await act(flush);
    expect(dialog()).toBeInTheDocument();
    fireEvent.click(confirm);
    await act(flush);
    expect(callsTo(fetchMock, "/reset")).toHaveLength(1);

    await act(async () => {
      pending.resolve(jsonResponse({ status: "cleared", count_removed: 4 }));
      await flush();
    });
    await dialogClosed();
    expect(onCleared).toHaveBeenCalledWith(4);
  });

  it("M4-clear-10: with exactly one record the wording is grammatical [OQ-5]", async () => {
    // OQ-5 (app change agreed, not made yet): "Delete 1 record", "the only record".
    mockFetch({ history: () => jsonResponse([R4[0]]) });
    const user = userEvent.setup();
    render(<ClearHistoryButton onCleared={vi.fn()} />);

    const box = await openDialog(user);

    expect(within(box).getByRole("button", { name: "Delete 1 record" })).toBeEnabled();
    expect(box).toHaveTextContent("This deletes the only record in the history.");
  });
});
