import { describe, expect, it } from "vitest";
import { buildHistoryParams, summarize } from "./history.js";
import { pinTimeZone, R4, refFormat, toRecord } from "../test/helpers.js";

const loadHistory = () => import("./history.js");
const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RANGE_ERROR = "“From” must be before “To”.";

describe("toApiInstant at Asia/Riyadh", () => {
  const h = pinTimeZone("Asia/Riyadh", loadHistory);

  it("M4-tz-01: UTC+3 maps to 3 hours earlier, midnight to the previous UTC day", () => {
    expect(h.toApiInstant("2026-10-02 08:00:00")).toBe("2026-10-02T05:00:00.000Z");
    expect(h.toApiInstant("2026-10-02 00:00:00")).toBe("2026-10-01T21:00:00.000Z");
    expect(h.toApiInstant("2026-10-02 02:59:00")).toBe("2026-10-01T23:59:00.000Z");
  });

  it("M4-tz-06: always a full UTC instant with Z; empty or unparseable gives null", () => {
    for (const value of ["2026-10-02 08:00:00", "2026-10-02 00:00:00", "2026-10-02 02:59:00"]) {
      expect(h.toApiInstant(value)).toMatch(ISO_Z);
    }
    for (const value of [null, undefined, "", "garbage"]) {
      expect(h.toApiInstant(value)).toBeNull();
    }
  });

  it("M4-params-02: From/To become UTC instants of local wall-clock time, never bare dates", () => {
    expect(
      h.buildHistoryParams({ from: "2026-10-02 00:00:00", to: null, minConfidencePct: 0 }),
    ).toEqual({ start_date: "2026-10-01T21:00:00.000Z" });
    // OQ-2: "To" is inclusive of its minute, so end_date = toApiInstant(to) + 60 s.
    // A picked "To" day is 23:59 local, so its end is the next local midnight.
    expect(
      h.buildHistoryParams({ from: null, to: "2026-10-02 23:59:00", minConfidencePct: 0 }),
    ).toEqual({ end_date: "2026-10-02T21:00:00.000Z" });
    expect(
      h.buildHistoryParams({ from: null, to: "2026-10-03 00:00:00", minConfidencePct: 0 }),
    ).toEqual({ end_date: "2026-10-02T21:01:00.000Z" });
    const both = h.buildHistoryParams({
      from: "2026-10-02 00:00:00",
      to: "2026-10-02 23:59:00",
      minConfidencePct: 0,
    });
    expect(Object.keys(both).sort()).toEqual(["end_date", "start_date"]);
    for (const value of Object.values(both)) {
      expect(value).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("toApiInstant at America/New_York", () => {
  const h = pinTimeZone("America/New_York", loadHistory);

  it("M4-tz-02: negative offset, next UTC day, and the summer/winter offset of the date", () => {
    expect(h.toApiInstant("2026-10-02 00:00:00")).toBe("2026-10-02T04:00:00.000Z");
    expect(h.toApiInstant("2026-12-15 20:30:00")).toBe("2026-12-16T01:30:00.000Z");
    expect(h.toApiInstant("2026-03-08 01:59:00")).toBe("2026-03-08T06:59:00.000Z");
    expect(h.toApiInstant("2026-03-08 03:00:00")).toBe("2026-03-08T07:00:00.000Z");
  });

  it("M4-tz-04 (New York): gap and overlap resolve to one defined instant [OQ-8]", () => {
    expect(h.toApiInstant("2026-03-08 02:30:00")).toBe("2026-03-08T07:30:00.000Z");
    expect(h.toApiInstant("2026-11-01 01:30:00")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("M4-range-01: rejected only when both set and From is not strictly before To", () => {
    expect(h.validateRange("2026-10-02 09:00:00", "2026-10-02 10:00:00")).toBeNull();
    // OQ-2: "To" is inclusive of its minute (end = To + 60 s), so From == To is a valid
    // one-minute range, and the first rejected value is From one minute after To.
    expect(h.validateRange("2026-10-02 09:00:00", "2026-10-02 09:00:00")).toBeNull();
    expect(h.validateRange("2026-10-02 09:01:00", "2026-10-02 09:00:00")).toBe(RANGE_ERROR);
    expect(h.validateRange("2026-10-02 10:00:00", "2026-10-02 09:00:00")).toBe(RANGE_ERROR);
    expect(h.validateRange("2026-10-02 09:00:00", null)).toBeNull();
    expect(h.validateRange(null, "2026-10-02 09:00:00")).toBeNull();
    expect(h.validateRange(null, null)).toBeNull();
    expect(h.validateRange("2026-11-01 01:30:00", "2026-11-01 01:45:00")).toBeNull();
  });

  it("M4-fmt-01 (New York): timestamps are local, including the local day", () => {
    const d = new Date("2026-10-02T11:05:09Z");
    expect(h.formatTimestamp(d)).toBe(refFormat(d, "America/New_York"));
    expect(h.formatTimestamp(d)).not.toBe(refFormat(d, "UTC"));
    expect(h.formatTimestamp(new Date("2026-10-02T02:30:00Z"))).toContain("Oct 1");
  });
});

describe("toApiInstant at Europe/Athens", () => {
  const h = pinTimeZone("Europe/Athens", loadHistory);

  it("M4-tz-03: across DST each local time uses the offset in force; a day is 23 or 25 h", () => {
    expect(h.toApiInstant("2026-03-29 02:30:00")).toBe("2026-03-29T00:30:00.000Z");
    expect(h.toApiInstant("2026-03-29 04:30:00")).toBe("2026-03-29T01:30:00.000Z");
    expect(h.toApiInstant("2026-10-25 02:30:00")).toBe("2026-10-24T23:30:00.000Z");
    expect(h.toApiInstant("2026-10-25 04:30:00")).toBe("2026-10-25T02:30:00.000Z");

    const span = (from, to) => {
      const p = h.buildHistoryParams({ from, to, minConfidencePct: 0 });
      return Date.parse(p.end_date) - Date.parse(p.start_date);
    };
    // OQ-2: a whole local day is From 00:00 to To 23:59 (inclusive of its minute), so
    // end_date is the next local midnight: 23 h in spring, 25 h in autumn.
    expect(span("2026-03-29 00:00:00", "2026-03-29 23:59:00")).toBe(82_800_000);
    expect(span("2026-10-25 00:00:00", "2026-10-25 23:59:00")).toBe(90_000_000);
    // Midnight to midnight now also includes the To minute: 23 h + 60 s and 25 h + 60 s.
    expect(span("2026-03-29 00:00:00", "2026-03-30 00:00:00")).toBe(82_860_000);
    expect(span("2026-10-25 00:00:00", "2026-10-26 00:00:00")).toBe(90_060_000);
  });

  it("M4-tz-04 (Athens): gap and overlap resolve to one defined instant [OQ-8]", () => {
    expect(h.toApiInstant("2026-03-29 03:30:00")).toBe("2026-03-29T01:30:00.000Z");
    expect(h.toApiInstant("2026-10-25 03:30:00")).toBe("2026-10-25T00:30:00.000Z");
  });

  it("M4-params-04: To is inclusive of its minute [OQ-2]", () => {
    // OQ-2 (app change agreed, not made yet): end_date = toApiInstant(to) + 60 s.
    expect(h.buildHistoryParams({ from: null, to: "2026-10-02 23:59:00", minConfidencePct: 0 }).end_date).toBe(
      "2026-10-02T21:00:00.000Z",
    );
    expect(h.buildHistoryParams({ from: null, to: "2026-10-02 14:30:00", minConfidencePct: 0 }).end_date).toBe(
      "2026-10-02T11:31:00.000Z",
    );
    expect(h.validateRange("2026-10-02 00:00:00", "2026-10-02 23:59:00")).toBeNull();
    expect(h.validateRange("2026-10-02 10:00:00", "2026-10-02 09:58:00")).toBe(RANGE_ERROR);
  });
});

describe("toApiInstant at Asia/Kolkata", () => {
  const h = pinTimeZone("Asia/Kolkata", loadHistory);

  it("M4-tz-05 (Kolkata): half-hour offsets work", () => {
    expect(h.toApiInstant("2026-10-02 08:00:00")).toBe("2026-10-02T02:30:00.000Z");
  });

  it("M4-fmt-02: names the user's IANA time zone", () => {
    // Some ICU builds (this Node 24 / ICU 77 among them) canonicalise Asia/Kolkata to its
    // IANA alias Asia/Calcutta, even for an explicit timeZone: "Asia/Kolkata". Both name
    // the pinned zone; anything else (e.g. "UTC") means the page names the wrong zone.
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(h.localTimeZone());
  });
});

describe("toApiInstant at UTC", () => {
  const h = pinTimeZone("UTC", loadHistory);

  it("M4-tz-05 (UTC control): the value passes through unchanged", () => {
    expect(h.toApiInstant("2026-10-02 08:00:00")).toBe("2026-10-02T08:00:00.000Z");
  });
});

describe("formatTimestamp at Asia/Riyadh", () => {
  const h = pinTimeZone("Asia/Riyadh", loadHistory);

  it("M4-fmt-01 (Riyadh): timestamps are local, including the local day", () => {
    const d = new Date("2026-10-02T11:05:09Z");
    expect(h.formatTimestamp(d)).toBe(refFormat(d, "Asia/Riyadh"));
    expect(h.formatTimestamp(d)).not.toBe(refFormat(d, "UTC"));
    expect(h.formatTimestamp(new Date("2026-10-02T22:30:00Z"))).toContain("Oct 3");
  });
});

describe("buildHistoryParams and summarize", () => {
  it("M4-params-01: empty filters produce no params", () => {
    expect(buildHistoryParams({ from: null, to: null, minConfidencePct: 0 })).toEqual({});
  });

  it("M4-params-03: the slider maps to min_confidence as a 0–1 fraction; 0 means none", () => {
    const pct = (minConfidencePct) => buildHistoryParams({ from: null, to: null, minConfidencePct });
    expect(pct(0)).not.toHaveProperty("min_confidence");
    expect(pct(5).min_confidence).toBe("0.05");
    expect(pct(85).min_confidence).toBe("0.85");
    expect(pct(100).min_confidence).toBe("1");
    for (let n = 5; n <= 100; n += 5) {
      const value = pct(n).min_confidence;
      expect(value).toBe(String(n / 100));
      expect(value).toMatch(/^(0\.\d{1,2}|1)$/);
    }
  });

  it("M4-sum-01: KPIs over the given records; empty gives null figures", () => {
    expect(summarize(R4.map(toRecord))).toEqual({ detections: 4, avgPeople: 2, peak: 5, avgModelMs: 250 });
    expect(summarize([])).toEqual({ detections: 0, avgPeople: null, peak: null, avgModelMs: null });
    expect(summarize([toRecord(R4[1])])).toEqual({ detections: 1, avgPeople: 0, peak: 0, avgModelMs: 200 });
  });
});
