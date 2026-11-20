import { build } from "esbuild";
import {
  appendFileSync,
  mkdirSync,
  copyFileSync,
  statSync,
} from "node:fs";
import { assertMainBundleSize, MAIN_JS_MAX_BYTES } from "./bundle-budget.mjs";

mkdirSync("dist/plugin", { recursive: true });
await build({
  entryPoints: ["src/obsidian/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: [
    "obsidian",
    "electron",
    "http",
    "https",
    "zlib",
    "fs",
    "path",
    "node:http",
    "node:https",
    "node:zlib",
    "@codemirror/state",
    "@codemirror/view",
  ],
  outfile: "dist/plugin/main.js",
  minify: true,
  loader: { ".ttf": "dataurl" },
  logLevel: "info",
  // elkjs optionally requires web-worker; the bundled build runs in-thread.
  define: { "process.env.NODE_ENV": '"production"' },
});
const mainBytes = statSync("dist/plugin/main.js").size;
assertMainBundleSize(mainBytes);
console.log(`main.js bundle budget: ${mainBytes} / ${MAIN_JS_MAX_BYTES} bytes`);
await build({
  entryPoints: ["src/runtime/browser.ts"],
  bundle: true,
  format: "iife",
  globalName: "FlowMotion",
  platform: "browser",
  target: "es2020",
  outfile: "dist/flowmotion-runtime.js",
  minify: true,
  logLevel: "info",
});
copyFileSync("manifest.json", "dist/plugin/manifest.json");
copyFileSync("styles.css", "dist/plugin/styles.css");
const monacoStyles = await build({
  entryPoints: ["node_modules/monaco-editor/min/vs/editor/editor.main.css"],
  bundle: true,
  write: false,
  outfile: "monaco.css",
  loader: { ".ttf": "dataurl" },
  logLevel: "silent",
});
appendFileSync(
  "dist/plugin/styles.css",
  `\n${monacoStyles.outputFiles[0].text}`,
);
