import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";

// GitHub Pages serves the site at /<repo>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/cape-town-ward-map/",
  plugins: [preact()],
  build: { chunkSizeWarningLimit: 1200 },
  test: { environment: "node" },
});
