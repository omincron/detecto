// Shared test helpers: the standard D2 response, fetch routing, object-URL stubs.
import { vi } from "vitest";

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
 */
export function mockFetch({
  manifest = [],
  samples = {},
  detect,
  health = () => jsonResponse({ status: "ok" }),
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
