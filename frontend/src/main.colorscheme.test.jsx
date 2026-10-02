// Own file: main.jsx mounts a root outside Testing Library, which keeps polling /health.
import { act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { flush, mockFetch } from "./test/helpers.js";

let root;

afterEach(() => {
  root?.remove();
  vi.unstubAllGlobals();
});

it("M3b-shell-06: the app stays light even when the OS prefers dark", async () => {
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query.includes("prefers-color-scheme: dark"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  document.documentElement.removeAttribute("data-mantine-color-scheme");
  root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  mockFetch();

  vi.resetModules();
  await act(async () => {
    await import("./main.jsx");
  });
  await act(flush);

  expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("light");
  expect(root.querySelector("h1")).toHaveTextContent("Detecto");
});
