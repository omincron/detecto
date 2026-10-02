import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import {
  callsTo,
  deferred,
  flush,
  jpegFile,
  mockFetch,
  stubObjectUrls,
  unstubObjectUrls,
} from "./test/helpers.js";

const pagesNav = () => screen.getByRole("navigation", { name: "Pages" });
const navButton = (name) => within(pagesNav()).getByRole("button", { name });
const burger = () => screen.getByRole("button", { name: "Toggle navigation" });

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  unstubObjectUrls();
});

describe("App shell", () => {
  it("M3b-status-08: the status card is a polite live region, not a status or alert", async () => {
    mockFetch({ detect: () => deferred().promise });
    const user = userEvent.setup();
    render(<App />);
    await act(flush);

    const statusCard = screen.getByTestId("backend-status");
    expect(statusCard).toHaveAttribute("aria-live", "polite");
    expect(statusCard).not.toHaveAttribute("role");
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    await user.upload(screen.getByTestId("file-input"), jpegFile("zidane.jpg"));
    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Detecting people…");
  });

  it("M3b-shell-01: one h1 wordmark, a banner, a labelled nav and a main region", async () => {
    mockFetch();
    render(<App />);
    await act(flush);

    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveAccessibleName("Detecto");

    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent("Detecto");
    expect(within(banner).getByRole("button", { name: "Toggle navigation" })).toBeInTheDocument();

    const buttons = within(pagesNav()).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Detect", "History"]);
    for (const button of buttons) expect(button).toHaveAttribute("type", "button");

    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 2, name: "Detect people" })).toBeInTheDocument();
    expect(within(main).getByTestId("dropzone")).toBeInTheDocument();
    expect(main).not.toContainElement(screen.getByTestId("backend-status"));

    // OQ-4 (app change agreed, not made yet): the sidebar is not a second navigation landmark.
    const navs = screen.getAllByRole("navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0]).toHaveAccessibleName("Pages");
  });

  it("M3b-shell-02: exactly one nav item has aria-current, following the page", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await act(flush);

    expect(navButton("Detect")).toHaveAttribute("aria-current", "page");
    expect(navButton("History")).not.toHaveAttribute("aria-current");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);

    await user.click(navButton("History"));
    await act(flush);
    expect(navButton("History")).toHaveAttribute("aria-current", "page");
    expect(navButton("Detect")).not.toHaveAttribute("aria-current");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 2 })).toHaveAccessibleName("Detection history");
    // M4 replaced the placeholder with the real page (milestone-4.md Regression).
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    // OQ-1: Detect stays mounted while History is shown, but hidden.
    expect(screen.getByTestId("dropzone")).not.toBeVisible();
    expect(callsTo(fetchMock, "/history")).toHaveLength(1);

    await user.click(navButton("History"));
    await act(flush);
    expect(navButton("History")).toHaveAttribute("aria-current", "page");
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    // Clicking the current page again keeps it: no remount, no new /history call.
    expect(callsTo(fetchMock, "/history")).toHaveLength(1);
  });

  it("M3b-shell-03: navigation works from the keyboard alone", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await act(flush);

    for (let i = 0; i < 10 && document.activeElement !== navButton("History"); i++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(navButton("History"));

    await user.keyboard("{Enter}");
    await act(flush);
    // M4 replaced the placeholder with the real page (milestone-4.md Regression).
    expect(screen.getByRole("heading", { level: 2 })).toHaveAccessibleName("Detection history");
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
    expect(navButton("History")).toHaveAttribute("aria-current", "page");

    for (let i = 0; i < 10 && document.activeElement !== navButton("Detect"); i++) {
      await user.tab({ shift: true });
    }
    expect(document.activeElement).toBe(navButton("Detect"));
    await user.keyboard(" ");
    expect(screen.getByTestId("dropzone")).toBeVisible();
    expect(navButton("Detect")).toHaveAttribute("aria-current", "page");
  });

  // OQ-4 (app change agreed, not made yet): the burger exposes aria-expanded/aria-controls.
  it("M3b-shell-04: the burger toggles the sidebar and choosing a page closes it [OQ-4]", async () => {
    mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await act(flush);

    const controls = burger().getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const sidebar = document.getElementById(controls);
    expect(sidebar).not.toBeNull();
    expect(sidebar).toContainElement(pagesNav());

    expect(burger()).toHaveAttribute("aria-expanded", "false");
    await user.click(burger());
    expect(burger()).toHaveAttribute("aria-expanded", "true");
    await user.click(burger());
    expect(burger()).toHaveAttribute("aria-expanded", "false");
    await user.click(burger());
    expect(burger()).toHaveAttribute("aria-expanded", "true");

    await user.click(navButton("History"));
    expect(burger()).toHaveAttribute("aria-expanded", "false");
    await act(flush);
    // M4 replaced the placeholder with the real page (milestone-4.md Regression).
    expect(screen.getByRole("heading", { level: 2 })).toHaveAccessibleName("Detection history");
    expect(screen.getByText("No detections yet.")).toBeInTheDocument();
  });

  it("M3b-shell-05: switching pages neither remounts the status card nor re-checks", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<App />);
    await act(flush);

    expect(callsTo(fetchMock, "/health")).toHaveLength(1);
    expect(screen.getByTestId("backend-status")).toHaveTextContent("Backend online");

    for (const name of ["History", "Detect", "History"]) {
      await user.click(navButton(name));
      expect(screen.getByTestId("backend-status")).toHaveTextContent("Backend online");
      expect(screen.getByTestId("backend-status")).not.toHaveTextContent("Checking backend");
    }
    await act(flush);

    expect(callsTo(fetchMock, "/health")).toHaveLength(1);
    expect(screen.getByTestId("backend-status")).toHaveTextContent("Backend online");
    // M4: History mounts per visit, so History, Detect, History makes 2 /history calls
    // (milestone-4.md Regression, consistent with M4-app-02).
    expect(callsTo(fetchMock, "/history")).toHaveLength(2);
  });
});
