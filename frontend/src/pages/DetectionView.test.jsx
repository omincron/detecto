import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetectionView from "./DetectionView.jsx";
import {
  callsTo,
  D2,
  deferred,
  flush,
  jpegFile,
  jsonResponse,
  mockFetch,
  stubObjectUrls,
  unstubObjectUrls,
} from "../test/helpers.js";

const styleOf = (box) => [box.style.left, box.style.top, box.style.width, box.style.height];
const images = (container) => [...container.querySelectorAll("img")];
const summary = () => screen.queryByRole("region", { name: "Detection summary" });
const chooseButton = () => screen.getByRole("button", { name: "Choose an image" });
const valueOf = (term) => screen.getByText(term).nextElementSibling;

/** /detect handler that answers each call with the next item (a Response factory or a promise). */
const inOrder = (...answers) => {
  const queue = [...answers];
  return () => {
    const next = queue.shift();
    return typeof next === "function" ? next() : next;
  };
};

async function pick(user, file) {
  await user.upload(screen.getByTestId("file-input"), file);
}

let urls;

beforeEach(() => {
  urls = stubObjectUrls();
});

afterEach(() => {
  cleanup(); // before the URL stubs go away: unmount revokes the preview URL
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  unstubObjectUrls();
});

describe("DetectionView", () => {
  it("M3-view-01: initial state shows only the uploader", async () => {
    mockFetch();
    const { container } = render(<DetectionView />);
    await act(flush);

    expect(screen.getByTestId("dropzone")).toBeInTheDocument();
    expect(chooseButton()).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(images(container)).toHaveLength(0);
    expect(summary()).toBeNull();
  });

  it("M3-view-02: while detecting, shows a loading indicator over the preview", async () => {
    const fetchMock = mockFetch({ detect: () => deferred().promise });
    const user = userEvent.setup();
    const { container } = render(<DetectionView />);

    await pick(user, jpegFile("zidane.jpg"));

    expect(screen.getByRole("status")).toHaveTextContent("Detecting people…");
    const imgs = images(container);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", "blob:mock/1");
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(summary()).toBeNull();
    expect(callsTo(fetchMock, "/detect")).toHaveLength(1);
  });

  it("M3-view-03: on success shows boxes, count, confidences and both timings", async () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    mockFetch({
      detect: () => {
        now = 1250.4;
        return jsonResponse(D2);
      },
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await pick(user, jpegFile("zidane.jpg"));

    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^2$/);
    const boxes = screen.getAllByTestId("bounding-box");
    expect(boxes.map(styleOf)).toEqual([
      ["10%", "10%", "40%", "40%"],
      ["50%", "50%", "50%", "50%"],
    ]);
    expect(screen.getByRole("img", { name: "zidane.jpg" })).toHaveAttribute("src", "blob:mock/1");
    expect(valueOf("Model time")).toHaveTextContent(/^142 ms$/);
    expect(valueOf("Total time")).toHaveTextContent(/^250 ms$/);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("91%");
    expect(items[1]).toHaveTextContent("62%");
    expect(screen.queryByRole("status")).toBeNull();
    expect(chooseButton()).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Show bounding boxes" })).toBeChecked();
  });

  it("M3-view-04: boxes use the backend's processed frame size", async () => {
    mockFetch({
      detect: () =>
        jsonResponse({
          count: 1,
          detections: [{ bbox: [320, 240, 960, 720], confidence: 0.8 }],
          average_confidence: 0.8,
          inference_time_ms: 50,
          image_width: 1280,
          image_height: 960,
          annotated_image_base64: null,
        }),
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await pick(user, jpegFile("big.jpg"));

    const box = await screen.findByTestId("bounding-box");
    expect(styleOf(box)).toEqual(["25%", "25%", "50%", "50%"]);
    expect(screen.getByText("Processed at 1280 × 960 px")).toBeInTheDocument();
  });

  it("M3-view-05: a zero-person result shows the image and the empty state", async () => {
    mockFetch({
      detect: () => jsonResponse({ ...D2, count: 0, detections: [], average_confidence: 0 }),
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await pick(user, jpegFile("empty-street.jpg"));

    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^0$/);
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "empty-street.jpg" })).toBeInTheDocument();
    expect(screen.getByText("No people detected in this image.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["notes.txt", "text/plain", 415, "Unsupported file type: text/plain"],
    ["anim.gif", "image/gif", 415, "Unsupported image format: GIF. Only JPEG and PNG are accepted"],
    ["empty.jpg", "image/jpeg", 400, "Uploaded file is empty"],
    ["huge.jpg", "image/jpeg", 413, "File too large (max 10 MB)"],
    ["ok.jpg", "image/jpeg", 500, "Inference failed: boom"],
  ])(
    "M3-view-06: %s is sent unchanged and the backend message is shown",
    async (name, type, status, detail) => {
      const fetchMock = mockFetch({ detect: () => jsonResponse({ detail }, status) });
      const user = userEvent.setup({ applyAccept: false });
      const { container } = render(<DetectionView />);
      const file = new File(name === "empty.jpg" ? [] : ["x"], name, { type });

      await pick(user, file);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(`Couldn't analyse ${name}.`);
      expect(alert).toHaveTextContent(detail);
      const detectCalls = callsTo(fetchMock, "/detect");
      expect(detectCalls).toHaveLength(1);
      const sent = detectCalls[0][1].body.get("image");
      expect(sent.name).toBe(name);
      expect(sent.size).toBe(file.size);
      expect(sent.type).toBe(type);
      expect(images(container)).toHaveLength(0);
      expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
      expect(summary()).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(chooseButton()).toBeEnabled();
    },
  );

  it("M3-view-07: an unreachable backend is reported in the alert", async () => {
    mockFetch({
      detect: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await pick(user, jpegFile("zidane.jpg"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't analyse zidane.jpg.");
    expect(alert.textContent).toMatch(/can't reach/i);
  });

  it("M3-view-08: a valid image after an error clears the error and shows the result", async () => {
    mockFetch({
      detect: inOrder(
        () => jsonResponse({ detail: "Unsupported file type: text/plain" }, 415),
        () => jsonResponse(D2),
      ),
    });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);

    await pick(user, new File(["x"], "notes.txt", { type: "text/plain" }));
    await screen.findByRole("alert");
    await pick(user, jpegFile("zidane.jpg"));

    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^2$/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(2);
  });

  it("M3-view-09: a new pick removes the previous result and hover state at once", async () => {
    const second = deferred();
    mockFetch({ detect: inOrder(() => jsonResponse(D2), second.promise) });
    const user = userEvent.setup();
    const { container } = render(<DetectionView />);

    await pick(user, jpegFile("a.jpg"));
    await screen.findByTestId("person-count");
    await user.hover(screen.getAllByRole("listitem")[0]);
    expect(screen.getAllByTestId("bounding-box")[0]).toHaveClass("overlay__box--highlighted");

    await pick(user, jpegFile("b.jpg"));

    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(summary()).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    const imgs = images(container);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute("src", "blob:mock/2");

    await act(async () => {
      second.resolve(jsonResponse(D2));
      await flush();
    });
    await screen.findByTestId("person-count");
    expect(container.querySelectorAll(".overlay__box--highlighted")).toHaveLength(0);
    expect(container.querySelectorAll(".is-highlighted")).toHaveLength(0);
  });

  it("M3-view-12: the boxes toggle hides and shows boxes only", async () => {
    mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    render(<DetectionView />);
    await pick(user, jpegFile("zidane.jpg"));
    await screen.findByTestId("person-count");
    const before = screen.getAllByTestId("bounding-box").map(styleOf);
    const toggle = screen.getByRole("checkbox", { name: "Show bounding boxes" });

    await user.click(toggle);
    expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "zidane.jpg" })).toBeInTheDocument();
    expect(screen.getByTestId("person-count")).toHaveTextContent(/^2$/);

    await user.click(toggle);
    expect(screen.getAllByTestId("bounding-box").map(styleOf)).toEqual(before);
  });

  it("M3-view-13: list hover highlights the box and box hover highlights the entry", async () => {
    mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    const { container } = render(<DetectionView />);
    await pick(user, jpegFile("zidane.jpg"));
    await screen.findByTestId("person-count");
    const boxes = screen.getAllByTestId("bounding-box");
    const items = screen.getAllByRole("listitem");

    await user.hover(items[1]);
    expect(boxes[1]).toHaveClass("overlay__box--highlighted");
    expect(boxes[0]).not.toHaveClass("overlay__box--highlighted");
    await user.unhover(items[1]);
    expect(container.querySelectorAll(".overlay__box--highlighted")).toHaveLength(0);

    await user.hover(boxes[0]);
    expect(items[0]).toHaveClass("is-highlighted");
    await user.unhover(boxes[0]);
    expect(container.querySelectorAll(".is-highlighted")).toHaveLength(0);
  });

  it("M3-view-14: each preview object URL is released when replaced and on unmount", async () => {
    mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    const { unmount } = render(<DetectionView />);
    const a = jpegFile("a.jpg");
    const b = jpegFile("b.jpg");

    await pick(user, a);
    await screen.findByTestId("person-count");
    await pick(user, b);
    await screen.findByRole("img", { name: "b.jpg" });

    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(urls.create).toHaveBeenNthCalledWith(1, a);
    expect(urls.create).toHaveBeenNthCalledWith(2, b);
    expect(urls.revoke).toHaveBeenCalledWith("blob:mock/1");
    expect(urls.revoke).not.toHaveBeenCalledWith("blob:mock/2");

    unmount();
    expect(urls.revoke).toHaveBeenCalledWith("blob:mock/2");
  });

  it("M3-view-15 [OQ-1]: the uploader stays enabled while a detection is in flight", async () => {
    const fetchMock = mockFetch({
      detect: inOrder(deferred().promise, () => jsonResponse(D2)),
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await pick(user, jpegFile("slow.jpg"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(chooseButton()).toBeEnabled();

    await pick(user, jpegFile("zidane.jpg"));

    await waitFor(() => expect(callsTo(fetchMock, "/detect")).toHaveLength(2));
    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^2$/);
  });

  it("M3-view-16: choosing a demo sample runs a detection on it", async () => {
    const fetchMock = mockFetch({
      manifest: [{ file: "zidane.jpg", label: "Two people" }],
      detect: () => jsonResponse(D2),
    });
    const user = userEvent.setup();
    render(<DetectionView />);

    await user.click(await screen.findByRole("button", { name: "Two people" }));

    expect(await screen.findByTestId("person-count")).toHaveTextContent(/^2$/);
    const urlsCalled = fetchMock.mock.calls.map(([url]) => String(url));
    const sampleAt = urlsCalled.indexOf("/samples/zidane.jpg");
    const detectAt = urlsCalled.findIndex((url) => url.includes("/detect"));
    expect(sampleAt).toBeGreaterThanOrEqual(0);
    expect(detectAt).toBeGreaterThan(sampleAt);
    expect(fetchMock.mock.calls[detectAt][1].body.get("image").name).toBe("zidane.jpg");
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "zidane.jpg" })).toBeInTheDocument();
    expect(within(summary()).getAllByRole("listitem")).toHaveLength(2);
  });
});
