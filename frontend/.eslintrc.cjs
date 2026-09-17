module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  plugins: ["@typescript-eslint", "react-hooks", "react-refresh"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "plugin:react-hooks/recommended"],
  env: { browser: true, es2022: true },
  settings: { react: { version: "detect" } },
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    // Vite HMR only works when a module exports just components; test
    // helpers and the api layer are exempt because they aren't components.
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  },
  overrides: [
    {
      files: ["src/**/__tests__/**", "src/test/**", "src/setupTests.ts"],
      rules: { "react-refresh/only-export-components": "off" },
    },
    { files: ["src/context/*.tsx"], rules: { "react-refresh/only-export-components": "off" } },
  ],
  ignorePatterns: ["dist", "node_modules", "coverage"],
};
