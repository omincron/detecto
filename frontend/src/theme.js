import { createTheme } from "@mantine/core";

// Neutral base + pastel accents (agreed mockup: claude.ai/artifact/Y59trr8m7kAdmZCJgQSExS).
// Each palette is 10 shades, light → dark. Pastel fills come from the light shades
// (or Mantine's "light" variant); text on them uses the dark shades for contrast.
const periwinkle = ["#f0f2fe", "#e1e4fc", "#c7cdf7", "#a8b1f2", "#8c97ec", "#7280e5", "#4c5bd4", "#3f4dbd", "#3442a3", "#2f3a99"];
const mint = ["#eef9f3", "#dcf2e6", "#bfe6d1", "#9ed8ba", "#7fcba4", "#5fbd8e", "#3fa673", "#2f8a5c", "#24704a", "#1f6a47"];
const lavender = ["#f5f2fd", "#ece7fb", "#d9cff6", "#c3b4f0", "#ac98e9", "#957de2", "#7a60d4", "#634bb8", "#53409f", "#4a3c9c"];
const sky = ["#eef6fd", "#dcedfa", "#bcdcf4", "#99c9ee", "#76b6e7", "#55a2df", "#3a8acb", "#2e71a8", "#255f8e", "#1d5a86"];
const peach = ["#fef4ee", "#fce6da", "#f8ccb5", "#f3b08e", "#ee9468", "#e87a46", "#d4622e", "#b04f23", "#94461d", "#7a3814"];

export const theme = createTheme({
  primaryColor: "periwinkle",
  primaryShade: 6,
  colors: { periwinkle, mint, lavender, sky, peach },
  fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', ui-monospace, monospace",
  headings: { fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontWeight: "700" },
  defaultRadius: "md",
  cursorType: "pointer",
  other: {
    ground: "#f6f7f9", // page background behind cards
    border: "#e3e6eb",
    muted: "#5b6676", // secondary text; 5.6:1 on white
  },
});
