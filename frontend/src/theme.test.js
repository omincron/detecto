import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { theme } from "./theme.js";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("theme", () => {
  it("M3b-shell-07: agreed fonts, five 10-shade pastel palettes, fonts bundled", () => {
    expect(theme.fontFamily.startsWith("'IBM Plex Sans'")).toBe(true);
    expect(theme.fontFamilyMonospace.startsWith("'IBM Plex Mono'")).toBe(true);

    for (const name of ["periwinkle", "mint", "lavender", "sky", "peach"]) {
      const shades = theme.colors[name];
      expect(shades, name).toHaveLength(10);
      for (const shade of shades) expect(shade).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(Object.keys(theme.colors)).toContain(theme.primaryColor);

    const { dependencies } = JSON.parse(read("../package.json"));
    expect(dependencies).toHaveProperty("@fontsource/ibm-plex-sans");
    expect(dependencies).toHaveProperty("@fontsource/ibm-plex-mono");
    const html = read("../index.html");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
  });
});
