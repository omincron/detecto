import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { flush, mockFetch, stubObjectUrls, unstubObjectUrls } from "./test/helpers.js";

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  unstubObjectUrls();
});

describe("App", () => {
  it("M3-app-01: opens on the Detect page with navigation for both pages", async () => {
    mockFetch();
    render(<App />);
    await act(flush);

    expect(screen.getByRole("heading", { name: "Detecto" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Pages" });
    expect(within(nav).getByRole("button", { name: "Detect" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("button", { name: "History" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
  });

  it("M3-app-02: switching pages swaps content without changing the URL", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    const href = window.location.href;
    render(<App />);
    await act(flush);
    const nav = screen.getByRole("navigation", { name: "Pages" });

    await user.click(within(nav).getByRole("button", { name: "History" }));
    expect(
      screen.getByText("Detection history is coming in the next milestone."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("dropzone")).toBeNull();
    expect(within(nav).getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/history"))).toHaveLength(0);
    expect(window.location.href).toBe(href);

    await user.click(within(nav).getByRole("button", { name: "Detect" }));
    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    expect(window.location.href).toBe(href);
  });
});
