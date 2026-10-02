// M5: ImageUploader's searchable Select for more than 4 samples (test-plans/milestone-5.md).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageUploader from "./ImageUploader.jsx";
import { theme } from "../theme.js";
import { callsTo, deferred, flush, JPEG_BYTES, jpegFile, mockFetch } from "../test/helpers.js";

const NAME = "Try a sample image";

const ONE = { file: "coco-96493.jpg", label: "One person" };
const NIGHT_DINNER = { file: "coco-389109.jpg", label: "Night dinner" };
const NIGHT_STREET = { file: "coco-538364.jpg", label: "Night street" };
const BEACH = { file: "coco-274460.jpg", label: "Beach group" };
const KITCHEN = { file: "coco-34873.jpg", label: "Kitchen (no people)" };
const FIVE = [ONE, NIGHT_DINNER, NIGHT_STREET, BEACH, KITCHEN];

const SHIPPED_MANIFEST = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../public/samples/index.json"),
    "utf8",
  ),
);

/** fetch calls for sample images (not the manifest). */
const sampleDownloads = (fetchMock) =>
  callsTo(fetchMock, "/samples/").filter(([url]) => String(url) !== "/samples/index.json");

// Mantine's test env: no dropdown transitions (jsdom never finishes them) and no portal.
function TestProviders({ children }) {
  return (
    <MantineProvider theme={theme} forceColorScheme="light" env="test">
      {children}
    </MantineProvider>
  );
}
const render = (ui) => rtlRender(ui, { wrapper: TestProviders });

const findCombobox = () => screen.findByRole("combobox", { name: NAME });

