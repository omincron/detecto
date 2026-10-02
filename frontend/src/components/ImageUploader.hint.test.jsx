import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ImageUploader from "./ImageUploader.jsx";
import { flush, mockFetch } from "../test/helpers.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("M3b-hint-01: the dropzone hint states the configured 10 MB default", async () => {
  mockFetch();
  render(<ImageUploader onSelect={() => {}} />);
  await act(flush);

  expect(screen.getByText("JPEG or PNG, up to 10 MB")).toBeInTheDocument();
});
