import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import HistoryTable from "./HistoryTable.jsx";
import { many, pinTimeZone, R4, raw, refFormat, toRecord } from "../test/helpers.js";

const section = () => screen.getByRole("region", { name: "Records" });
const bodyRows = () => within(section()).getAllByRole("row").slice(1);
const cells = (row) => within(row).getAllByRole("cell").map((c) => c.textContent);
const pageButton = (n) => within(section()).getByRole("button", { name: String(n) });
const records = (n) => many(n).map(toRecord);

describe("HistoryTable at Asia/Riyadh", () => {
  const m = pinTimeZone("Asia/Riyadh", async () => ({
    HistoryTable: (await import("./HistoryTable.jsx")).default,
  }));

  it("M4-table-01: newest first, four columns, local time with a UTC datetime", () => {
    const { HistoryTable: Table } = m;
    render(<Table records={R4.map(toRecord)} />);

    expect(within(section()).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Time",
      "People",
      "Avg confidence",
      "Model time",
    ]);
    expect(bodyRows().map((row) => cells(row)[1])).toEqual(["1", "5", "0", "2"]);
    const time = bodyRows()[0].querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-10-02T11:05:09.563Z");
    expect(time.textContent).toBe(refFormat(new Date("2026-10-02T11:05:09.563Z"), "Asia/Riyadh"));
  });
});

describe("HistoryTable", () => {
  it("M4-table-02: confidence as a rounded percentage, model time with formatMs units", () => {
    render(
      <HistoryTable
        records={[
          raw(1, "2026-10-02T09:00:00Z", 2, 0.8, 142.3),
          raw(2, "2026-10-02T09:01:00Z", 1, 0.62, 1234),
        ].map(toRecord)}
      />,
    );

    const [newer, older] = bodyRows().map(cells);
    expect(older.slice(2)).toEqual(["80%", "142 ms"]);
    expect(newer.slice(2)).toEqual(["62%", "1.23 s"]);
  });

  it("M4-table-03: a frame with nobody shows 0 people and — for confidence", () => {
    render(<HistoryTable records={[toRecord(R4[1])]} />);

    const [row] = bodyRows().map(cells);
    expect(row[1]).toBe("0");
    expect(row[2]).toBe("—");
  });

  it("M4-table-04: 15 rows per page, pagination only when needed, correct footer", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HistoryTable records={records(33)} />);

    expect(bodyRows()).toHaveLength(15);
    for (const n of [1, 2, 3]) expect(pageButton(n)).toBeInTheDocument();
    expect(pageButton(1)).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("33 records, newest first")).toBeInTheDocument();
    await user.click(pageButton(3));
    expect(bodyRows()).toHaveLength(3);
    expect(bodyRows()[2].querySelector("time")).toHaveAttribute("datetime", "2026-10-02T08:00:00.000Z");

    rerender(<HistoryTable records={records(16)} />);
    expect(pageButton(2)).toBeInTheDocument();
    expect(within(section()).queryByRole("button", { name: "3" })).toBeNull();
    await user.click(pageButton(2));
    expect(bodyRows()).toHaveLength(1);

    rerender(<HistoryTable records={records(15)} />);
    expect(bodyRows()).toHaveLength(15);
    expect(within(section()).queryAllByRole("button")).toHaveLength(0);

    rerender(<HistoryTable records={records(1)} />);
    expect(screen.getByText("1 record, newest first")).toBeInTheDocument();
  });

  it("M4-table-05: a new result set starts again at page 1", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<HistoryTable records={records(33)} />);
    await user.click(pageButton(3));
    expect(pageButton(3)).toHaveAttribute("aria-current", "page");

    rerender(<HistoryTable records={records(40)} />);

    expect(pageButton(1)).toHaveAttribute("aria-current", "page");
    expect(bodyRows()[0].querySelector("time")).toHaveAttribute(
      "datetime",
      toRecord(many(40)[39]).timestamp.toISOString(),
    );
  });

  it("M4-table-06: every pagination control has an accessible name [OQ-4]", () => {
    // OQ-4 (app change agreed, not made yet): previous/next are "Previous page"/"Next page".
    render(<HistoryTable records={records(33)} />);

    for (const button of within(section()).getAllByRole("button")) {
      expect(button).toHaveAccessibleName();
    }
    expect(within(section()).getByRole("button", { name: "Previous page" })).toBeInTheDocument();
    expect(within(section()).getByRole("button", { name: "Next page" })).toBeInTheDocument();
  });
});
