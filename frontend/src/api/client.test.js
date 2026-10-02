import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, detectPeople } from "./client.js";
import { D2, D2_RESULT, JPEG_BYTES, jsonResponse } from "../test/helpers.js";

const file = () => new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" });

function stubFetch(impl) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("detectPeople", () => {
  it("M3-api-01: POSTs the file as multipart field `image` to <base>/detect", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(D2));
    const upload = file();

    await detectPeople(upload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8000/detect");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    const sent = options.body.get("image");
    expect(sent.name).toBe(upload.name);
    expect(sent.size).toBe(upload.size);
    expect(sent.type).toBe(upload.type);
    const headerKeys = Object.keys(options.headers ?? {}).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain("content-type");
  });

  it("M3-api-02: sends return_annotated only when asked", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(D2));

    await detectPeople(file());
    await detectPeople(file(), { annotated: true });

    expect(fetchMock.mock.calls[0][0]).not.toContain("?");
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/detect\?return_annotated=true$/);
  });

  it("M3-api-03: maps the response to camelCase", async () => {
    stubFetch(async () => jsonResponse(D2));
    expect(await detectPeople(file())).toEqual(D2_RESULT);

    const { annotated_image_base64: _omit, ...withoutAnnotated } = D2;
    stubFetch(async () => jsonResponse(withoutAnnotated));
    expect((await detectPeople(file())).annotatedImageBase64).toBeNull();

    stubFetch(async () => jsonResponse({ ...D2, annotated_image_base64: "QUJD" }));
    expect((await detectPeople(file())).annotatedImageBase64).toBe("QUJD");
  });

  it("M3-api-04: base URL comes from VITE_API_BASE_URL, trailing slash dropped", async () => {
    const fetchMock = stubFetch(async () => jsonResponse(D2));

    vi.stubEnv("VITE_API_BASE_URL", "http://api.test:9000/");
    vi.resetModules();
    let client = await import("./client.js");
    await client.detectPeople(file());
    expect(fetchMock.mock.calls.at(-1)[0]).toBe("http://api.test:9000/detect");

    vi.stubEnv("VITE_API_BASE_URL", undefined);
    vi.resetModules();
    client = await import("./client.js");
    await client.detectPeople(file());
    expect(fetchMock.mock.calls.at(-1)[0]).toBe("http://localhost:8000/detect");
  });

  it.each([
    [400, "Uploaded file is empty"],
    [400, "Could not decode image — unsupported or corrupt file"],
    [413, "File too large (max 10 MB)"],
    [415, "Unsupported file type: text/plain"],
    [415, "Unsupported image format: GIF. Only JPEG and PNG are accepted"],
    [500, "Inference failed: boom"],
  ])("M3-api-05: HTTP %i becomes an ApiError with the backend detail", async (status, detail) => {
    stubFetch(async () => jsonResponse({ detail }, status));

    const err = await detectPeople(file()).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ApiError");
    expect(err.message).toBe(detail);
    expect(err.status).toBe(status);
  });

  it.each([
    [422, { detail: [{ loc: ["query"], msg: "x" }] }],
    [404, {}],
  ])("M3-api-06: HTTP %i with a non-string detail gives a generic message", async (status, body) => {
    stubFetch(async () => jsonResponse(body, status));

    const err = await detectPeople(file()).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe(`Request failed (HTTP ${status})`);
    expect(err.message).not.toContain("[object Object]");
    expect(err.status).toBe(status);
  });

  it("M3-api-07: a non-JSON error body gives the generic message", async () => {
    stubFetch(
      async () =>
        new Response("<html>Bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );

    const err = await detectPeople(file()).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Request failed (HTTP 502)");
    expect(err.status).toBe(502);
  });

  it("M3-api-08: a network failure becomes a can't-reach ApiError with no status", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    const err = await detectPeople(file()).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBeNull();
    expect(err.message).toMatch(/can't reach/i);
    expect(err.message).toContain("http://localhost:8000");
    expect(err.message).not.toContain("Failed to fetch");
  });

  it.each([["not json"], ["null"]])(
    "M3-api-09: a 200 body %j is reported as unreadable",
    async (body) => {
      stubFetch(async () => new Response(body, { status: 200 }));

      const err = await detectPeople(file()).catch((e) => e);

      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).toBe("The server sent an unreadable response");
      expect(err.status).toBe(200);
    },
  );
});
