// The only module that knows the backend URL and response shapes (ARCHITECTURE.md §4.3).
// Pages and components get plain objects or an ApiError, never raw fetch responses.

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

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, options);
  } catch {
    throw new ApiError(`Can't reach the detection server at ${BASE_URL}. Is the backend running?`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); fall through to a generic message.
  }

  if (!response.ok) {
    // The backend's error contract: {"detail": "<string the UI can show as-is>"}.
    const detail = typeof body?.detail === "string" ? body.detail : null;
    throw new ApiError(detail ?? `Request failed (HTTP ${response.status})`, response.status);
  }
  if (body === null) {
    throw new ApiError("The server sent an unreadable response", response.status);
  }
  return body;
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
