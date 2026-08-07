import { build } from "esbuild";

// The extension host bundle (Node, `vscode` provided by the runtime).
await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
});
console.log("bundled dist/extension.js");

// The board configurator's client app. Separate because it runs in the webview,
// where there is no `vscode` module and no Node — only what src/shared/ exposes
// can be imported by both.
await build({
  entryPoints: ["src/webview/index.ts"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  minify: false,
});
console.log("bundled dist/webview.js");
