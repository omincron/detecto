// Browser-side upload pre-check (M3b-pre-*) and its interplay with latest-request-wins
// (M3b-race-*), using the real ImageUploader.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetectionView from "./DetectionView.jsx";
import {
  callsTo,
  D2,
  deferred,
  flush,
  JPEG_BYTES,
  jpegFile,
  jsonResponse,
  mockFetch,
  stubObjectUrls,
  unstubObjectUrls,
} from "../test/helpers.js";

const MiB = 1048576;
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);

const images = (container) => [...container.querySelectorAll("img")];
const summary = () => screen.queryByRole("region", { name: "Detection summary" });
const typeMessage = (type) => `Only JPEG and PNG images are supported (this file is ${type}).`;

/** /detect handler that answers each call with the next item (a Response factory or a promise). */
const inOrder = (...answers) => {
  const queue = [...answers];
  return () => {
    const next = queue.shift();
    return typeof next === "function" ? next() : next;
  };
};

const fileOf = (name, type, content = ["x"]) => new File(content, name, { type });

function sized(name, size, type = "image/jpeg") {
  const file = new File([JPEG_BYTES], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

async function pick(user, file) {
  await user.upload(screen.getByTestId("file-input"), file);
}

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

function expectNoResult(container) {
  expect(images(container)).toHaveLength(0);
  expect(screen.queryAllByTestId("bounding-box")).toHaveLength(0);
  expect(summary()).toBeNull();
  expect(screen.queryByTestId("person-count")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
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

describe("DetectionView upload pre-check", () => {
  it.each([
    ["notes.txt", "text/plain"],
    ["anim.gif", "image/gif"],
    ["photo.webp", "image/webp"],
    ["IMG_1.HEIC", "image/heic"],
  ])("M3b-pre-01: %s (%s) is rejected in the browser at once", async (name, type) => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);

    await pick(user, fileOf(name, type));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAccessibleName(`Couldn't analyse ${name}.`);
    expect(alert).toHaveTextContent(typeMessage(type));
    expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
    expect(urls.create).not.toHaveBeenCalled();
    expectNoResult(container);
    expect(screen.getByRole("button", { name: "Choose an image" })).toBeEnabled();
  });

  it("M3b-pre-02: an empty file is rejected in the browser", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);

    await pick(user, fileOf("empty.jpg", "image/jpeg", []));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAccessibleName("Couldn't analyse empty.jpg.");
    expect(alert).toHaveTextContent("This file is empty.");
    expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
    expect(urls.create).not.toHaveBeenCalled();
    expectNoResult(container);
  });

  it("M3b-pre-03: exactly 10 MiB is uploaded, one byte more is rejected", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup();
    render(<DetectionView />);
    await act(flush);

    await pick(user, sized("over.jpg", 10485761));
    expect(screen.getByRole("alert")).toHaveTextContent("This file is larger than the 10 MB limit.");
    expect(callsTo(fetchMock, "/detect")).toHaveLength(0);

    const exact = sized("exact.jpg", 10485760);
    await pick(user, exact);
    const detectCalls = callsTo(fetchMock, "/detect");
    expect(detectCalls).toHaveLength(1);
    expect(detectCalls[0][1].body.get("image")).toBe(exact);
    expect(await screen.findByTestId("person-count")).toHaveTextContent("2");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("M3b-pre-04: every selection path is pre-checked", () => {
    const setup = async () => {
      const fetchMock = mockFetch({
        manifest: [
          { file: "anim.gif", label: "GIF sample" },
          { file: "blank.jpg", label: "Blank" },
        ],
        samples: {
          "anim.gif": () =>
            new Response(GIF_BYTES, { status: 200, headers: { "content-type": "image/gif" } }),
          "blank.jpg": () =>
            new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/jpeg" } }),
        },
        detect: () => jsonResponse(D2),
      });
      render(<DetectionView />);
      await act(flush);
      return fetchMock;
    };

    it("M3b-pre-04a: drag-and-drop", async () => {
      const fetchMock = await setup();
      fireEvent.drop(screen.getByTestId("dropzone"), {
        dataTransfer: { files: [fileOf("anim.gif", "image/gif", [GIF_BYTES])] },
      });
      await act(flush);

      expect(screen.getByRole("alert")).toHaveTextContent(typeMessage("image/gif"));
      expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
      expect(screen.queryByText(/Couldn't load the sample/)).toBeNull();
    });

    it("M3b-pre-04b: a GIF demo sample", async () => {
      const fetchMock = await setup();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "GIF sample" }));
      await act(flush);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveAccessibleName("Couldn't analyse anim.gif.");
      expect(alert).toHaveTextContent("(this file is image/gif)");
      expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
      expect(screen.queryByText(/Couldn't load the sample/)).toBeNull();
    });

    it("M3b-pre-04c: an empty demo sample", async () => {
      const fetchMock = await setup();
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Blank" }));
      await act(flush);

      expect(screen.getByRole("alert")).toHaveTextContent("This file is empty.");
      expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
      expect(screen.queryByText(/Couldn't load the sample/)).toBeNull();
    });
  });

  it.each([
    ["a", "415", () => jsonResponse({ detail: "Unsupported image format: unrecognized. Only JPEG and PNG are accepted" }, 415)],
    ["b", "D2", () => jsonResponse(D2)],
  ])("M3b-pre-05%s: an empty declared type passes to the backend (%s)", async (variant, _label, answer) => {
    const pending = deferred();
    const fetchMock = mockFetch({ detect: () => pending.promise });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);
    await act(flush);

    await pick(user, fileOf("camera-dump", ""));

    const detectCalls = callsTo(fetchMock, "/detect");
    expect(detectCalls).toHaveLength(1);
    expect(detectCalls[0][1].body.get("image").name).toBe("camera-dump");
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => {
      pending.resolve(answer());
      await flush();
    });
    if (variant === "a") {
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't analyse camera-dump.");
      expect(alert).toHaveTextContent(
        "Unsupported image format: unrecognized. Only JPEG and PNG are accepted",
      );
    } else {
      expect(await screen.findByTestId("person-count")).toHaveTextContent("2");
    }
  });

  it.each([
    [
      "fake.jpg",
      () => new File([GIF_BYTES], "fake.jpg", { type: "image/jpeg" }),
      415,
      "Unsupported image format: GIF. Only JPEG and PNG are accepted",
    ],
    [
      "corrupt.png",
      () => new File([new Uint8Array([3, 141, 59, 26, 5, 89, 79, 32, 38, 46])], "corrupt.png", { type: "image/png" }),
      400,
      "Could not decode image — unsupported or corrupt file",
    ],
    ["huge.jpg", () => new File(["x"], "huge.jpg", { type: "image/jpeg" }), 413, "File too large (max 10 MB)"],
    ["ok.jpg", () => jpegFile("ok.jpg"), 500, "Inference failed: boom"],
  ])("M3b-pre-06: %s passes the pre-check and shows the backend's message", async (name, make, status, detail) => {
    const fetchMock = mockFetch({ detect: () => jsonResponse({ detail }, status) });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);
    const file = make();

    await pick(user, file);

    const alert = await screen.findByRole("alert");
    const detectCalls = callsTo(fetchMock, "/detect");
    expect(detectCalls).toHaveLength(1);
    const sent = detectCalls[0][1].body.get("image");
    expect([sent.name, sent.size, sent.type]).toEqual([file.name, file.size, file.type]);
    expect(alert).toHaveTextContent(`Couldn't analyse ${name}.`);
    expect(alert).toHaveTextContent(detail);
    expectNoResult(container);
  });

  it("M3b-pre-07: a rejection after a result clears it and releases the preview URL", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);

    await pick(user, jpegFile("a.jpg"));
    await screen.findByTestId("person-count");
    await user.hover(screen.getAllByRole("listitem")[1]);

    await pick(user, fileOf("notes.txt", "text/plain"));

    expect(screen.getByRole("alert")).toHaveTextContent(typeMessage("text/plain"));
    expectNoResult(container);
    expect(urls.revoke).toHaveBeenCalledWith("blob:mock/1");
    expect(urls.create).toHaveBeenCalledTimes(1);
    expect(callsTo(fetchMock, "/detect")).toHaveLength(1);
  });

  it("M3b-pre-08a: after a pre-check rejection, a valid image shows its result", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);
    await act(flush);

    await pick(user, fileOf("notes.txt", "text/plain"));
    await pick(user, jpegFile("zidane.jpg"));

    expect(await screen.findByTestId("person-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(callsTo(fetchMock, "/detect")).toHaveLength(1);
  });

  it("M3b-pre-08b: after a backend rejection, a valid image shows its result", async () => {
    const fetchMock = mockFetch({
      detect: inOrder(
        () => jsonResponse({ detail: "Unsupported image format: GIF. Only JPEG and PNG are accepted" }, 415),
        () => jsonResponse(D2),
      ),
    });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);
    await act(flush);

    await pick(user, new File([GIF_BYTES], "fake.jpg", { type: "image/jpeg" }));
    await screen.findByRole("alert");
    await pick(user, jpegFile("zidane.jpg"));

    expect(await screen.findByTestId("person-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(callsTo(fetchMock, "/detect")).toHaveLength(2);
  });

  it("M3b-pre-09: consecutive rejections each replace the alert", async () => {
    const fetchMock = mockFetch({ detect: () => jsonResponse(D2) });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);
    await act(flush);

    await pick(user, fileOf("anim.gif", "image/gif"));
    expect(screen.getByRole("alert")).toHaveAccessibleName("Couldn't analyse anim.gif.");

    for (let i = 0; i < 2; i++) {
      await pick(user, fileOf("empty.jpg", "image/jpeg", []));
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveAccessibleName("Couldn't analyse empty.jpg.");
      expect(alerts[0]).toHaveTextContent("This file is empty.");
      expect(alerts[0].textContent).not.toContain("anim.gif");
      expect(alerts[0].textContent).not.toContain("image/gif");
    }
    expect(callsTo(fetchMock, "/detect")).toHaveLength(0);
  });
});

