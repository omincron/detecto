// Shared test helpers: the standard D2 response, fetch routing, object-URL stubs.
import { afterAll, beforeAll, vi } from "vitest";

// Standard response D2 (test-plans/milestone-3.md), as the backend sends it.
export const D2 = {
  count: 2,
  detections: [
    { bbox: [128, 72, 640, 360], confidence: 0.91 },
    { bbox: [640, 360, 1280, 720], confidence: 0.62 },
  ],
  average_confidence: 0.765,
  inference_time_ms: 142.3,
  image_width: 1280,
  image_height: 720,
  annotated_image_base64: null,
};

// D2 after detectPeople's camelCase mapping.
export const D2_RESULT = {
  count: 2,
  detections: D2.detections,
  averageConfidence: 0.765,
  inferenceTimeMs: 142.3,
  imageWidth: 1280,
  imageHeight: 720,
  annotatedImageBase64: null,
};

export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

export const jpegResponse = () =>
  new Response(JPEG_BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });

export const jpegFile = (name = "zidane.jpg") => new File([JPEG_BYTES], name, { type: "image/jpeg" });

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Stub global fetch, routed by URL:
 *  - "/samples/index.json" → manifest (a value sent as JSON, or a function returning a Response/promise)
 *  - "/samples/<file>"     → samples[file]() if given, else a JPEG blob
 *  - ".../detect..."       → detect(url, options) (a Response or a promise of one)
 *  - ".../health"          → health(url, options), default 200 {"status": "ok"}
 *  - ".../history..."      → history(url, options), default 200 []
 *  - ".../reset"           → reset(url, options); no default (unrouted → throws)
 */
export function mockFetch({
  manifest = [],
  samples = {},
  detect,
  health = () => jsonResponse({ status: "ok" }),
  history = () => jsonResponse([]),
  reset,
} = {}) {
  const fetchMock = vi.fn(async (url, options) => {
    const path = String(url);
    if (path.endsWith("/health")) {
      return health(path, options);
    }
    if (path === "/samples/index.json") {
      return typeof manifest === "function" ? manifest() : jsonResponse(manifest);
    }
    if (path.startsWith("/samples/")) {
      const file = path.slice("/samples/".length);
      return samples[file] ? samples[file]() : jpegResponse();
    }
    if (path.includes("/detect")) {
      if (!detect) throw new Error("no /detect route in this test");
      return detect(path, options);
    }
    if (path.includes("/history")) {
      return history(path, options);
    }
    if (path.includes("/reset")) {
      if (!reset) throw new Error("no /reset route in this test");
      return reset(path, options);
    }
    throw new Error(`unexpected fetch: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** fetch calls whose URL contains `part`. */
export const callsTo = (fetchMock, part) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(part));

/** jsdom has no createObjectURL/revokeObjectURL: stub them (blob:mock/1, blob:mock/2, …). */
export function stubObjectUrls() {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock/${++n}`);
  URL.revokeObjectURL = vi.fn();
  return { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
}

export function unstubObjectUrls() {
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
}

/** Let pending promise chains (fetch → json → setState) settle. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

// --- History fixtures (test-plans/milestone-4.md) ---------------------------------

/** One /history record in the backend's raw shape. */
export const raw = (id, timestamp, count, avg, ms) => ({
  id,
  timestamp,
  count,
  average_confidence: avg,
  inference_time_ms: ms,
});

/** Standard records R4, oldest first (as /history returns them). */
export const R4 = [
  raw(1, "2026-10-02T09:00:00.000000Z", 2, 0.8, 100),
  raw(2, "2026-10-02T09:01:00.000000Z", 0, 0.0, 200),
  raw(3, "2026-10-02T09:10:00.000000Z", 5, 0.9, 300),
  raw(4, "2026-10-02T11:05:09.563816Z", 1, 0.62, 400),
];

/** n raw records, ids 1..n, one minute apart from 2026-10-02T08:00:00Z. */
export const many = (n) =>
  Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    const count = id % 4;
    const timestamp = new Date(Date.UTC(2026, 9, 2, 8, 0, 0) + i * 60_000).toISOString();
    return raw(id, timestamp, count, count ? 0.8 : 0, 100 + id);
  });

/** A raw record mapped the way getHistory maps it (fraction trimmed to ms). */
export const toRecord = (r) => ({
  id: r.id,
  timestamp: new Date(r.timestamp.replace(/(\.\d{3})\d+/, "$1")),
  count: r.count,
  averageConfidence: r.average_confidence,
  inferenceTimeMs: r.inference_time_ms,
});

/** /history (or /reset) handler that answers each call with the next item (a Response factory or a promise). */
export const inOrder = (...answers) => {
  const queue = [...answers];
  return () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === "function" ? next() : next;
  };
};

/** Reference formatter for timestamps in `timeZone` (same options as formatTimestamp). */
export const refFormat = (date, timeZone) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).format(date);

/**
 * Pin process.env.TZ for the enclosing describe. Intl formatters made at module load keep
 * the zone they were created in, so `load` re-imports the modules under test after
 * vi.resetModules(). Returns an object filled with load()'s result in beforeAll.
 */
export function pinTimeZone(zone, load) {
  const original = process.env.TZ;
  const modules = {};
  beforeAll(async () => {
    process.env.TZ = zone;
    vi.resetModules();
    Object.assign(modules, await load());
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    vi.resetModules();
  });
  return modules;
}

/**
 * Silence Mantine's "[@mantine/hooks/use-focus-trap] Failed to find focusable element"
 * warning (a large fiber dump in jsdom, not an app error). Other warnings pass through.
 * Undo with vi.restoreAllMocks().
 */
export function muteFocusTrapWarning() {
  const original = console.warn;
  return vi.spyOn(console, "warn").mockImplementation((...args) => {
    if (String(args[0]).startsWith("[@mantine/hooks/use-focus-trap]")) return;
    original(...args);
  });
}
