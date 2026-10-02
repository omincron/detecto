import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import {
  callsTo,
  D2,
  deferred,
  flush,
  inOrder,
  jpegFile,
  jsonResponse,
  mockFetch,
  muteFocusTrapWarning,
  R4,
  stubObjectUrls,
  unstubObjectUrls,
} from "./test/helpers.js";

const navButton = (name) =>
  within(screen.getByRole("navigation", { name: "Pages" })).getByRole("button", { name });
const kpi = (label) => within(screen.getByLabelText("Totals")).getByText(label).nextElementSibling;

async function go(user, name) {
  await user.click(navButton(name));
  await act(flush);
}

beforeEach(() => {
  stubObjectUrls();
  muteFocusTrapWarning();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  unstubObjectUrls();
});

describe("App navigation with History", () => {
  it("M4-app-01: History loads once per visit; Go to Detect switches back", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    const href = window.location.href;
    render(<App />);
    await act(flush);

    await go(user, "History");

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Detection history");
    const calls = callsTo(fetchMock, "/history");
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).not.toContain("?");
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to Detect" }));
    await act(flush);

    expect(screen.getByTestId("dropzone")).toBeVisible();
    expect(navButton("Detect")).toHaveAttribute("aria-current", "page");
    expect(navButton("History")).not.toHaveAttribute("aria-current");
    expect(window.location.href).toBe(href);
  });

  it("M4-app-02: returning to History shows fresh data", async () => {
    const fetchMock = mockFetch({
      history: inOrder(
        () => jsonResponse([R4[0]]),
        () => jsonResponse(R4),
      ),
    });
    const user = userEvent.setup();
    render(<App />);
    await act(flush);

    await go(user, "History");
    expect(kpi("Detections")).toHaveTextContent("1");

    await go(user, "Detect");
    await go(user, "History");
    expect(callsTo(fetchMock, "/history")).toHaveLength(2);
    expect(kpi("Detections")).toHaveTextContent("4");

    await go(user, "History");
    expect(callsTo(fetchMock, "/history")).toHaveLength(2);
  });

  it("M4-app-03: the Detect result survives a visit to History [OQ-1]", async () => {
    // OQ-1 (app change agreed, not made yet): DetectionView stays mounted (hidden) on History.
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    render(<App />);
    await act(flush);
    await user.upload(screen.getByTestId("file-input"), jpegFile("zidane.jpg"));
    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^2$/);

    await go(user, "History");
    await go(user, "Detect");

    expect(screen.getByTestId("person-count")).toHaveTextContent(/^2$/);
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(2);
    expect(callsTo(fetchMock, "/detect")).toHaveLength(1);
  });

  it("M4-app-03 (in flight): a detection started before visiting History completes [OQ-1]", async () => {
    // OQ-1 (app change agreed, not made yet): an in-flight detection keeps running.
    const pending = deferred();
    mockFetch({ detect: () => pending.promise });
    const user = userEvent.setup();
    render(<App />);
    await act(flush);
    await user.upload(screen.getByTestId("file-input"), jpegFile("zidane.jpg"));

    await go(user, "History");
    await act(async () => {
      pending.resolve(jsonResponse(D2));
      await flush();
    });
    await go(user, "Detect");

    expect(screen.getByTestId("person-count")).toHaveTextContent(/^2$/);
  });
});
