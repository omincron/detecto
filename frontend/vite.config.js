import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 }, // must match the backend's CORS_ORIGINS
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
  },
});
