import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageUploader from "./ImageUploader.jsx";
import {
  deferred,
  flush,
  JPEG_BYTES,
  jpegFile,
  jsonResponse,
  mockFetch,
} from "../test/helpers.js";

const TWO_PEOPLE = { file: "zidane.jpg", label: "Two people" };
const BUS = { file: "bus.jpg", label: "Street with bus" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageUploader", () => {
  it("M3-upl-01: builds sample buttons from the manifest, label falling back to file", async () => {
    const fetchMock = mockFetch({ manifest: [BUS, { file: "x.png" }] });

    render(<ImageUploader onSelect={vi.fn()} />);

    const bus = await screen.findByRole("button", { name: "Street with bus" });
    const x = await screen.findByRole("button", { name: "x.png" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/samples/index.json");
    const title = screen.getByText("Or try a sample:");
    for (const button of [bus, x]) {
      expect(title.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it.each([
    ["404", () => new Response("not found", { status: 404 })],
    [
      "fetch rejects",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    ["200 {} (not an array)", () => jsonResponse({})],
    [
      "200 HTML body",
      () =>
        new Response("<!doctype html><html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ],
  ])("M3-upl-02: manifest %s hides the sample row silently", async (_name, manifest) => {
    const fetchMock = mockFetch({ manifest: async () => manifest() });

    render(<ImageUploader onSelect={vi.fn()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(flush);

    expect(screen.queryByText("Or try a sample:")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/couldn't|error|failed/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Choose an image" })).toBeEnabled();
  });

  it("M3-upl-03: picking a file calls onSelect, and the same file can be picked again", async () => {
    mockFetch();
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);
    const input = screen.getByTestId("file-input");
    const file = jpegFile("a.jpg");

    expect(input).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(input).toHaveAttribute("type", "file");

    await user.upload(input, file);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(file);
    expect(input.value).toBe("");

    await user.upload(input, file);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("M3-upl-04: the Choose an image button opens the file dialog", () => {
    mockFetch();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    render(<ImageUploader onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose an image" }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy.mock.contexts[0]).toBe(screen.getByTestId("file-input"));
  });

  it("M3-upl-05: drag-and-drop shows an active state and selects the first file", () => {
    mockFetch();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);
    const dropzone = screen.getByTestId("dropzone");
    const a = jpegFile("a.jpg");
    const b = new File([JPEG_BYTES], "b.png", { type: "image/png" });

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveClass("dropzone--active");
    fireEvent.dragLeave(dropzone);
    expect(dropzone).not.toHaveClass("dropzone--active");

    fireEvent.drop(dropzone, { dataTransfer: { files: [a, b] } });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(a);
    expect(dropzone).not.toHaveClass("dropzone--active");

    fireEvent.drop(dropzone, { dataTransfer: { files: [] } });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("M3-upl-06: clicking a sample fetches it and selects a named image File", async () => {
    const fetchMock = mockFetch({ manifest: [TWO_PEOPLE] });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await user.click(await screen.findByRole("button", { name: "Two people" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/samples/zidane.jpg");
    const selected = onSelect.mock.calls[0][0];
    expect(selected).toBeInstanceOf(File);
    expect(selected.name).toBe("zidane.jpg");
    expect(selected.type).toBe("image/jpeg");
    expect(selected.size).toBe(JPEG_BYTES.length);
  });

  it.each([
    ["404", () => new Response("not found", { status: 404 })],
    [
      "fetch rejects",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])(
    "M3-upl-07: a sample that fails to load (%s) shows an inline message until the next success",
    async (_name, failing) => {
      mockFetch({ manifest: [TWO_PEOPLE, BUS], samples: { "zidane.jpg": async () => failing() } });
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<ImageUploader onSelect={onSelect} />);

      await user.click(await screen.findByRole("button", { name: "Two people" }));
      expect(
        await screen.findByText('Couldn\'t load the sample "Two people".'),
      ).toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Street with bus" }));
      await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
      expect(onSelect.mock.calls[0][0].name).toBe("bus.jpg");
      expect(screen.queryByText(/Couldn't load the sample/)).toBeNull();
    },
  );

  it("M3-upl-07b [OQ-3]: a sample served as non-image (HTML) counts as a failed load", async () => {
    mockFetch({
      manifest: [TWO_PEOPLE],
      samples: {
        "zidane.jpg": () =>
          new Response("<!doctype html><html></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      },
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await user.click(await screen.findByRole("button", { name: "Two people" }));
    await act(flush);

    expect(screen.getByText('Couldn\'t load the sample "Two people".')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("M3-upl-08: when disabled, every input path is inert", async () => {
    mockFetch({ manifest: [TWO_PEOPLE] });
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} disabled />);
    const sample = await screen.findByRole("button", { name: "Two people" });
    const dropzone = screen.getByTestId("dropzone");

    expect(screen.getByRole("button", { name: "Choose an image" })).toBeDisabled();
    expect(sample).toBeDisabled();
    expect(dropzone).toHaveClass("dropzone--disabled");

    fireEvent.dragOver(dropzone);
    expect(dropzone).not.toHaveClass("dropzone--active");

    fireEvent.drop(dropzone, { dataTransfer: { files: [jpegFile("a.jpg")] } });
    fireEvent.change(screen.getByTestId("file-input"), {
      target: { files: [jpegFile("b.jpg")] },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("M3-upl-09 [OQ-2]: a late sample download does not select after a newer pick or disable", async () => {
    const sampleFetch = deferred();
    mockFetch({ manifest: [TWO_PEOPLE], samples: { "zidane.jpg": () => sampleFetch.promise } });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<ImageUploader onSelect={onSelect} />);
    const b = jpegFile("b.jpg");

    await user.click(await screen.findByRole("button", { name: "Two people" }));
    await user.upload(screen.getByTestId("file-input"), b);
    expect(onSelect).toHaveBeenCalledWith(b);

    rerender(<ImageUploader onSelect={onSelect} disabled />);
    await act(async () => {
      sampleFetch.resolve(
        new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } }),
      );
      await flush();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(b);
  });

  it("M3-upl-10: the dropzone states accepted formats and size limit", () => {
    mockFetch();
    render(<ImageUploader onSelect={vi.fn()} />);

    expect(screen.getByText("JPEG or PNG, up to 10 MB")).toBeInTheDocument();
  });
});
