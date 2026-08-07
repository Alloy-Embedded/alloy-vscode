// The two read-only report panels: memory map and board matrix.
//
// Both are a CLI call plus a render function from src/shared/report.ts. The
// host side only manages the panel and a Refresh button, so the interesting
// part stays testable in Node.

import * as vscode from "vscode";
import { buildMatrix, sizeReport, workspaceRoot } from "./cli";
import { renderMatrix, renderMemory } from "./shared/report";

type Reveal = { html: string; title: string; key: string };

const open = new Map<string, vscode.WebviewPanel>();

function show({ html, title, key }: Reveal): vscode.WebviewPanel {
  const existing = open.get(key);
  const panel = existing ?? vscode.window.createWebviewPanel(
    key, title, vscode.ViewColumn.Active, { enableScripts: false });
  if (!existing) {
    open.set(key, panel);
    panel.onDidDispose(() => open.delete(key));
  }
  panel.title = title;
  panel.webview.html = page(html);
  panel.reveal(undefined, true);
  return panel;
}

export async function showMemory(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  const report = await sizeReport(root);
  show({ key: "alloyMemory", title: `Memory · ${report.board}`,
         html: renderMemory(report) });
}

export async function showMatrix(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  // This compiles the project once per board, so it is minutes, not seconds.
  // Progress is cancellable-looking but the CLI owns the work; be honest and
  // just say what is happening.
  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification,
      title: "Alloy: building every board…" },
    () => buildMatrix(root));
  show({ key: "alloyMatrix", title: "Boards", html: renderMatrix(report) });
  if (!report.ok) {
    void vscode.window.showWarningMessage(
      `${report.failed} board(s) failed to build — see the Boards panel.`);
  }
}

/** A minimal themed page. No scripts: these panels are read-only. */
function page(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         padding: 16px 20px; font-size: 13px; }
  h1 { font-size: 17px; font-weight: 500; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 18px; max-width: 60ch; }
  .empty { color: var(--vscode-descriptionForeground); }
  section { margin: 0 0 18px; }
  .rowhead { display: flex; justify-content: space-between; align-items: baseline;
             margin-bottom: 5px; }
  .label { font-weight: 600; }
  .label em { font-style: normal; font-weight: 400;
              color: var(--vscode-descriptionForeground); font-size: 11px; }
  .figure { color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .membar { display: flex; height: 26px; border-radius: 4px; overflow: hidden;
            border: 1px solid var(--vscode-panel-border); }
  .seg { display: flex; align-items: center; justify-content: center; min-width: 0;
         font-size: 10px; overflow: hidden; white-space: nowrap;
         font-family: var(--vscode-editor-font-family, monospace); }
  .seg.code { background: var(--vscode-charts-blue, #1565c0); color: #fff; }
  .seg.data { background: var(--vscode-charts-purple, #6a1b9a); color: #fff; }
  .seg.slot { background: var(--vscode-charts-green, #2e7d32); color: #fff;
              border-right: 1px solid var(--vscode-editor-background); }
  .seg.slot.nofit { background: var(--vscode-editorError-foreground, #f14c4c); }
  .seg.free { background: var(--vscode-editorWidget-background);
              color: var(--vscode-descriptionForeground); }
  .hint, .warn { font-size: 12px; margin: 7px 0 0; }
  .hint { color: var(--vscode-descriptionForeground); }
  .warn { color: var(--vscode-editorError-foreground, #f14c4c); }
  code { font-family: var(--vscode-editor-font-family, monospace);
         background: var(--vscode-textCodeBlock-background); padding: 1px 4px;
         border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 11px; text-transform: uppercase;
       letter-spacing: .07em; color: var(--vscode-descriptionForeground);
       font-weight: 600; padding: 6px 10px;
       border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 7px 10px; border-bottom: 1px solid var(--vscode-panel-border);
       font-size: 12.5px; }
  td.num, th.num { text-align: right;
                   font-family: var(--vscode-editor-font-family, monospace);
                   font-variant-numeric: tabular-nums; }
  td.chip { color: var(--vscode-descriptionForeground); font-size: 11.5px; }
  .of { color: var(--vscode-descriptionForeground); }
  .pct { display: inline-block; min-width: 42px; text-align: right;
         color: var(--vscode-descriptionForeground); }
  tr.failed td { color: var(--vscode-editorError-foreground, #f14c4c); }
</style></head><body>${body}</body></html>`;
}
