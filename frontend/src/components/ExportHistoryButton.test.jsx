import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportHistoryButton from "./ExportHistoryButton.jsx";
import { ApiError, exportHistory } from "../api/client.js";
import { saveBlob } from "../utils/download.js";
import { deferred, flush } from "../test/helpers.js";

vi.mock("../api/client.js", async (importOriginal) => ({
  ...(await importOriginal()),
  exportHistory: vi.fn(),
}));
vi.mock("../utils/download.js");

const B = new Blob(["id\r\n"], { type: "text/csv" });
const button = (name = "Export CSV (all)") => screen.getByRole("button", { name });
const isBusy = (el) => el.disabled || el.getAttribute("data-loading") === "true";

beforeEach(() => {
  exportHistory.mockReset();
  saveBlob.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExportHistoryButton", () => {
  it("M6-btn-01: renders its children and exports the params under the server's filename", async () => {
    exportHistory.mockResolvedValue({ blob: B, filename: "f.csv" });
    const user = userEvent.setup();
    render(<ExportHistoryButton params={{ min_confidence: "0.5" }}>Export CSV (all 3)</ExportHistoryButton>);

    await user.click(button("Export CSV (all 3)"));
    await act(flush);

    expect(exportHistory).toHaveBeenCalledTimes(1);
    expect(exportHistory.mock.calls[0][0]).toEqual({ min_confidence: "0.5" });
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(saveBlob).toHaveBeenCalledWith(B, "f.csv");
  });

  it("M6-btn-02: busy while pending, no second export, re-enabled after resolve or reject", async () => {
    const onBusyChange = vi.fn();
    let pending = deferred();
    exportHistory.mockImplementation(() => pending.promise);
    render(
      <ExportHistoryButton onBusyChange={onBusyChange} onError={vi.fn()}>
        Export CSV (all)
      </ExportHistoryButton>,
    );

    fireEvent.click(button());
    await act(flush);
    expect(isBusy(button())).toBe(true);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(button());
    await act(flush);
    expect(exportHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve({ blob: B, filename: "f.csv" });
      await flush();
    });
    expect(isBusy(button())).toBe(false);
    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);

    pending = deferred();
    fireEvent.click(button());
    await act(flush);
    expect(isBusy(button())).toBe(true);
    await act(async () => {
      pending.reject(new Error("nope"));
      await flush();
    });
    expect(isBusy(button())).toBe(false);
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("M6-btn-03: a failure goes to onError and nothing is saved", async () => {
    exportHistory.mockRejectedValue(new ApiError("Unknown time zone: 'X'", 400));
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<ExportHistoryButton onError={onError}>Export CSV (all)</ExportHistoryButton>);

    await user.click(button());
    await act(flush);

    expect(onError).toHaveBeenLastCalledWith("Unknown time zone: 'X'");
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it("M6-btn-04: an error without a message falls back to a generic one", async () => {
    exportHistory.mockRejectedValue(new Error(""));
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<ExportHistoryButton onError={onError}>Export CSV (all)</ExportHistoryButton>);

    await user.click(button());
    await act(flush);

    expect(onError).toHaveBeenLastCalledWith("Couldn't export the history");
  });

  it("M6-btn-05: starting an export clears the previous error first", async () => {
    exportHistory
      .mockRejectedValueOnce(new ApiError("Disk on fire", 500))
      .mockResolvedValueOnce({ blob: B, filename: "f.csv" });
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<ExportHistoryButton onError={onError}>Export CSV (all)</ExportHistoryButton>);

    await user.click(button());
    await act(flush);
    await waitFor(() => expect(button()).toBeEnabled());
    await user.click(button());
    await act(flush);

    expect(onError.mock.calls).toEqual([[null], ["Disk on fire"], [null]]);
  });

  it("M6-btn-06: props are forwarded; disabled prevents the export", async () => {
    render(<ExportHistoryButton disabled>Export CSV (all)</ExportHistoryButton>);

    expect(button()).toBeDisabled();
    fireEvent.click(button());
    await act(flush);
    expect(exportHistory).not.toHaveBeenCalled();
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
