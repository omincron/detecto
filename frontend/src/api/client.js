// The only module that knows the backend URL and response shapes (ARCHITECTURE.md §4.3).
// Pages and components get plain objects or an ApiError, never raw fetch responses.

import { localTimeZone } from "../utils/history.js";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const API_BASE_URL = BASE_URL;

const HEALTH_TIMEOUT_MS = 5000;

export class ApiError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = "ApiError";
    this.status = status; // null when the server was never reached
  }
}

// Every call goes through here, so "backend unreachable" reads the same everywhere.
async function send(path, options) {
  try {
    return await fetch(`${BASE_URL}${path}`, options);
  } catch {
    throw new ApiError(`Can't reach the detection server at ${BASE_URL}. Is the backend running?`);
  }
}

// The backend's error contract: {"detail": "<string the UI can show as-is>"}.
function failure(response, body) {
  const detail = typeof body?.detail === "string" ? body.detail : null;
  return new ApiError(detail ?? `Request failed (HTTP ${response.status})`, response.status);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null; // Non-JSON body (e.g. a proxy error page); callers fall back to a generic message.
  }
}

async function request(path, options = {}) {
  const response = await send(path, options);
  const body = await readJson(response);
  if (!response.ok) throw failure(response, body);
  if (body === null) {
    throw new ApiError("The server sent an unreadable response", response.status);
  }
  return body;
}

// Query string from params, leaving out empty values ("" means "no filter").
function toQuery(params) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value != null && value !== ""),
  ).toString();
  return query ? `?${query}` : "";
}

/**
 * True if the backend answers /health within 5 s. Never throws: offline is a state, not
 * an error. The timeout matters for a hung backend (accepts the connection, never
 * answers): without it the check never settles and a stale "online" stays on screen.
 */
export async function checkHealth() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const body = await request("/health", { signal: controller.signal });
    return body?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stored detection records matching the filters, oldest first. `params` are the API's
 * query params (start_date, end_date, min_confidence); see utils/history.js for building
 * them. Resolves to [{id, timestamp: Date, count, averageConfidence, inferenceTimeMs}].
 */
export async function getHistory(params = {}) {
  const body = await request(`/history${toQuery(params)}`);
  if (!Array.isArray(body)) {
    throw new ApiError("The server sent an unreadable response");
  }
  return body.map((record) => ({
    id: record.id,
    // The backend sends microseconds; JS only guarantees parsing milliseconds.
    timestamp: new Date(String(record.timestamp).replace(/(\.\d{3})\d+/, "$1")),
    count: record.count,
    averageConfidence: record.average_confidence,
    inferenceTimeMs: record.inference_time_ms,
  }));
}

/**
 * The records matching `params` (same as getHistory) as a CSV file. `timeZone` (IANA,
 * defaults to the browser's) adds a local-time column next to the UTC one.
 * Resolves to {blob, filename}; the filename comes from the server when it sends one.
 */
export async function exportHistory(params = {}, { timeZone = localTimeZone() } = {}) {
  const response = await send(`/history/export${toQuery({ ...params, tz: timeZone })}`);
  if (!response.ok) throw failure(response, await readJson(response));
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "detecto-history.csv";
  return { blob: await response.blob(), filename };
}

/** Delete every stored record (ignores any filters). Resolves to how many were removed. */
export async function clearHistory() {
  const body = await request("/reset", { method: "DELETE" });
  return body.count_removed;
}

/**
 * Run person detection on an image file.
 * Resolves to {count, detections: [{bbox: [x1,y1,x2,y2], confidence}], averageConfidence,
 * inferenceTimeMs, imageWidth, imageHeight, annotatedImageBase64}. `bbox` is in pixels of
 * the frame the backend processed (imageWidth x imageHeight), not the original file.
 */
export async function detectPeople(file, { annotated = false } = {}) {
  const form = new FormData();
  form.append("image", file);
  const query = annotated ? "?return_annotated=true" : "";
  const body = await request(`/detect${query}`, { method: "POST", body: form });
  return {
    count: body.count,
    detections: body.detections,
    averageConfidence: body.average_confidence,
    inferenceTimeMs: body.inference_time_ms,
    imageWidth: body.image_width,
    imageHeight: body.image_height,
    annotatedImageBase64: body.annotated_image_base64 ?? null,
  };
}
