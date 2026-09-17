/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config for the Scaler frontend.
//
// The API base URL is read directly by src/api/client.ts via
// `import.meta.env.VITE_API_BASE_URL` (falling back to http://localhost:4000),
// so no dev-server proxy is required here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    css: true,
  },
});
