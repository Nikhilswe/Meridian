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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "lcov"],
      // Everything a user can reach. Excluded: the DOM bootstrap (main.tsx),
      // test helpers, and type-only files.
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/setupTests.ts", "src/test/**", "src/**/__tests__/**", "src/vite-env.d.ts"],
      // `npm run test:coverage` fails below this bar; CI enforces it.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
