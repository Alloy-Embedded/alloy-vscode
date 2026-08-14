// The serial monitor panel, host side: spawn `alloy monitor --json`, forward
// its NDJSON to the webview, and forward the webview's lines back to it.
//
// The CLI owns the port, the baud and the DTR/RTS quirks; this only moves bytes
// and manages the panel's life. Lines are batched on a short timer because a
// chatty device can produce hundreds per second and one postMessage per line
// would spend the panel's time in IPC rather than rendering.

import { ChildProcess, spawn } from "node:child_process";
import * as vscode from "vscode";
import { findCli, output, workspaceRoot } from "./cli";
import { BusMessage, MonitorLine, busLine } from "./shared/monitor";

let panel: vscode.WebviewPanel | undefined;
let child: ChildProcess | undefined;

export async function openMonitor(extensionUri: vscode.Uri): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    void vscode.window.showWarningMessage("Open an alloy project first (alloy.toml).");
    return;
  }
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "alloyMonitor", "Serial Monitor", vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist"),
                           vscode.Uri.joinPath(extensionUri, "media")],
    });
  panel.webview.html = page(panel.webview, extensionUri);

  const cli = await findCli();
  child = spawn(cli, ["monitor", "--json"], { cwd: root });

  let pending: MonitorLine[] = [];
  let flush: NodeJS.Timeout | undefined;
  const post = (msg: unknown) => void panel?.webview.postMessage(msg);
  const schedule = () => {
    if (flush) {
      return;
    }
    flush = setTimeout(() => {
      flush = undefined;
      if (pending.length) {
        post({ type: "lines", lines: pending });
        pending = [];
      }
    }, 60);
  };

  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    // NDJSON: everything up to the last newline is complete.
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) {
        continue;
      }
      try {
        const obj = JSON.parse(part) as MonitorLine & {
          event?: string; message?: string; port?: string; baud?: number;
          bus_decode?: boolean; bus?: BusMessage;
        };
        if (obj.event === "open") {
          post({ type: "status", text: `${obj.port} @ ${obj.baud}`
            + (obj.bus_decode ? " · bus" : "") });
        } else if (obj.event === "error") {
          post({ type: "status", text: `error: ${obj.message}` });
        } else if (obj.event === "closed") {
          post({ type: "status", text: "closed" });
        } else if (obj.bus) {
          // A decoded datagram joins the log on the SAME timeline as the
          // text around it — that adjacency is the whole point, and it
          // makes the filter and the sparklines work on bus fields for free.
          pending.push({ t: obj.t, line: busLine(obj.bus), bus: obj.bus });
          schedule();
        } else if (typeof obj.line === "string") {
          pending.push(obj);
          schedule();
        }
      } catch {
        output.appendLine(`monitor: unparseable line ${part.slice(0, 120)}`);
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    output.appendLine(`monitor: ${text}`);
    post({ type: "status", text });
  });
  child.on("exit", (code) => post({
    type: "status", text: code ? `monitor exited (${code})` : "monitor stopped" }));

  panel.webview.onDidReceiveMessage((msg: { type: string; text?: string }) => {
    if (msg.type === "send" && msg.text) {
      child?.stdin?.write(msg.text);
    }
  });

  panel.onDidDispose(() => {
    // Closing the panel must release the serial port, or the next open fails
    // with a device-busy error nobody can explain.
    if (flush) {
      clearTimeout(flush);
    }
    child?.kill();
    child = undefined;
    panel = undefined;
  });
}

function page(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = Array.from({ length: 32 },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
  const script = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "monitor.js"));
  const style = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "monitor.css"));
  const csp = `default-src 'none'; style-src ${webview.cspSource}; `
    + `script-src 'nonce-${nonce}';`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${style}">
</head><body>
<div class="bar">
  <input type="search" id="filter" placeholder="filter — text, or /regex/">
  <button id="clear" class="secondary">Clear</button>
  <span id="status" class="status">connecting…</span>
</div>
<div class="split">
  <div id="log" class="log"></div>
  <div id="charts" class="charts"></div>
</div>
<input type="text" id="send" placeholder="type a line and press Enter to send">
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
}
