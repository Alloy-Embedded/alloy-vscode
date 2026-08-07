// Render the package view with real chip data into a standalone page, so the
// layout can be LOOKED at instead of reasoned about.
//
//     node scripts/preview-package.mjs [chip-id]   # default: the SAME70
//
// This exists because the first version of the package view passed its tests
// and was unusable: 36 pins a side at 50px each, labels colliding in vertical
// writing mode, the whole drawing painting over the role panels. None of that
// is expressible as an assertion — you have to see it. Open the file it writes
// in any browser.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as esbuild from "esbuild";

const built = await esbuild.build({
  entryPoints: ["src/webview/editor.ts"], bundle: true, format: "esm",
  write: false, platform: "neutral", target: "es2020", logLevel: "silent",
});
const ed = await import("data:text/javascript;base64,"
  + Buffer.from(built.outputFiles[0].text).toString("base64"));

const chipInfo = JSON.parse(execFileSync(
  process.env.HOME + "/.local/bin/alloy",
  ["chip-info", process.argv[2] || "microchip/atsame70q21"], { encoding: "utf8" }));
if (!chipInfo.package) {
  console.error(`${chipInfo.chip}: no package data — nothing to draw`);
  process.exit(1);
}
const data = { chip: chipInfo, detail: { editable: true, issues: [] },
               board: { id: "same70_xplained", chip: "microchip/atsame70q21", roles: {} } };
const state = ed.initialState(data);
const owned = { pa5: "led", pb0: "debug_uart tx", pb1: "debug_uart rx" };
const html = ed.renderPackage(state, chipInfo.package, owned, new Set(["pd0"]));

writeFileSync("pkg-preview.html", `<!doctype html><html><head><meta charset="utf-8">
<style>
:root{--vscode-font-family:system-ui;--vscode-foreground:#ccc;--vscode-panel-border:#3c3c3c;
--vscode-editor-background:#1e1e1e;--vscode-editorWidget-background:#252526;
--vscode-input-background:#3c3c3c;--vscode-descriptionForeground:#9d9d9d;
--vscode-charts-green:#2e7d32;--vscode-charts-blue:#1565c0;--vscode-charts-purple:#6a1b9a;
--vscode-editorError-foreground:#f14c4c;--vscode-focusBorder:#0078d4;
--vscode-editor-font-family:ui-monospace,Menlo,monospace;}
body{background:#1e1e1e;margin:0;padding:14px 18px;font-family:system-ui}
/* the real page puts the pinout in the LEFT half of a two-column grid */
.cols{display:grid;grid-template-columns:minmax(340px,1fr) minmax(340px,1fr);gap:16px;align-items:start}
.right{border:1px dashed #666;min-height:600px;color:#888;padding:10px;font:12px system-ui}
fieldset{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:12px 14px;margin:0}
legend{padding:0 6px;color:#ccc;font:500 13px system-ui}
${readFileSync("media/board-editor.css", "utf8")}
</style></head><body><div class="cols">
<div><fieldset><legend>Pinout</legend>${html}</fieldset></div>
<div class="right">painel de roles (deve ficar intocado)</div>
</div></body></html>`);
console.log("wrote pkg-preview.html");