async function openAndPick(user, label) {
  await user.click(await findCombobox());
  const listbox = await screen.findByRole("listbox", { name: NAME });
  await user.click(within(listbox).getByRole("option", { name: label }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageUploader sample Select", () => {
  it("M5-upl-01: with exactly 4 samples, chips are shown and there is no combobox", async () => {
    const four = FIVE.slice(0, 4);
    mockFetch({ manifest: four });
    render(<ImageUploader onSelect={vi.fn()} />);

    for (const sample of four) {
      expect(await screen.findByRole("button", { name: sample.label })).toBeInTheDocument();
    }
    expect(screen.getByText("Or try a sample:")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: NAME })).toBeNull();
  });

  it("M5-upl-02: with 5 samples, one combobox replaces the chips", async () => {
    mockFetch({ manifest: FIVE });
    render(<ImageUploader onSelect={vi.fn()} />);

    const combobox = await findCombobox();
    expect(combobox).toHaveAttribute("placeholder", "Or try a sample…");
    for (const sample of FIVE) {
      expect(screen.queryByRole("button", { name: sample.label })).toBeNull();
    }
    expect(screen.queryByText("Or try a sample:")).toBeNull();
    expect(screen.getByRole("button", { name: "Choose an image" })).toBeInTheDocument();
  });

  it("M5-upl-03: opening the combobox lists every sample, label falling back to file", async () => {
    const manifest = [ONE, NIGHT_DINNER, { file: "x.png" }, BEACH, KITCHEN];
    mockFetch({ manifest });
    const user = userEvent.setup();
    render(<ImageUploader onSelect={vi.fn()} />);

    await user.click(await findCombobox());
    const listbox = await screen.findByRole("listbox", { name: NAME });

    const names = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(names).toEqual(["One person", "Night dinner", "x.png", "Beach group", "Kitchen (no people)"]);
  });

  it("M5-upl-04: clicking an option downloads that sample and selects a named File", async () => {
    const fetchMock = mockFetch({ manifest: FIVE });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await openAndPick(user, "Beach group");

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/samples/coco-274460.jpg");
    const selected = onSelect.mock.calls[0][0];
    expect(selected).toBeInstanceOf(File);
    expect(selected.name).toBe("coco-274460.jpg");
    expect(selected.type.startsWith("image/")).toBe(true);
  });

  it.each([
    ["night", NIGHT_DINNER.file],
    ["beach", BEACH.file],
  ])("M5-upl-05: typing %j and Enter loads the first match", async (query, file) => {
    mockFetch({ manifest: FIVE });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await user.type(await findCombobox(), `${query}{Enter}`);

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0][0].name).toBe(file);
  });

  it("M5-upl-06: a search with no match plus Enter loads nothing and shows no error", async () => {
    const fetchMock = mockFetch({ manifest: FIVE });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await user.type(await findCombobox(), "zzz{Enter}");
    await act(flush);

    expect(onSelect).not.toHaveBeenCalled();
    expect(sampleDownloads(fetchMock)).toHaveLength(0);
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("M5-upl-07: after a click pick the Select is empty, and the same sample loads again", async () => {
    mockFetch({ manifest: FIVE });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await openAndPick(user, "Beach group");
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const combobox = screen.getByRole("combobox", { name: NAME });
    expect(combobox).toHaveValue("");

    await user.click(combobox);
    const listbox = await screen.findByRole("listbox", { name: NAME });
    for (const option of within(listbox).getAllByRole("option")) {
      expect(option).not.toHaveAttribute("aria-selected", "true");
    }
    await user.click(within(listbox).getByRole("option", { name: "Beach group" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
    expect(onSelect.mock.calls[1][0].name).toBe(BEACH.file);
  });

  it("M5-upl-07 [OQ-3]: after type + Enter the search text is cleared without a blur", async () => {
    mockFetch({ manifest: FIVE });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);
    const combobox = await findCombobox();

    await user.type(combobox, "beach{Enter}");

    expect(combobox).toHaveValue("");
    expect(combobox).toHaveFocus();
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));

    await user.type(combobox, "beach{Enter}");
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(2));
    expect(onSelect.mock.calls[1][0].name).toBe(BEACH.file);
  });

  it("M5-upl-08: when disabled, the Select is inert by click and keyboard", async () => {
    const fetchMock = mockFetch({ manifest: FIVE });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} disabled />);
    const combobox = await findCombobox();

    expect(combobox).toBeDisabled();
    await user.click(combobox);
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.type(combobox, "beach{Enter}");
    await act(flush);
    expect(onSelect).not.toHaveBeenCalled();
    expect(sampleDownloads(fetchMock)).toHaveLength(0);
  });

  it("M5-upl-09: a late Select download is dropped after disabling", async () => {
    const download = deferred();
    mockFetch({ manifest: FIVE, samples: { [BEACH.file]: () => download.promise } });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<ImageUploader onSelect={onSelect} />);

    await openAndPick(user, "Beach group");
    rerender(<ImageUploader onSelect={onSelect} disabled />);
    await act(async () => {
      download.resolve(
        new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } }),
      );
      await flush();
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("M5-upl-09: a late Select download is dropped after a newer file pick", async () => {
    const download = deferred();
    mockFetch({ manifest: FIVE, samples: { [BEACH.file]: () => download.promise } });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);
    const chosen = jpegFile("chosen.jpg");

    await openAndPick(user, "Beach group");
    await user.upload(screen.getByTestId("file-input"), chosen);
    await act(async () => {
      download.resolve(
        new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } }),
      );
      await flush();
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(chosen);
  });

  it("M5-upl-10: a failed download from the Select shows the chip error text", async () => {
    mockFetch({
      manifest: FIVE,
      samples: { [BEACH.file]: () => new Response("not found", { status: 404 }) },
    });
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ImageUploader onSelect={onSelect} />);

    await openAndPick(user, "Beach group");

    expect(await screen.findByText('Couldn\'t load the sample "Beach group".')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("M5-upl-11: the shipped manifest takes the Select path", async () => {
    mockFetch({ manifest: SHIPPED_MANIFEST });
    const user = userEvent.setup();
    render(<ImageUploader onSelect={vi.fn()} />);

    await user.click(await findCombobox());
    const listbox = await screen.findByRole("listbox", { name: NAME });

    expect(within(listbox).getAllByRole("option")).toHaveLength(16);
    for (const sample of SHIPPED_MANIFEST) {
      expect(screen.queryByRole("button", { name: sample.label })).toBeNull();
    }
  });
});
