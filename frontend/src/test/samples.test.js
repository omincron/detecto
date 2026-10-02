// M3-samples-01: the demo manifest and the public/samples folder agree.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public/samples");
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes, magic) => magic.every((byte, i) => bytes[i] === byte);

describe("public/samples manifest", () => {
  it("M3-samples-01: every entry points to a real JPEG/PNG", () => {
    const manifest = JSON.parse(readFileSync(join(SAMPLES_DIR, "index.json"), "utf8"));

    expect(Array.isArray(manifest)).toBe(true);
    const files = manifest.map((entry) => entry.file);
    expect(new Set(files).size).toBe(files.length);

    for (const entry of manifest) {
      expect(typeof entry.file === "string" && entry.file.length > 0).toBe(true);
      expect(typeof entry.label === "string" && entry.label.length > 0).toBe(true);
      expect([".jpg", ".jpeg", ".png"]).toContain(extname(entry.file).toLowerCase());

      const path = join(SAMPLES_DIR, entry.file);
      expect(existsSync(path), `${entry.file} exists`).toBe(true);
      const bytes = readFileSync(path);
      expect(
        startsWith(bytes, JPEG_MAGIC) || startsWith(bytes, PNG_MAGIC),
        `${entry.file} has JPEG/PNG magic bytes`,
      ).toBe(true);
    }
  });
});
