// Stale-response cases (M3-view-10, M3-view-11). The real uploader may be disabled while
// loading (OQ-1), so it is replaced by a stub that can always select A or B.
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetectionView from "./DetectionView.jsx";
import {
  D2,
  deferred,
  flush,
  jsonResponse,
  mockFetch,
  stubObjectUrls,
  unstubObjectUrls,
} from "../test/helpers.js";

vi.mock("../components/ImageUploader.jsx", () => ({
  default: ({ onSelect }) => (
    <div>
      <button type="button" onClick={() => onSelect(new File(["a"], "a.jpg", { type: "image/jpeg" }))}>
        Select A
      </button>
      <button type="button" onClick={() => onSelect(new File(["b"], "b.jpg", { type: "image/jpeg" }))}>
        Select B
      </button>
    </div>
  ),
}));

const resultWith = (count) =>
  jsonResponse({
    ...D2,
    count,
    detections: Array.from({ length: count }, (_, i) => ({
      bbox: [i * 10, i * 10, i * 10 + 50, i * 10 + 50],
      confidence: 0.7,
    })),
    average_confidence: count ? 0.7 : 0,
  });

const rejection = () => jsonResponse({ detail: "Unsupported file type: text/plain" }, 415);

/** Separate deferreds for A and B, routed by the uploaded file's name. */
function setup() {
  const pending = { "a.jpg": deferred(), "b.jpg": deferred() };
  mockFetch({ detect: (_url, options) => pending[options.body.get("image").name].promise });
  return pending;
}

async function selectAThenB(user) {
  await user.click(screen.getByRole("button", { name: "Select A" }));
  await user.click(screen.getByRole("button", { name: "Select B" }));
}

const settle = (fn) =>
  act(async () => {
    fn();
    await flush();
  });

const previewSrcs = (container) => [...container.querySelectorAll("img")].map((img) => img.src);

beforeEach(() => {
  stubObjectUrls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  unstubObjectUrls();
});

describe("DetectionView stale responses", () => {
  it("M3-view-10a: B resolves before A, and A's late result is ignored", async () => {
    const pending = setup();
    const user = userEvent.setup();
    const { container } = render(<DetectionView />);
    await selectAThenB(user);

    await settle(() => pending["b.jpg"].resolve(resultWith(3)));
    expect(screen.getByTestId("person-count")).toHaveTextContent(/^3$/);
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(3);

    await settle(() => pending["a.jpg"].resolve(resultWith(1)));
    expect(screen.getByTestId("person-count")).toHaveTextContent(/^3$/);
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(3);
    expect(previewSrcs(container)).toEqual(["blob:mock/2"]);
  });

  it("M3-view-10b: A resolves first and is not shown; B's result is", async () => {
    const pending = setup();
    const user = userEvent.setup();
    const { container } = render(<DetectionView />);
    await selectAThenB(user);

    await settle(() => pending["a.jpg"].resolve(resultWith(1)));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByTestId("person-count")).toBeNull();
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(previewSrcs(container)).toEqual(["blob:mock/2"]);

    await settle(() => pending["b.jpg"].resolve(resultWith(3)));
    expect(screen.getByTestId("person-count")).toHaveTextContent(/^3$/);
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(3);
    expect(previewSrcs(container)).toEqual(["blob:mock/2"]);
  });

  it("M3-view-11a: a late error from a superseded request is ignored", async () => {
    const pending = setup();
    const user = userEvent.setup();
    render(<DetectionView />);
    await selectAThenB(user);

    await settle(() => pending["b.jpg"].resolve(resultWith(3)));
    await settle(() => pending["a.jpg"].resolve(rejection()));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("person-count")).toHaveTextContent(/^3$/);
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(3);
  });

  it("M3-view-11b: B's error stays when A resolves later", async () => {
    const pending = setup();
    const user = userEvent.setup();
    render(<DetectionView />);
    await selectAThenB(user);

    await settle(() => pending["b.jpg"].resolve(rejection()));
    await settle(() => pending["a.jpg"].resolve(resultWith(1)));

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't analyse b.jpg.");
    expect(screen.queryByTestId("person-count")).toBeNull();
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
  });
});
