// M3b-hint-02: VITE_MAX_UPLOAD_MB drives both the hint and the rejection threshold.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callsTo,
  D2,
  flush,
  JPEG_BYTES,
  jsonResponse,
  mockFetch,
  stubObjectUrls,
  unstubObjectUrls,
} from "../test/helpers.js";

const MiB = 1048576;

async function renderWithLimit(mb) {
  vi.stubEnv("VITE_MAX_UPLOAD_MB", mb);
  vi.resetModules();
  const { default: DetectionView } = await import("./DetectionView.jsx");
  render(<DetectionView />);
  await act(flush);
}

function sized(name, size) {
  const file = new File([JPEG_BYTES], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  unstubObjectUrls();
});

describe("DetectionView with a configured upload limit", () => {
  it("M3b-hint-02: a 5 MB setting changes the hint and the threshold together", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    await renderWithLimit("5");

    expect(screen.getByText("JPEG or PNG, up to 5 MB")).toBeInTheDocument();
    expect(screen.queryByText(/up to 10 MB/)).toBeNull();

    await user.upload(screen.getByTestId("file-input"), sized("big.jpg", 5 * MiB + 1));
    expect(screen.getByRole("alert")).toHaveTextContent("This file is larger than the 5 MB limit.");
    expect(callsTo(fetchMock, "/detect")).toHaveLength(0);

    await user.upload(screen.getByTestId("file-input"), sized("edge.jpg", 5 * MiB));
    const detectCalls = callsTo(fetchMock, "/detect");
    expect(detectCalls).toHaveLength(1);
    expect(detectCalls[0][1].body.get("image").name).toBe("edge.jpg");
  });

  it("M3b-hint-02: a 2.5 MB setting shows a 2.5 MB hint", async () => {
    mockFetch();
    await renderWithLimit("2.5");

    expect(screen.getByText("JPEG or PNG, up to 2.5 MB")).toBeInTheDocument();
  });
});
