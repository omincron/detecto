// Pure helpers for the History page: turning filter inputs into API params, and
// summarising records. No React, no fetch — easy to unit test.

import dayjs from "dayjs";

/**
 * A DateTimePicker value ("YYYY-MM-DD HH:mm:ss", the user's local wall-clock time) →
 * an absolute UTC instant ("2026-10-02T06:00:00.000Z"), or null if empty/invalid.
 *
 * The backend reads bare dates and naive datetimes as UTC (ARCHITECTURE.md §3.3), so
 * sending local wall-clock time as-is would shift the range by the user's UTC offset.
 * Converting here makes "Oct 2, 08:00" mean 08:00 where the user is (M2 OQ-3).
 */
export function toApiInstant(localValue) {
  if (!localValue) return null;
  const parsed = dayjs(localValue); // dayjs parses this format as local time
  return parsed.isValid() ? parsed.toDate().toISOString() : null;
}

/**
 * The exclusive end instant for a "To" value. "To" is inclusive of the minute shown
 * (pickers have no seconds), so the API's exclusive end_date is one minute later:
 * "To Oct 2, 23:59" covers the whole local day.
 */
export function toApiEnd(localValue) {
  if (!localValue) return null;
  const parsed = dayjs(localValue);
  return parsed.isValid() ? parsed.add(1, "minute").toDate().toISOString() : null;
}

/**
 * When a *day* is picked in the "To" calendar, the picker yields that day at 00:00 —
 * which, as an end bound, would exclude the day itself. Snap a newly picked day to
 * 23:59; an explicit time edit on the same day is left alone.
 */
export function snapToEndOfDay(previous, next) {
  if (!next || !next.endsWith(" 00:00:00")) return next;
  const pickedNewDay = !previous || previous.slice(0, 10) !== next.slice(0, 10);
  return pickedNewDay ? `${next.slice(0, 10)} 23:59:00` : next;
}

/**
 * Filter-bar state → /history query params. `minConfidencePct` is 0–100 from the
 * slider; 0 means "no filter" and is omitted.
 */
export function buildHistoryParams({ from, to, minConfidencePct }) {
  const params = {};
  const start = toApiInstant(from);
  const end = toApiEnd(to);
  if (start) params.start_date = start;
  if (end) params.end_date = end;
  if (minConfidencePct > 0) params.min_confidence = String(minConfidencePct / 100);
  return params;
}

/** A message if the range is unusable (start not before end), else null. */
export function validateRange(from, to) {
  const start = toApiInstant(from);
  const end = toApiEnd(to);
  if (start && end && start >= end) return "“From” must be before “To”.";
  return null;
}

/** KPI figures for a list of records; null figures when there are no records. */
export function summarize(records) {
  if (records.length === 0) {
    return { detections: 0, avgPeople: null, peak: null, avgModelMs: null };
  }
  const total = (pick) => records.reduce((sum, record) => sum + pick(record), 0);
  return {
    detections: records.length,
    avgPeople: total((r) => r.count) / records.length,
    peak: Math.max(...records.map((r) => r.count)),
    avgModelMs: total((r) => r.inferenceTimeMs) / records.length,
  };
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** A record's timestamp in the user's local time zone, e.g. "Oct 2, 14:05:09". */
export const formatTimestamp = (date) => dateTimeFormat.format(date);

/** The user's IANA time zone name, for telling them which zone times are shown in. */
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
