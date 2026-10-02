import "@testing-library/jest-dom/vitest";
import { createElement } from "react";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { theme } from "../theme.js";

// jsdom lacks APIs Mantine uses for color scheme and layout.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
// Mantine's Combobox scrolls the active option into view (Select search + Enter).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Every render gets the app's MantineProvider (as main.jsx does), so component tests
// don't each need to wrap it. An explicit `wrapper` option still wins.
function Providers({ children }) {
  return createElement(MantineProvider, { theme, forceColorScheme: "light" }, children);
}

vi.mock("@testing-library/react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    render: (ui, options = {}) => actual.render(ui, { wrapper: Providers, ...options }),
  };
});

afterEach(() => cleanup());
