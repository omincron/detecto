import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const MiB = 1048576;

async function loadConfig(value) {
  vi.stubEnv("VITE_MAX_UPLOAD_MB", value);
  vi.resetModules();
  return import("./config.js");
}

/** KEY=VALUE pairs from a dotenv file, skipping blanks and # comments. */
function readEnv(relative) {
  const text = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const at = trimmed.indexOf("=");
    env[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("config", () => {
  it("M3b-config-01: the default is 10 MB, matching the backend", async () => {
    vi.resetModules();
    const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = await import("./config.js");
    expect(MAX_UPLOAD_MB).toBe(10);
    expect(MAX_UPLOAD_BYTES).toBe(10485760);
  });

  it.each([
    ["5", 5, 5242880],
    ["2.5", 2.5, 2621440],
    [" 20 ", 20, 20971520],
  ])("M3b-config-02: VITE_MAX_UPLOAD_MB=%j overrides the default", async (value, mb, bytes) => {
    const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = await loadConfig(value);
    expect(MAX_UPLOAD_MB).toBe(mb);
    expect(MAX_UPLOAD_BYTES).toBe(bytes);
  });

  it.each([undefined, "", "0", "-1", "abc", "Infinity", "NaN"])(
    "M3b-config-03: VITE_MAX_UPLOAD_MB=%j falls back to 10",
    async (value) => {
      const { MAX_UPLOAD_MB, MAX_UPLOAD_BYTES } = await loadConfig(value);
      expect(MAX_UPLOAD_MB).toBe(10);
      expect(MAX_UPLOAD_BYTES).toBe(10485760);
    },
  );

  it("M3b-config-04: frontend/.env.example limit matches the backend MAX_UPLOAD_BYTES", () => {
    // The shipped templates (.env itself is gitignored and may differ per machine).
    const frontend = readEnv("../.env.example");
    const root = readEnv("../../.env.example");
    const backendBytes = Number(root.MAX_UPLOAD_BYTES ?? 10485760); // backend/config.py default
    expect(Number(frontend.VITE_MAX_UPLOAD_MB) * MiB).toBe(backendBytes);
  });
});