describe("DetectionView pre-check and latest-request-wins", () => {
  it("M3b-race-01: a rejected pick supersedes an in-flight detection", async () => {
    const first = deferred();
    const fetchMock = mockFetch({ detect: () => first.promise });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);

    await pick(user, jpegFile("a.jpg"));
    expect(screen.getByRole("status")).toBeInTheDocument();

    await pick(user, fileOf("notes.txt", "text/plain"));
    expect(screen.getByRole("alert")).toHaveAccessibleName("Couldn't analyse notes.txt.");
    expect(screen.queryByRole("status")).toBeNull();
    expect(images(container)).toHaveLength(0);

    await act(async () => {
      first.resolve(jsonResponse(D2));
      await flush();
    });
    expect(screen.getByRole("alert")).toHaveAccessibleName("Couldn't analyse notes.txt.");
    expectNoResult(container);
    expect(callsTo(fetchMock, "/detect")).toHaveLength(1);
  });

  it("M3b-race-02: a late error from the superseded request keeps the pre-check message", async () => {
    const first = deferred();
    mockFetch({ detect: () => first.promise });
    const user = userEvent.setup({ applyAccept: false });
    render(<DetectionView />);
    await act(flush);

    await pick(user, jpegFile("a.jpg"));
    await pick(user, fileOf("empty.jpg", "image/jpeg", []));
    await act(async () => {
      first.resolve(jsonResponse({ detail: "Inference failed: boom" }, 500));
      await flush();
    });

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveAccessibleName("Couldn't analyse empty.jpg.");
    expect(alerts[0]).toHaveTextContent("This file is empty.");
    expect(document.body.textContent).not.toContain("Inference failed");
  });

  it.each([
    ["A then C", ["a.jpg", "c.jpg"]],
    ["C then A", ["c.jpg", "a.jpg"]],
  ])("M3b-race-03: valid → rejected → valid shows only the last result (%s)", async (_label, order) => {
    const pending = { "a.jpg": deferred(), "c.jpg": deferred() };
    const answers = { "a.jpg": () => resultWith(1), "c.jpg": () => resultWith(3) };
    mockFetch({ detect: (_url, options) => pending[options.body.get("image").name].promise });
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<DetectionView />);
    await act(flush);
    const a = jpegFile("a.jpg");
    const notes = fileOf("notes.txt", "text/plain");
    const c = jpegFile("c.jpg");

    await pick(user, a);
    await pick(user, notes);
    await pick(user, c);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(images(container).map((img) => img.getAttribute("src"))).toEqual(["blob:mock/2"]);

    for (const name of order) {
      await act(async () => {
        pending[name].resolve(answers[name]());
        await flush();
      });
      if (name === order[0] && name === "a.jpg") {
        expect(screen.queryByTestId("person-count")).toBeNull(); // A alone changes nothing
        expect(screen.getByRole("status")).toBeInTheDocument();
      }
    }

    expect(screen.getByTestId("person-count")).toHaveTextContent("3");
    expect(screen.getAllByTestId("bounding-box")).toHaveLength(3);
    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(urls.create.mock.calls.map(([file]) => file)).toEqual([a, c]);
    expect(urls.revoke).toHaveBeenCalledWith("blob:mock/1");
  });
});
