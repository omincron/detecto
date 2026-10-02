import { describe, expect, it } from "vitest";
import { validateUpload } from "./validateUpload.js";
import { JPEG_BYTES } from "../test/helpers.js";

const MiB = 1048576;
const LIMIT = 10 * MiB;
const TYPE_MESSAGE = (type) => `Only JPEG and PNG images are supported (this file is ${type}).`;

describe("validateUpload", () => {
  it("M3b-valid-01: a non-empty JPEG or PNG within the limit returns null", () => {
    for (const file of [
      { size: 1, type: "image/jpeg" },
      { size: 1, type: "image/jpg" },
      { size: 1, type: "image/png" },
      { size: 5000, type: "image/png" },
    ]) {
      expect(validateUpload(file, LIMIT)).toBeNull();
    }
    expect(validateUpload(new File([JPEG_BYTES], "a.jpg", { type: "image/jpeg" }), LIMIT)).toBeNull();
  });

  it("M3b-valid-02: an empty file is rejected whatever its type", () => {
    expect(validateUpload({ size: 0, type: "image/jpeg" }, LIMIT)).toBe("This file is empty.");
    for (const type of ["", "text/plain"]) {
      const message = validateUpload({ size: 0, type }, LIMIT);
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("M3b-valid-03: the size limit is inclusive", () => {
    const tooLarge = "This file is larger than the 10 MB limit.";
    expect(validateUpload({ size: 10485760, type: "image/jpeg" }, LIMIT)).toBeNull();
    expect(validateUpload({ size: 10485761, type: "image/jpeg" }, LIMIT)).toBe(tooLarge);
    expect(validateUpload({ size: 10485759, type: "image/png" }, LIMIT)).toBeNull();
    expect(validateUpload({ size: 10485761, type: "" }, LIMIT)).toBe(tooLarge);
  });

  it("M3b-valid-04: the limit is the maxBytes argument and the message reflects it", () => {
    expect(validateUpload({ size: 5 * MiB, type: "image/png" }, 5 * MiB)).toBeNull();
    expect(validateUpload({ size: 5 * MiB + 1, type: "image/png" }, 5 * MiB)).toBe(
      "This file is larger than the 5 MB limit.",
    );
    expect(validateUpload({ size: 2.5 * MiB + 1, type: "image/png" }, 2.5 * MiB)).toBe(
      "This file is larger than the 2.5 MB limit.",
    );
    const sixMiB = { size: 6 * MiB, type: "image/png" };
    expect(validateUpload(sixMiB, LIMIT)).toBeNull();
    expect(validateUpload(sixMiB, 5 * MiB)).toBe("This file is larger than the 5 MB limit.");
  });

  it("M3b-valid-05: the type check ignores case, whitespace and MIME parameters", () => {
    for (const type of [
      "IMAGE/JPEG",
      "Image/Png",
      "image/JPG",
      "image/png; charset=binary",
      "image/jpeg;q=1",
      "image/png ; x=y",
      " image/jpeg ",
    ]) {
      expect(validateUpload({ size: 1, type }, LIMIT), type).toBeNull();
    }
  });

  it("M3b-valid-06: other declared types are rejected, naming the normalized type", () => {
    for (const type of ["image/gif", "text/plain", "image/webp", "image/heic", "image/svg+xml"]) {
      expect(validateUpload({ size: 1, type }, LIMIT)).toBe(TYPE_MESSAGE(type));
    }
    expect(validateUpload({ size: 1, type: "IMAGE/GIF; x=1" }, LIMIT)).toBe(TYPE_MESSAGE("image/gif"));
    for (const type of ["image/jpegx", "image/png2"]) {
      expect(validateUpload({ size: 1, type }, LIMIT), type).toEqual(expect.any(String));
    }
  });

  it("M3b-valid-07: an empty or missing declared type passes", () => {
    expect(validateUpload({ size: 1, type: "" }, LIMIT)).toBeNull();
    expect(validateUpload({ size: 1 }, LIMIT)).toBeNull();
    expect(validateUpload({ size: 1, type: undefined }, LIMIT)).toBeNull();
  });

  // OQ-1 (app change agreed, not made yet): application/octet-stream passes like an empty type.
  it("M3b-valid-08: application/octet-stream passes the pre-check [OQ-1]", () => {
    expect(validateUpload({ size: 1, type: "application/octet-stream" }, LIMIT)).toBeNull();
    expect(validateUpload({ size: 1, type: "APPLICATION/OCTET-STREAM" }, LIMIT)).toBeNull();
    expect(
      validateUpload({ size: 1, type: "application/octet-stream; charset=binary" }, LIMIT),
    ).toBeNull();
    expect(validateUpload({ size: 0, type: "application/octet-stream" }, LIMIT)).toBe(
      "This file is empty.",
    );
  });
});
