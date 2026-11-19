import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Generated bundles, examples, tests, and Node build tools are not plugin code.
  globalIgnores([
    "node_modules",
    "dist",
    "out",
    "main.js",
    "*.min.js",
    "examples/**",
    "e2e/**",
    "scripts/**",
    ".cache/**",
    "*.config.mts",
    "wdio*.mts",
    "dio.single.mts",
  ]),
  ...obsidianmd.configs.recommended,
  {
    // The recommended rules include type-aware TypeScript checks. This lets
    // them use the project while still allowing ESLint to lint its own config.
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      // Obsidian plugins run inside the host application. Use its requestUrl()
      // API for network access and keep dynamic or shell execution out of code.
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Use Obsidian's requestUrl() for network requests.",
        },
        {
          name: "XMLHttpRequest",
          message: "Use Obsidian's requestUrl() for network requests.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              message: "Shell execution is not allowed in the plugin.",
            },
            {
              name: "node:child_process",
              message: "Shell execution is not allowed in the plugin.",
            },
            {
              name: "vm",
              message: "Dynamic code execution is not allowed in the plugin.",
            },
            {
              name: "node:vm",
              message: "Dynamic code execution is not allowed in the plugin.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests run under Vitest/Node rather than inside Obsidian. The recommended
    // config already disables Obsidian-runtime-only rules for test files.
    files: ["test/**/*.ts"],
    rules: {
      // Vitest's spy assertions intentionally detach mocked methods.
      "@typescript-eslint/unbound-method": "off",
      "no-restricted-properties": [
        "error",
        { object: "describe", property: "only", message: "Do not commit describe.only()." },
        { object: "it", property: "only", message: "Do not commit it.only()." },
        { object: "test", property: "only", message: "Do not commit test.only()." },
      ],
    },
  },
]);
