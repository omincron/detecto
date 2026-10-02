import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FilterBar, { EMPTY_FILTERS } from "./FilterBar.jsx";
import { muteFocusTrapWarning } from "../test/helpers.js";

const RANGE_ERROR = "“From” must be before “To”.";
const form = () => screen.getByRole("form", { name: "Filters" });
const slider = () => screen.getByRole("slider", { name: "Minimum confidence" });

function renderBar(value = EMPTY_FILTERS, props = {}) {
  const spies = { onChange: vi.fn(), onApply: vi.fn(), onReset: vi.fn() };
  const utils = render(<FilterBar value={value} {...spies} {...props} />);
  return { ...utils, ...spies };
}

/** FilterBar whose onChange feeds back into its value. */
function Controlled({ initial = EMPTY_FILTERS, onChange, onApply }) {
  const [value, setValue] = useState(initial);
  return (
    <FilterBar
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      onApply={onApply}
      onReset={() => {}}
    />
  );
}

/** Pin the calendar's current month to Oct 2026 (only Date is faked, userEvent still works). */
function pinToday() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
}

/** Open a picker; resolves to its dropdown (jsdom keeps it display:none, so query with hidden). */
async function openPicker(user, label) {
  const input = screen.getByLabelText(label);
  await user.click(input);
  const dropdown = await waitFor(() => {
    const el = document.getElementById(input.getAttribute("aria-controls"));
    expect(el).not.toBeNull();
    return el;
  });
  return dropdown;
}

/** Open a picker and click the in-month day with this number. */
async function pickDay(user, label, day) {
  const dropdown = await openPicker(user, label);
  const dayButton = await waitFor(() => {
    const found = [...dropdown.querySelectorAll(".mantine-DateTimePicker-day")].find(
      (el) => !el.hasAttribute("data-outside") && el.textContent === String(day),
    );
    expect(found).toBeDefined();
    return found;
  });
  await user.click(dayButton);
}

beforeEach(() => {
  muteFocusTrapWarning();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FilterBar", () => {
  it("M4-filter-01: labelled pickers, named slider, hint, Apply and Reset in a Filters form", () => {
    const { rerender, onChange, onApply, onReset } = renderBar();

    expect(form()).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveTextContent("Any time");
    expect(screen.getByLabelText("To")).toHaveTextContent("Now");
    expect(slider()).toHaveAttribute("aria-valuemin", "0");
    expect(slider()).toHaveAttribute("aria-valuemax", "100");
    expect(slider()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("Any")).toBeInTheDocument();
    expect(screen.getByText("Frames with nobody present are always shown.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute("type", "submit");
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

    rerender(
      <FilterBar
        value={{ ...EMPTY_FILTERS, minConfidencePct: 85 }}
        onChange={onChange}
        onApply={onApply}
        onReset={onReset}
      />,
    );
    expect(slider()).toHaveAttribute("aria-valuenow", "85");
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("M4-a11y-01: the focusable thumb (role=slider) carries the name", () => {
    renderBar();

    const thumb = slider();
    expect(thumb).toHaveAttribute("tabindex", "0");
    expect(thumb).toHaveAccessibleName("Minimum confidence");
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("M4-filter-02: the slider changes only the draft, in steps of 5", async () => {
    const onChange = vi.fn();
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} onApply={onApply} />);

    slider().focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith({ from: null, to: null, minConfidencePct: 5 });
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ from: null, to: null, minConfidencePct: 100 });
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith({ from: null, to: null, minConfidencePct: 0 });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("M4-filter-03: picking a day in From sets that local day at 00:00", async () => {
    pinToday();
    const user = userEvent.setup();
    const { onChange, onApply } = renderBar();

    await pickDay(user, "From", 15);

    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-15 00:00:00", to: null, minConfidencePct: 0 });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("M4-filter-04: Apply (click or submit) calls onApply; Reset calls onReset", async () => {
    const user = userEvent.setup();
    const { onApply, onReset } = renderBar({
      from: "2026-10-02 09:00:00",
      to: "2026-10-02 10:00:00",
      minConfidencePct: 50,
    });

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.submit(form());
    expect(onApply).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(2);
  });

  it("M4-filter-05: an inverted or empty range shows an error, disables Apply and blocks submit", () => {
    const spies = { onChange: vi.fn(), onApply: vi.fn(), onReset: vi.fn() };
    const { rerender } = render(
      <FilterBar value={{ from: "2026-10-02 10:00:00", to: "2026-10-02 09:00:00", minConfidencePct: 0 }} {...spies} />,
    );
    expect(screen.getByText(RANGE_ERROR)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.submit(form());
    expect(spies.onApply).not.toHaveBeenCalled();

    // OQ-2: "To" is inclusive of its minute, so the empty range is From one minute after
    // To (start == end on the API side); From == To is a valid one-minute range.
    rerender(
      <FilterBar value={{ from: "2026-10-02 10:00:00", to: "2026-10-02 09:59:00", minConfidencePct: 0 }} {...spies} />,
    );
    expect(screen.getByText(RANGE_ERROR)).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.submit(form());
    expect(spies.onApply).not.toHaveBeenCalled();

    rerender(
      <FilterBar value={{ from: "2026-10-02 10:00:00", to: "2026-10-02 10:00:00", minConfidencePct: 0 }} {...spies} />,
    );
    expect(screen.queryByText(RANGE_ERROR)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

    rerender(
      <FilterBar value={{ from: "2026-10-02 09:00:00", to: "2026-10-02 10:00:00", minConfidencePct: 0 }} {...spies} />,
    );
    expect(screen.queryByText(RANGE_ERROR)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("M4-filter-06: while loading, Apply shows loading and is disabled; Reset is disabled", () => {
    renderBar(EMPTY_FILTERS, { loading: true });

    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toHaveAttribute("data-loading", "true");
    expect(apply).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("M4-filter-07: picking a day in To gives that day at 23:59; a time edit doesn't snap [OQ-2]", async () => {
    // OQ-2 (app change agreed, not made yet): a picked To day becomes 23:59 of that day.
    pinToday();
    const user = userEvent.setup();
    const { onChange, unmount } = renderBar();

    await pickDay(user, "To", 15);
    expect(onChange).toHaveBeenLastCalledWith({ from: null, to: "2026-10-15 23:59:00", minConfidencePct: 0 });
    unmount();

    // Editing only the time of an existing To keeps the time the user set.
    const edit = vi.fn();
    render(<Controlled initial={{ ...EMPTY_FILTERS, to: "2026-10-15 14:30:00" }} onChange={edit} onApply={() => {}} />);
    const dropdown = await openPicker(user, "To");
    const [hours] = await waitFor(() => within(dropdown).getAllByRole("spinbutton", { hidden: true }));
    await user.click(hours);
    await user.keyboard("{ArrowUp}");
    await user.click(dropdown.querySelector(".mantine-DateTimePicker-submitButton"));
    expect(edit).toHaveBeenCalled();
    expect(edit.mock.lastCall[0].to).toBe("2026-10-15 15:30:00");
  });
});
