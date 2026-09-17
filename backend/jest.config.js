/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFiles: ["reflect-metadata"],
  testTimeout: 30000,

  // Coverage is measured over the whole backend source. Two kinds of file
  // are excluded on purpose:
  //   * process entrypoints/scripts that only make sense against a live
  //     server or database (server.ts, migrate.ts, seed.ts) -- they are
  //     exercised by the smoke test, not by jest;
  //   * pure interface files (I*.ts, events.ts) that compile to nothing.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server.ts",
    "!src/db/migrate.ts",
    "!src/db/seed.ts",
    "!src/**/I[A-Z]*.ts",
    "!src/events/events.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text-summary", "text", "lcov"],
  // `npm run test:coverage` runs unit + integration together and must clear
  // this bar; CI (.github/workflows/ci.yml) fails the build if it doesn't.
  coverageThreshold: {
    global: { lines: 90, branches: 90, functions: 90, statements: 90 },
  },
};
